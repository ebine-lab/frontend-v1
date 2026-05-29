// ============================================================
// MiniPlayer.tsx
// フローティングミニプレイヤー — ルートレイアウトに配置
// 旧SP版AI_BBSの VideoPlayer から意匠を継承:
//   - ヘッダのフリックで画面4隅を遷移
//   - 大中小3段階のサイズ切り替え
// ============================================================

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import { usePlayerAPI } from "../hooks/usePlayerAPI";
import { usePlaylistController } from "../hooks/usePlaylistController";
import { useSyncController } from "../hooks/useSyncController";
import type { Track } from "../stores/playerStore";
import { usePlayerStore } from "../stores/playerStore";
import { MiniPlayerControls } from "./MiniPlayerControls";
import { MiniPlayerHeader } from "./MiniPlayerHeader";
import { MiniPlayerStashHandle } from "./MiniPlayerStashHandle";
import { MiniPlayerVideo } from "./MiniPlayerVideo";

/** トラックがライブ配信かどうかを判定 */
function isLiveTrack(track: Track | null): boolean {
  if (!track) return false;
  // Twitch channel: ライブ配信
  if (track.provider === "twitch" && track.providerId.startsWith("channel:")) {
    return true;
  }
  return false;
}

// ----------------------------------------------------------
// サイズ定義（旧プレイヤー踏襲）
// ----------------------------------------------------------

const MINI_SIZES = [
  "w-[min(250px,calc(100vw-16px))]", // sm（小）
  "w-[min(350px,calc(100vw-16px))]", // md（中）
  "w-[min(500px,calc(100vw-16px))]", // lg（大）
  "w-[min(125px,calc(100vw-16px))]", // xs（豆）
] as const;

// 動画本体の幅。コントロール表示で親が最小幅まで広がっても、動画はこの幅まで縮める
// （→ aspect-video で縦も縮み、プレイヤ全体が低くなる。音楽プレイリスト向け）。
const MINI_VIDEO_WIDTHS = [
  "min(250px,calc(100vw - 16px))",
  "min(350px,calc(100vw - 16px))",
  "min(500px,calc(100vw - 16px))",
  "min(125px,calc(100vw - 16px))",
] as const;

// コントロール表示時のミニプレイヤ最小幅（ボタン群が収まる固定値）。
const CONTROLS_MIN_WIDTH = "min(230px, calc(100vw - 16px))";

// ----------------------------------------------------------
// ポジション → スタイル変換
// ----------------------------------------------------------

function getPositionClasses(position: string): string {
  switch (position) {
    case "br":
      return "bottom-[58px] right-2";
    case "tr":
      return "top-2 right-2";
    case "tl":
      return "top-2 left-2";
    case "bl":
      return "bottom-[58px] left-2";
    default:
      return "bottom-[58px] right-2";
  }
}

/** 右側の隅（tr/br）かどうか。スタッシュ方向の判定に使う */
function isRightCorner(position: string): boolean {
  return position === "tr" || position === "br";
}

// ----------------------------------------------------------
// コンポーネント
// ----------------------------------------------------------

