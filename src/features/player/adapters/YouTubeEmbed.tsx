// ============================================================
// adapters/YouTubeEmbed.tsx
// YouTube iframe API 埋め込み — API ローダー + コンポーネント + ストア同期
//
// 連続再生対応: プレイヤーは一度だけ生成し、videoId 変更時は
// destroy/再生成ではなく loadVideoById で差し替える。これにより
// iframe を作り直さない＝iOS のユーザージェスチャー活性化を保持し、
// 音声付きのまま自動でトラックを継続再生できる。
// ============================================================

import { useCallback, useEffect, useRef } from "react";
import type {} from "youtube";
import type { SlotId } from "../stores/playerStore";
import { usePlayerStore } from "../stores/playerStore";

// ----------------------------------------------------------
// YouTube IFrame API ローダー（モジュールレベル・シングルトン）
// ----------------------------------------------------------

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;

function loadYouTubeAPI(): Promise<void> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    window.onYouTubeIframeAPIReady = (): void => resolve();
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = (): void => {
      apiPromise = null;
      reject(new Error("Failed to load YouTube IFrame API"));
    };
    document.head.appendChild(script);
  });

  return apiPromise;
}

// ----------------------------------------------------------
// ストアアクセス（安定参照）
// ----------------------------------------------------------

const getStore = (): ReturnType<typeof usePlayerStore.getState> =>
  usePlayerStore.getState();

// ----------------------------------------------------------
// コンポーネント
// ----------------------------------------------------------

interface YouTubeEmbedProps {
  providerId: string;
  slotId: SlotId;
  onFullControlChange?: (hasFullControl: boolean) => void;
}

