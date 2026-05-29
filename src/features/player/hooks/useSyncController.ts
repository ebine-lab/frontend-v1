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
//   ① ahead >= +8秒       : 目標へ即時シーク
//   ② +5 〜 +8秒（早い）  : 0.75倍速で減速し追いつかれるのを待つ
//   ③ ±5秒                 : 何もしない（デッドゾーン）
//   ④ -5 〜 -8秒（遅れ）  : 1.25倍速で加速し追いつく
//   ⑥ ahead <= -8秒       : 目標へ即時シーク
//
//   ゼロクロス強制終了（モード分岐前）:
//     ahead > 0 なら加速モードを終了、ahead < 0 なら減速モードを終了する。
//     目標を跨いだ瞬間に逆方向の補正を切るため、目標付近で等倍に収束し
//     0.75 ↔ 1.25 の振動を起こさない。デッドゾーンでの速度持続は、
//     補正中と同じ符号側にいる間だけ働く。
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
import { getSyncedNow, primeServerTimeOffset } from "../utils/serverTime";

/** 同期チェック間隔（ms）。初回シークは最大このディレイで実行される */
const CHECK_INTERVAL = 1000;
/** シーク後の再シーク抑止時間（ms）。バッファリング中の連続シークを防ぐ */
const COOLDOWN = 2000;

// ---- ズレのしきい値（秒、ahead = currentTime - expected） ----
/** これ以上「早い」なら即時シーク（①） */
const SEEK_AHEAD = 8;
/** これ以上「遅れ」なら即時シーク（⑥） */
const SEEK_BEHIND = 8;
/** これ以上「早い」なら減速（②の下限） */
const SLOW_THRESHOLD = 5;
/** これ以上「遅れ」なら加速（④の下限） */
const FAST_THRESHOLD = 5;

type SyncMode = "none" | "slow" | "fast";

/** 各モードの再生速度（ユーザー指定: ② 0.75 / ④ 1.25） */
const RATE: Record<SyncMode, number> = {
  none: 1,
  slow: 0.75,
  fast: 1.25,
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

  // biome-ignore lint/correctness/useExhaustiveDependencies(trackId): トラック変更時に effect スコープの mode/appliedRate/lastSeekAt をリセットするため意図的に含める
  useEffect(() => {
    // YouTube 単品の同時視聴のみ駆動
    if (subMode !== "sync") return;
    if (provider !== "youtube") return;
    if (syncStartTime == null) return;

    // 同時視聴開始時に 1 回だけサーバー時刻オフセットを取得（PC時計ずれの補正）。
    // モジュール側の取得済みガードにより実 fetch は 1 回に束ねられる。
    // 取得完了までは getSyncedNow が PC時刻を返すため同期は即時に始まる。
    void primeServerTimeOffset();

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
      // syncStartTime は epoch ms。0（=1970）も有効な基準時刻なので
      // falsy 判定ではなく null/undefined 判定で未設定を見分ける。
      if (track?.syncStartTime == null) return;

      const expected = (getSyncedNow() - track.syncStartTime) / 1000;
      // 基準時刻がまだ未来 → 開始前なので何もしない（先頭から等倍再生）
      if (expected < 0) return;
      // 既に終了範囲なら補正しない（自然終了に委ねる）
      if (track.duration && expected > track.duration) return;

      const ahead = p.currentTime - expected;

      // ゼロクロス強制終了（モード分岐前）。目標を跨いだら逆方向の補正を切る。
      if (ahead > 0 && mode === "fast") mode = "none";
      if (ahead < 0 && mode === "slow") mode = "none";

      // 補正モードの決定
      let target: SyncMode | "seek";
      if (ahead >= SEEK_AHEAD || ahead <= -SEEK_BEHIND) {
        target = "seek"; // ①⑥
      } else if (ahead >= SLOW_THRESHOLD) {
        target = "slow"; // ②
      } else if (ahead <= -FAST_THRESHOLD) {
        target = "fast"; // ④
      } else {
        target = mode; // ③ デッドゾーン: 同符号側にいる間だけ持続
      }

      if (target === "seek") {
        doSeek(expected);
      } else {
        applyRate(target);
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
