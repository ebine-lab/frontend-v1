// ============================================================
// adapters/NativeVideoEmbed.tsx
// 掲示板添付動画（.mp4, .webm 等）— HTML5 <video> による再生
// YouTube/ニコニコと異なり、完全な再生制御が可能。
//
// iOS Safari は video.play() をユーザージェスチャーのコールスタック内
// でのみ許可する。非 iOS 環境では canplay 時に自動再生を試みる。
// ============================================================

import { useEffect, useRef, useState } from "react";
import { FiPlayCircle } from "react-icons/fi";
import type { PlayerStore, SlotId } from "../stores/playerStore";
import { usePlayerStore } from "../stores/playerStore";

const getStore = (): PlayerStore => usePlayerStore.getState();

/** iOS / iPadOS の簡易判定 */
const isIOS: boolean =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

interface NativeVideoEmbedProps {
  providerId: string; // 動画の完全URL
  slotId: SlotId;
  onFullControlChange?: (hasFullControl: boolean) => void;
}

export const NativeVideoEmbed: React.FunctionComponent<
  NativeVideoEmbedProps
> = ({ providerId, slotId, onFullControlChange }: NativeVideoEmbedProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceRef = useRef<"store" | "player" | null>(null);
  // iOS の user gesture 活性化を「この <video> 要素で一度でも play した」フラグで
  // 追跡。初回はユーザータップ必須だが、活性化後は src 差し替え + canplay 自動再生で
  // 連続再生（埋め込み動画 playlist モード）の次曲遷移が iOS Safari でも通る。
  const activatedRef = useRef(false);

  // video 要素の実際の再生状態に直結するローカル state。
  // ストアの status ではなくこちらでオーバーレイ表示を制御することで、
  // ストア更新のタイミングに依存しない堅牢な表示切替を実現する。
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    onFullControlChange?.(true);
  }, [onFullControlChange]);

  // biome-ignore lint/correctness/useExhaustiveDependencies(providerId): 再レンダ時リスナを登録し直す
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const s = getStore();
    s.setStatus(slotId, "loading");

    // ---- video → store 同期 ----

    const handleLoadedMetadata = (): void => {
      if (video.duration > 0) {
        const track = getStore().players[slotId].currentTrack;
        if (track && !track.duration) {
          getStore().loadTrack(slotId, { ...track, duration: video.duration });
        }
      }
    };

    const handleCanPlay = (): void => {
      const st = getStore().players[slotId].status;
      if (st !== "loading") return;

      // 非iOS は常に programmatic play() を試行。
      // iOS は初回のみユーザータップ待ち。活性化後（activatedRef = true）は
      // src 差し替え後でも programmatic play() が通る（user gesture が要素単位で保持される）
      // ため、連続再生の次曲遷移が自動で進む。
      if (!isIOS || activatedRef.current) {
        video.play().catch(() => getStore().setStatus(slotId, "paused"));
      } else {
        getStore().setStatus(slotId, "paused");
      }
    };

    const handlePlay = (): void => {
      // 初回 play イベントで活性化済みとマーク。
      // 以降の canplay は iOS でも自動再生を試みる。
      activatedRef.current = true;
      setIsPlaying(true);
      if (sourceRef.current === "store") {
        sourceRef.current = null;
        return;
      }
      sourceRef.current = "player";
      getStore().setStatus(slotId, "playing");
      sourceRef.current = null;
    };

    const handlePause = (): void => {
      setIsPlaying(false);
      if (sourceRef.current === "store") {
        sourceRef.current = null;
        return;
      }
      sourceRef.current = "player";
      getStore().setStatus(slotId, "paused");
      sourceRef.current = null;
    };

    const handleTimeUpdate = (): void => {
      getStore().updateTime(slotId, video.currentTime);
    };

    const handleEnded = (): void => {
      setIsPlaying(false);
      getStore().setStatus(slotId, "ended");
    };

    const handleError = (): void => {
      setIsPlaying(false);
      getStore().setStatus(slotId, "error");
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);

    // ---- store → video 同期 ----

    const unsubStatus = usePlayerStore.subscribe(
      (state) => state.players[slotId].status,
      (newStatus) => {
        if (!video || sourceRef.current === "player") return;
        sourceRef.current = "store";
        if (newStatus === "playing") {
          video.play().catch(() => {
            sourceRef.current = null;
            getStore().setStatus(slotId, "paused");
          });
        } else if (newStatus === "paused") {
          video.pause();
        }
      },
    );

    const unsubSeek = usePlayerStore.subscribe(
      (state) => state.players[slotId].seekTarget,
      (seekTarget) => {
        if (seekTarget == null || !video) return;
        video.currentTime = seekTarget;
        getStore().clearSeekTarget(slotId);
      },
    );

    return (): void => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      unsubStatus();
      unsubSeek();
      video.pause();
      getStore().setStatus(slotId, "idle");
    };
  }, [providerId, slotId]);

  return (
    <div className="relative w-full h-full cursor-pointer">
      <video
        ref={videoRef}
        src={providerId}
        className="w-full h-full object-contain"
        playsInline
        preload="auto"
        controls
      >
        <track kind="captions" />
      </video>
      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 rounded-full p-3">
            <FiPlayCircle className="w-12 h-12 text-white" />
          </div>
        </div>
      )}
    </div>
  );
};