export const YouTubeEmbed: React.FunctionComponent<YouTubeEmbedProps> = ({
  providerId,
  slotId,
  onFullControlChange,
}: YouTubeEmbedProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // sourceRef で「誰が状態変更を発生させたか」を追跡し無限ループを防ぐ
  const sourceRef = useRef<"store" | "player" | null>(null);
  const mountedRef = useRef(true);
  // 非同期 init のレースコンディション防止用 generation counter
  const generationRef = useRef(0);
  // player が ready になったか
  const isReadyRef = useRef(false);
  // 最新の providerId（差し替え判定に使用）
  const videoIdRef = useRef(providerId);
  // player に現在ロード済みの videoId
  const loadedVideoIdRef = useRef<string | null>(null);

  useEffect(() => {
    onFullControlChange?.(true);
  }, [onFullControlChange]);

  // 最新 videoId を player に反映（destroy せず差し替え）
  const syncVideo = useCallback((): void => {
    const p = playerRef.current;
    if (!p || !isReadyRef.current) return;
    if (loadedVideoIdRef.current === videoIdRef.current) return;
    loadedVideoIdRef.current = videoIdRef.current;
    p.loadVideoById(videoIdRef.current);
  }, []);

  // ---- 生成 / 破棄（slotId 単位。providerId 変更では再実行しない） ----
  useEffect(() => {
    mountedRef.current = true;
    const generation = ++generationRef.current;
    let player: YT.Player | null = null;

    const init = async (): Promise<void> => {
      try {
        await loadYouTubeAPI();
      } catch {
        if (mountedRef.current) getStore().setStatus(slotId, "error");
        return;
      }
      // mountedRef + generation の二重チェックで stale init を確実に abort
      if (
        !mountedRef.current ||
        generation !== generationRef.current ||
        !containerRef.current
      ) {
        return;
      }

      const s = getStore();
      s.setStatus(slotId, "loading");

      // 前の init が残した orphan ノードを確実に除去してから新しい player を作成。
      // containerRef は YouTubeEmbed 自身の div なので React の管理外。
      containerRef.current.innerHTML = "";

      const initialVideoId = videoIdRef.current;
      loadedVideoIdRef.current = initialVideoId;

      // iframe を自前生成して属性を完全制御する。
      // - referrerpolicy を strict-origin-when-cross-origin に明示
      //   （iOS 26.5 等で referrer が落ち、YouTube が埋め込み元オリジンを
      //    検証できず error 153 が出る環境への対処）
      // - allow / allowfullscreen も明示し OgpCard 側と揃える
      // YT.Player は src に enablejsapi=1 が付いた既存 iframe を受け取れる。
      // 渡した場合 playerVars/host/videoId は URL 側が優先され、options は無視される。
      const iframe = document.createElement("iframe");
      iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      iframe.setAttribute(
        "allow",
        "autoplay; encrypted-media; picture-in-picture",
      );
      iframe.setAttribute("allowfullscreen", "");
      iframe.setAttribute("title", "YouTube video player");
      iframe.style.width = "100%";
      iframe.style.height = "100%";
      iframe.style.border = "0";

      const params = new URLSearchParams({
        enablejsapi: "1",
        autoplay: "1",
        playsinline: "1",
        rel: "0",
        iv_load_policy: "3",
        origin: window.location.origin,
      });
      iframe.src = `https://www.youtube-nocookie.com/embed/${initialVideoId}?${params.toString()}`;

      containerRef.current.appendChild(iframe);

      player = new window.YT.Player(iframe, {
        events: {
          onReady: (): void => {
            if (!mountedRef.current) return;
            playerRef.current = player;
            isReadyRef.current = true;
            // ready までに providerId が変わっていたら差し替える
            syncVideo();
            // 同時視聴の追従で設定済みの再生速度を反映（既定は等倍）
            const rate = getStore().players[slotId].playbackRate;
            if (rate !== 1) player?.setPlaybackRate(rate);
          },
          onStateChange: (event: YT.OnStateChangeEvent): void => {
            if (!mountedRef.current) return;
            handleStateChange(event.data);
          },
          onError: (event: YT.OnErrorEvent): void => {
            if (!mountedRef.current) return;
            console.warn(
              `[YouTubeEmbed] YT error code=${event.data} videoId=${videoIdRef.current}`,
            );
            const store = getStore();
            store.setStatus(slotId, "error");
            // 連続再生中は再生不能トラックをスキップして次へ送る。
            // currentIndex 変化を usePlaylistController のブリッジが拾って次をロードする。
            if (slotId === "primary" && store.playlist.mode === "playlist") {
              store.next();
            }
          },
        },
      });
    };

    const handleStateChange = (state: YT.PlayerState): void => {
      const store = getStore();

      // ストア起点の操作中はイベントを無視
      if (sourceRef.current === "store") {
        sourceRef.current = null;
        return;
      }

      sourceRef.current = "player";

      switch (state) {
        case window.YT.PlayerState.PLAYING: {
          store.setStatus(slotId, "playing");
          // duration を取得して Track に反映
          if (player) {
            const duration = player.getDuration();
            if (duration > 0) {
              const track = store.players[slotId].currentTrack;
              if (track && !track.duration) {
                store.loadTrack(slotId, { ...track, duration });
                store.setStatus(slotId, "playing");
              }
            }
          }
          startTimeUpdate();
          break;
        }
        case window.YT.PlayerState.PAUSED:
          store.setStatus(slotId, "paused");
          stopTimeUpdate();
          break;
        case window.YT.PlayerState.ENDED:
          store.setStatus(slotId, "ended");
          stopTimeUpdate();
          break;
        case window.YT.PlayerState.BUFFERING:
          store.setStatus(slotId, "loading");
          break;
        default:
          break;
      }

      sourceRef.current = null;
    };

    const startTimeUpdate = (): void => {
      stopTimeUpdate();
      intervalRef.current = setInterval(() => {
        if (!player || !mountedRef.current) return;
        const time = player.getCurrentTime();
        getStore().updateTime(slotId, time);
      }, 250);
    };

    const stopTimeUpdate = (): void => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    void init();

    // ストア購読: status 変化に応じて iframe を制御
    const unsubStatus = usePlayerStore.subscribe(
      (s) => s.players[slotId].status,
      (status) => {
        if (!playerRef.current || sourceRef.current === "player") return;
        sourceRef.current = "store";
        if (status === "playing") {
          playerRef.current.playVideo();
        } else if (status === "paused") {
          playerRef.current.pauseVideo();
        }
      },
    );

    // ストア購読: seekTarget 変化に応じてシーク実行
    const unsubSeek = usePlayerStore.subscribe(
      (s) => s.players[slotId].seekTarget,
      (seekTarget) => {
        if (seekTarget == null || !playerRef.current) return;
        playerRef.current.seekTo(seekTarget, true);
        getStore().clearSeekTarget(slotId);
      },
    );

    // ストア購読: playbackRate 変化に応じて再生速度を反映（同時視聴の追従）。
    // YouTube は getAvailablePlaybackRates の離散値のみ有効で、非対応値は
    // 「1 の方向に最も近い対応値」へ丸められる（例: 0.95→1, 1.1→1）。
    const unsubRate = usePlayerStore.subscribe(
      (s) => s.players[slotId].playbackRate,
      (rate) => {
        if (!playerRef.current) return;
        playerRef.current.setPlaybackRate(rate);
      },
    );

    return (): void => {
      mountedRef.current = false;
      isReadyRef.current = false;
      loadedVideoIdRef.current = null;
      stopTimeUpdate();
      unsubStatus();
      unsubSeek();
      unsubRate();
      // playerRef.current（onReady 後）または local player（onReady 前）を破棄。
      // どちらか一方しか有効でないため ?? で fallback する。
      const p = playerRef.current ?? player;
      if (p) {
        try {
          p.destroy();
        } catch {
          // 既に破棄済み or DOM が detached の場合は無視
        }
      }
      playerRef.current = null;
      // destroy() で残った残骸をクリア（外側 div は React が管理）
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [slotId, syncVideo]);

  // ---- videoId 差し替え（再マウントせず loadVideoById） ----
  useEffect(() => {
    videoIdRef.current = providerId;
    syncVideo();
  }, [providerId, syncVideo]);

  return <div ref={containerRef} className="w-full h-full" />;
};
