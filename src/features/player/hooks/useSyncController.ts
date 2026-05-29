// ============================================================
// features/player/hooks/useSyncController.ts
// 同時視聴（sync）モードの結線フック — MiniPlayer から呼ぶ
// ============================================================
//
// 役割:
//   &douji=YYYYMMDDHHmm で指定された基準時刻から再生開始したかのように、
//   現在の経過秒へシークし、以後もドリフトを補正して概ね同期を保つ。
//   スレ実況のタイミング合わせ用途のため、誤差3秒程度以内に追従できれば十分。
//
// 設計:
//   既存の seek 機構（requestSeek → アダプターの seekTarget 購読 → seekTo、
//   currentTime は updateTime で 250ms 毎に反映）をそのまま利用する。
//   アダプターには手を入れず、requestSeek と currentTime だけで駆動する。
//
// スコープ:
//   今回は YouTube 単品のみ対象（provider === "youtube" でゲート）。
// ============================================================

import { useEffect } from "react";
import { usePlayerStore } from "../stores/playerStore";

/** 同期チェック間隔（ms）。初回シークは最大このディレイで実行される */
const CHECK_INTERVAL = 1000;
/** このズレ（秒）を超えたら再シークする */
const DRIFT_THRESHOLD = 3;
/** シーク後の再シーク抑止時間（ms）。バッファリング中の連続シークを防ぐ */
const COOLDOWN = 2000;

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

    // effect スコープで保持することで status の再 effect による無限シークを防ぐ
    let lastSeekAt = 0;
    let didInitial = false;

    const tick = (): void => {
      const p = usePlayerStore.getState().players.primary;
      if (p.status !== "playing") return;

      const track = p.currentTrack;
      if (!track?.syncStartTime) return;

      // 経過秒（基準時刻が未来なら 0 にクランプ）
      const expected = Math.max(0, (Date.now() - track.syncStartTime) / 1000);
      // 既に終了範囲なら補正しない（自然終了に委ねる）
      if (track.duration && expected > track.duration) return;

      const drift = Math.abs(p.currentTime - expected);
      const now = Date.now();
      if (
        (!didInitial || drift > DRIFT_THRESHOLD) &&
        now - lastSeekAt > COOLDOWN
      ) {
        lastSeekAt = now;
        didInitial = true;
        usePlayerStore.getState().requestSeek("primary", expected);
      }
    };

    const id = setInterval(tick, CHECK_INTERVAL);
    return (): void => clearInterval(id);
    // trackId 変化で貼り直し → didInitial がリセットされ次トラックでも初回シークする。
    // status は依存に含めない（seek→buffering→playing の再 effect で無限シークになるため）。
  }, [subMode, provider, syncStartTime, trackId]);
}
