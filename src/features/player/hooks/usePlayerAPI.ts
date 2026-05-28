// ============================================================
// features/player/hooks/usePlayerAPI.ts
// パブリックAPIフック — 外部からプレイヤーを操作する唯一の窓口
// ============================================================
//
// 設計方針:
//   アクション関数は usePlayerStore.getState() 経由でストアメソッドを
//   直接呼び出す。useCallback でラップしない。
//   → store 更新でコールバック参照が変わらないため、
//     useEffect の依存に含めても無限ループしない。
//
//   読み取り専用の状態は usePlayerStore(selector) で必要なスライスだけ購読。
// ============================================================

import { useLocation } from "@tanstack/react-router";
import { useMemo } from "react";
import type {
  HistorySingleQuery,
  PlaybackStatus,
  PlayerQuery,
  PlaylistState,
  PlayMode,
  PlayModeSub,
  PlayOrigin,
  Provider,
  SlotId,
  Track,
} from "../stores/playerStore";
import { usePlayerStore } from "../stores/playerStore";
import { detectProvider, extractProviderId } from "../utils/providerDetect";

// ----------------------------------------------------------
// 内部ヘルパー（モジュールレベル — レンダーに依存しない）
// ----------------------------------------------------------

function urlToTrack(url: string): Track | null {
  const provider = detectProvider(url);
  if (!provider) return null;

  const providerId = extractProviderId(url, provider);
  if (!providerId) return null;

  return {
    id: `${provider}:${providerId}`,
    provider,
    providerId,
  };
}

function buildOrigin(
  threadId: string,
  path: string,
  label?: string,
): PlayOrigin {
  return { threadId, path, label };
}

/** ストアの getState を取得するショートカット */
const getStore = (): ReturnType<typeof usePlayerStore.getState> =>
  usePlayerStore.getState();

// ----------------------------------------------------------
// オプション型
// ----------------------------------------------------------

export interface PlayOptions {
  subMode?: PlayModeSub;
  label?: string;
  slotId?: SlotId;
}

export interface PlayListOptions extends PlayOptions {
  startIndex?: number;
  /**
   * プレイリスト対象 provider。指定 provider のトラックだけを抽出して
   * プレイリスト化する。連続再生は同一 provider 内に限定（再マウントせず
   * 同一プレイヤー要素で次曲遷移するため）。
   * デフォルトは "youtube"（後方互換）。
   */
  playlistProvider?: Provider;
}

// ----------------------------------------------------------
// 判定ユーティリティ（UIコンポーネント向け）
// ----------------------------------------------------------

export function isPlayableUrl(url: string): boolean {
  return detectProvider(url) !== null;
}

// ----------------------------------------------------------
// アクション関数（モジュールレベル安定参照）
// ----------------------------------------------------------
// ストアのメソッドは Zustand が保証する安定参照。
// これらの関数もモジュールレベルで定義することで参照が不変になる。
// location.pathname が必要な関数（play 系）だけフックから返す。
// ----------------------------------------------------------

function doNext(): void {
  getStore().next();
}

function doPrev(): void {
  getStore().prev();
}

function doJumpTo(index: number): void {
  getStore().jumpTo(index);
}

function doToggleShuffle(): void {
  getStore().toggleShuffle();
}

function doCycleRepeat(): void {
  getStore().cycleRepeat();
}

function doAddToPlaylist(url: string): void {
  const track = urlToTrack(url);
  if (!track) return;
  getStore().appendTrack(track);
}

function doRemoveFromPlaylist(url: string): void {
  const track = urlToTrack(url);
  if (!track) return;
  getStore().removeTrack(track.id);
}

function doPause(slotId: SlotId = "primary"): void {
  getStore().pause(slotId);
}

function doResume(slotId: SlotId = "primary"): void {
  getStore().play(slotId);
}