export const MiniPlayer: React.FunctionComponent = () => {
  const { stop, next, prev, toggleShuffle, cycleRepeat } = usePlayerAPI();

  // 連続再生の進行制御（ブリッジ + 自動次送り + history 更新）
  usePlaylistController();

  // 同時視聴（sync）の同期制御（douji 基準時刻へシーク + ドリフト補正）
  useSyncController();

  const visible = usePlayerStore((s) => s.miniPlayer.visible);
  const position = usePlayerStore((s) => s.miniPlayer.position);
  const sizeIndex = usePlayerStore((s) => s.miniPlayer.sizeIndex);
  const currentTrack = usePlayerStore((s) => s.players.primary.currentTrack);
  const currentTime = usePlayerStore((s) => s.players.primary.currentTime);
  const muted = usePlayerStore((s) => s.players.primary.muted);
  const mode = usePlayerStore((s) => s.playlist.mode);
  const shuffle = usePlayerStore((s) => s.playlist.shuffle);
  const repeat = usePlayerStore((s) => s.playlist.repeat);
  const currentIndex = usePlayerStore((s) => s.playlist.currentIndex);
  const trackTotal = usePlayerStore((s) => s.playlist.tracks.length);
  const shuffleOrder = usePlayerStore((s) => s.playlist.shuffleOrder);
  const stashed = usePlayerStore((s) => s.miniPlayer.stashed);
  const setMiniPlayerPosition = usePlayerStore((s) => s.setMiniPlayerPosition);
  const cycleMiniPlayerSize = usePlayerStore((s) => s.cycleMiniPlayerSize);
  const setMiniPlayerStashed = usePlayerStore((s) => s.setMiniPlayerStashed);
  const setMuted = usePlayerStore((s) => s.setMuted);

  // 表示用トラック位置（1始まり）。シャッフル時は再生順（shuffleOrder）での位置。
  const trackPosition =
    shuffle && shuffleOrder.length > 0
      ? shuffleOrder.indexOf(currentIndex) + 1
      : currentIndex + 1;

  // プロバイダーが完全な制御をサポートするかどうか
  const [hasFullControl, setHasFullControl] = useState(true);

  const handleFullControlChange = useCallback(
    (value: boolean): void => setHasFullControl(value),
    [],
  );

  const isLive = isLiveTrack(currentTrack);
  // コントロールバーの表示条件:
  // - ライブ配信 → mute のみ表示
  // - 連続再生 → 前/次・トラック位置・シャッフル・リピートを表示
  // - 単品再生 → 非表示（スペース確保）
  const showControls = isLive || mode === "playlist";

  const handleToggleMute = useCallback((): void => {
    setMuted("primary", !muted);
  }, [setMuted, muted]);

  // 画面外スタッシュ時の退避量（自幅基準。右隅は右へ、左隅は左へ全幅＋余白分）。
  const stashX = isRightCorner(position) ? "110%" : "-110%";

  return (
    // クリップ層: 画面外へ出したプレイヤを overflow-hidden で切り取り、off-screen の
    // 固定要素による横スクロール（iOS で顕著）を防ぐ。背面操作は pointer-events で透過。
    <div className="fixed inset-0 z-30 pointer-events-none overflow-hidden">
      <AnimatePresence>
        {visible && (
          <motion.div
            className={`absolute pointer-events-auto rounded-lg shadow-2xl overflow-hidden ${MINI_SIZES[sizeIndex]} ${getPositionClasses(position)}`}
            style={showControls ? { minWidth: CONTROLS_MIN_WIDTH } : undefined}
            initial={{ y: 40, scale: 0.95 }}
            animate={{ x: stashed ? stashX : 0, y: 0, scale: 1 }}
            exit={{ y: 40, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            layout
          >
            <MiniPlayerHeader
              position={position}
              sizeIndex={sizeIndex}
              onPositionChange={setMiniPlayerPosition}
              onCycleSize={cycleMiniPlayerSize}
              onClose={stop}
              onStash={(): void => setMiniPlayerStashed(true)}
            />

            <MiniPlayerVideo
              currentTrack={currentTrack}
              slotId="primary"
              videoWidth={MINI_VIDEO_WIDTHS[sizeIndex]}
              onFullControlChange={handleFullControlChange}
            />

            {showControls && (
              <MiniPlayerControls
                currentTime={currentTime}
                duration={currentTrack?.duration}
                hasFullControl={hasFullControl}
                isLive={isLive}
                muted={muted}
                shuffle={shuffle}
                repeat={repeat}
                trackPosition={trackPosition}
                trackTotal={trackTotal}
                onNext={next}
                onPrev={prev}
                onToggleMute={handleToggleMute}
                onToggleShuffle={toggleShuffle}
                onCycleRepeat={cycleRepeat}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {visible && stashed && (
          <MiniPlayerStashHandle
            position={position}
            onRestore={(): void => setMiniPlayerStashed(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
