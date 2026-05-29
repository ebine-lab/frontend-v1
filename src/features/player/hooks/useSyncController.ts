// ============================================================
// features/player/hooks/useSyncController.ts
// 同時視聴（sync）モードの結線フック — MiniPlayer から呼ぶ
// ============================================================
//
// 役割:
//   &douji=YYYYMMDDHHmm で指定された基準時刻から再生開始したかのように、
//   現在の経過秒へ追従させる。回線不調も考慮し、ズレが小さいうちは
//   再生速度の微調整で緩やかに合わせ、大きくズレたときだけ即時シークする。
//
// 追従ロジック（目標時刻に対する再生位置のズレ ahead = currentTime - expected）:
//   ① ahead >= +15秒       : 目標へ即時シーク
//   ② +5 〜 +15秒（早い）  : 0.75倍速で減速し追いつかれるのを待つ
//   ③ ±5秒                 : 何もしない（デッドゾーン）
//   ④ -5 〜 -15秒（遅れ）  : 1.25倍速で加速し追いつく
//   ⑤ -15 〜 -30秒（遅れ） : 1.25倍速で加速し追いつく
//   ⑥ ahead <= -30秒       : 目標へ即時シーク
//
//   速度モードはヒステリシスを持つ。一度入ると③へ戻っても持続し、
//   より極端な状態に達したときだけ放棄する:
//     ② は ① で放棄、④ は ⑤⑥ で放棄、⑤ は ⑥ で放棄。
//   ④⑤ は同一速度（1.25）だが、放棄境界が異なるためモードを区別する。
//
// 速度値について:
//   YouTube は getAvailablePlaybackRates の離散値（0.25/0.5/0.75/1/1.25/…）
//   のみ有効で、非対応値は「1 の方向に最も近い対応値」へ丸められる。
//   そのため減速 0.75・加速 1.25 を採用する（0.95/1.1/1.2 は 1.0 に丸められ無効）。
//
// 設計:
//   既存の seek / playbackRate 機構（requestSeek・setPlaybackRate →
//   アダプター購読、currentTime は updateTime で反映）をそのまま利用する。
//   アダプターには手を入れない。今回は YouTube 単品のみ対象。
// ============================================================

import { useEffect } from "react";
import { usePlayerStore } from "../stores/playerStore";

/** 同期チェック間隔（ms）。初回シークは最大このディレイで実行される */
const CHECK_INTERVAL = 1000;
/** シーク後の再シーク抑止時間（ms）。バッファリング中の連続シークを防ぐ */
const COOLDOWN = 2000;

// ---- ズレのしきい値（秒、ahead = currentTime - expected） ----
/** これ以上「早い」なら即時シーク（①） */
const SEEK_AHEAD = 15;
/** これ以上「遅れ」なら即時シーク（⑥） */
const SEEK_BEHIND = 30;
/** これ以上「早い」なら減速（②の下限） */
const SLOW_THRESHOLD = 5;
/** これ以上「遅れ」なら加速（④の下限） */
const FAST_THRESHOLD = 5;
/** これ以上「遅れ」なら強めの加速モード（⑤の下限） */
const FAST_STRONG_THRESHOLD = 15;

type SyncMode = "none" | "slow" | "fast11" | "fast12";

/** 各モードの再生速度（ユーザー指定: ② 0.75 / ④⑤ 1.25） */
const RATE: Record<SyncMode, number> = {
  none: 1,
  slow: 0.75,
  fast11: 1.25,
  fast12: 1.25,
};

export function useSyncController(): void {
  const subMode = usePlayerStore((s) => s.playlist.subMode);
  const trackId = usePlayerStore((s) => s.players.primary.currentTrack?.id);
  const provider = usePlayerStore(
    (s) => s.players.primary.currentTrack?.provider,
  );
  const syncStartTime = usePlayerStore(
    (s) => s.players.primary.currentTrack?.syncStartTime,
  );

  useEffect(() => {
    // YouTube 単品の同時視聴のみ駆動
    if (subMode !== "sync") return;
    if (provider !== "youtube") return;
    if (syncStartTime == null) return;

    // effect スコープで保持する。trackId 変化で貼り直され初期化される。
    // status を依存に含めない（seek→buffering→playing の再 effect で
    // 無限シークになるため）。
    let mode: SyncMode = "none";
    let appliedRate = 1;
    let lastSeekAt = 0;

    const applyRate = (next: SyncMode): void => {
      mode = next;
      const rate = RATE[next];
      if (rate !== appliedRate) {
        appliedRate = rate;
        usePlayerStore.getState().setPlaybackRate("primary", rate);
      }
    };

    const doSeek = (target: number): void => {
      const now = Date.now();
      if (now - lastSeekAt < COOLDOWN) return;
      lastSeekAt = now;
      applyRate("none"); // シークで同期するので速度は等倍へ戻す
      usePlayerStore.getState().requestSeek("primary", target);
    };

    const tick = (): void => {
      const p = usePlayerStore.getState().players.primary;
      if (p.status !== "playing") return;

      const track = p.currentTrack;
      if (!track?.syncStartTime) return;

      const expected = (Date.now() - track.syncStartTime) / 1000;
      // 基準時刻がまだ未来 → 開始前なので何もしない（先頭から等倍再生）
      if (expected < 0) return;
      // 既に終了範囲なら補正しない（自然終了に委ねる）
      if (track.duration && expected > track.duration) return;

      const ahead = p.currentTime - expected;

      if (ahead >= SEEK_AHEAD || ahead <= -SEEK_BEHIND) {
        // ①⑥: 即時シーク
        doSeek(expected);
      } else if (ahead >= SLOW_THRESHOLD) {
        // ②: 早すぎ → 減速
        applyRate("slow");
      } else if (ahead <= -FAST_STRONG_THRESHOLD) {
        // ⑤: 大きく遅れ → 強めの加速
        applyRate("fast12");
      } else if (ahead <= -FAST_THRESHOLD) {
        // ④: 遅れ → 加速（⑤から降りてきた場合は fast12 を維持）
        applyRate(mode === "fast12" ? "fast12" : "fast11");
      } else if (mode !== "none") {
        // ③: デッドゾーン。速度モード作動中なら持続（ヒステリシス）
        applyRate(mode);
      }
    };

    const id = setInterval(tick, CHECK_INTERVAL);
    return (): void => {
      clearInterval(id);
      // 同期終了時は速度を等倍へ戻す（次の通常再生が速度を引きずらないように）
      if (appliedRate !== 1) {
        usePlayerStore.getState().setPlaybackRate("primary", 1);
      }
    };
  }, [subMode, provider, syncStartTime, trackId]);
}