function doStop(slotId: SlotId = "primary"): void {
  const s = getStore();
  s.resetSlot(slotId);
  s.clearMode();
  s.setMiniPlayerVisible(false);
}

function doRequestSeek(slotId: SlotId = "primary", time: number): void {
  getStore().requestSeek(slotId, time);
}

function doShowMiniPlayer(): void {
  getStore().setMiniPlayerVisible(true);
}

function doHideMiniPlayer(): void {
  getStore().setMiniPlayerVisible(false);
}

function doRestoreFromHistory(queryKey: string): void {
  getStore().restoreFromHistory(queryKey);
}

function doRegisterMedia(
  threadId: string,
  url: string,
  provider: Provider,
  providerId: string,
  postNo?: number,
): void {
  const trackId = `${provider}:${providerId}`;
  getStore().registerMedia(threadId, { url, trackId, provider, postNo });
}

function doUnregisterMedia(threadId: string, url: string): void {
  getStore().unregisterMedia(threadId, url);
}

function doToggleMediaChecked(threadId: string, url: string): void {
  getStore().toggleMediaChecked(threadId, url);
}

function doSetAllMediaChecked(threadId: string, checked: boolean): void {
  getStore().setAllMediaChecked(threadId, checked);
}

// ----------------------------------------------------------
// 戻り値型
// ----------------------------------------------------------

export interface PlayerAPI {
  play: (url: string, threadId: string, options?: PlayOptions) => void;
  playLive: (url: string, threadId: string, options?: PlayOptions) => void;
  playList: (
    urls: string[],
    threadId: string,
    options?: PlayListOptions,
  ) => void;
  next: () => void;
  prev: () => void;
  jumpTo: (index: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  addToPlaylist: (url: string) => void;
  removeFromPlaylist: (url: string) => void;
  pause: (slotId?: SlotId) => void;
  resume: (slotId?: SlotId) => void;
  stop: (slotId?: SlotId) => void;
  requestSeek: (slotId: SlotId, time: number) => void;
  restoreFromHistory: (queryKey: string) => void;
  registerMedia: (
    threadId: string,
    url: string,
    provider: Provider,
    providerId: string,
    postNo?: number,
  ) => void;
  unregisterMedia: (threadId: string, url: string) => void;
  toggleMediaChecked: (threadId: string, url: string) => void;
  setAllMediaChecked: (threadId: string, checked: boolean) => void;
  playChecked: (threadId: string, options?: PlayListOptions) => void;
  showMiniPlayer: () => void;
  hideMiniPlayer: () => void;
  currentMode: PlayMode | null;
  currentSubMode: PlayModeSub;
  currentTrack: Track | null;
  status: PlaybackStatus;
  playlist: PlaylistState;
  history: HistorySingleQuery[];
  isPlayableUrl: (url: string) => boolean;
}

// ----------------------------------------------------------
// パブリックAPIフック
// ----------------------------------------------------------

export function usePlayerAPI(): PlayerAPI {
  // location.pathname は play 系のみで使用
  const location = useLocation();

  // play 系関数は pathname をクロージャで参照するため useMemo で安定化
  // pathname が変わったときだけ再生成される
  const playActions = useMemo(() => {
    const play = (
      url: string,
      threadId: string,
      options: PlayOptions = {},
    ): void => {
      const track = urlToTrack(url);
      if (!track) return;

      const origin = buildOrigin(threadId, location.pathname, options.label);
      const { subMode = "none", slotId = "primary" } = options;
      const s = getStore();

      s.initFromQuery({
        queryKey: `single:${track.id}`,
        raw: url,
        mode: "single",
        subMode,
        origin,
        tracks: [track],
      });
      s.loadTrack(slotId, track);
      s.play(slotId);
      s.setMiniPlayerVisible(true);
    };

    const playLive = (
      url: string,
      threadId: string,
      options: PlayOptions = {},
    ): void => {
      const track = urlToTrack(url);
      if (!track) return;

      const origin = buildOrigin(threadId, location.pathname, options.label);
      const { subMode = "none", slotId = "primary" } = options;
      const s = getStore();

      s.initFromQuery({
        queryKey: `live:${track.id}`,
        raw: url,
        mode: "live",
        subMode,
        origin,
        tracks: [track],
      });
      s.loadTrack(slotId, track);
      s.play(slotId);
      s.setMiniPlayerVisible(true);
    };

    const playList = (
      urls: string[],
      threadId: string,
      options: PlayListOptions = {},
    ): void => {
      const {
        subMode = "none",
        startIndex = 0,
        slotId = "primary",
        playlistProvider = "youtube",
      } = options;
      // 連続再生は同一 provider 内に限定（同一プレイヤー要素を保持して src だけ
      // 差し替える方式のため）。登録段階で絞っているが二重の安全網。
      const tracks = urls
        .map(urlToTrack)
        .filter(
          (t): t is Track => t !== null && t.provider === playlistProvider,
        );
      if (tracks.length === 0) return;

      const origin = buildOrigin(threadId, location.pathname, options.label);
      // startIndex を [0, tracks.length-1] に正規化。
      // 範囲外のまま history に入ると、復元時に track を取得できなくなる。
      const safeIndex = Math.min(Math.max(startIndex, 0), tracks.length - 1);
      // queryKey には provider を含めて YouTube / internal の history 衝突を避ける
      const queryKey = `playlist:${playlistProvider}:${origin.threadId}:${tracks.map((t) => t.id).join(",")}`;
      const s = getStore();

      const query: PlayerQuery = {
        queryKey,
        raw: urls.join("\n"),
        mode: "playlist",
        subMode,
        origin,
        tracks,
      };

      s.initFromQuery(query);
      // 連続再生クエリを1個のクエリオブジェクトとして history に記録
      s.upsertHistory({ query, lastIndex: safeIndex, lastTime: 0 });
      if (safeIndex > 0) {
        s.jumpTo(safeIndex);
      }
      s.loadTrack(slotId, tracks[safeIndex]);
      s.play(slotId);
      s.setMiniPlayerVisible(true);
    };

    const playChecked = (
      threadId: string,
      options: PlayListOptions = {},
    ): void => {
      const urls = getStore().getCheckedUrls(threadId);
      if (urls.length === 0) return;
      playList(urls, threadId, options);
    };

    return { play, playLive, playList, playChecked };
  }, [location.pathname]);

  // 読み取り専用状態（必要なスライスだけ購読）
  const currentMode = usePlayerStore((s) => s.playlist.mode);
  const currentSubMode = usePlayerStore((s) => s.playlist.subMode);
  const currentTrack = usePlayerStore((s) => s.players.primary.currentTrack);
  const status = usePlayerStore((s) => s.players.primary.status);
  const playlist = usePlayerStore((s) => s.playlist);
  const history = usePlayerStore((s) => s.history);

  return {
    ...playActions,
    next: doNext,
    prev: doPrev,
    jumpTo: doJumpTo,
    toggleShuffle: doToggleShuffle,
    cycleRepeat: doCycleRepeat,
    addToPlaylist: doAddToPlaylist,
    removeFromPlaylist: doRemoveFromPlaylist,
    pause: doPause,
    resume: doResume,
    stop: doStop,
    requestSeek: doRequestSeek,
    restoreFromHistory: doRestoreFromHistory,
    registerMedia: doRegisterMedia,
    unregisterMedia: doUnregisterMedia,
    toggleMediaChecked: doToggleMediaChecked,
    setAllMediaChecked: doSetAllMediaChecked,
    showMiniPlayer: doShowMiniPlayer,
    hideMiniPlayer: doHideMiniPlayer,
    currentMode,
    currentSubMode,
    currentTrack,
    status,
    playlist,
    history,
    isPlayableUrl,
  };
}
