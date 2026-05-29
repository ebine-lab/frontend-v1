// ============================================================
// features/player/stores/playerStore.ts
// Zustand ストア + 型定義
// ============================================================
// 4スライス構成:
//   1. PlayerSlice          — 再生インスタンスの状態管理
//   2. PlaylistSlice        — プレイリスト・モード管理
//   3. HistoryList          — クエリ履歴（永続化対象）
//   4. MediaListInThread    — スレッド内メディアURL登録簿
// ============================================================

import { create } from "zustand";
import { persist, subscribeWithSelector } from "zustand/middleware";

// ----------------------------------------------------------
// 共通型
// ----------------------------------------------------------

/** 動画プロバイダー */
export type Provider =
  | "youtube"
  | "twitch"
  | "nicovideo"
  | "internal"
  | "external_audio";

/** 再生モード — クエリから一意に決定 */
export type PlayMode =
  | "single" // 単品再生
  | "live" // ライブ再生
  | "playlist"; // プレイリスト再生

/** 再生サブモード（PlayMode の子分類） */
export type PlayModeSub =
  | "none" // サブモードなし
  | "sync" // 同時視聴
  | "sync_dual"; // 同時視聴 + Twitch 2面

/** 再生元情報 — 「再生元スレッドに戻る」+ プレイリスト区別に使用 */
export interface PlayOrigin {
  /** スレッドID（カタログDJ等の拡張時は板IDも想定） */
  threadId: string;
  /** 遷移用パス */
  path: string;
  /** 表示用ラベル（スレタイの先頭N文字など） */
  label?: string;
}

/** 再生対象トラック */
export interface Track {
  id: string;
  provider: Provider;
  /** プロバイダー固有のID（YouTube video ID, Twitch channel名 等） */
  providerId: string;
  /** 表示用タイトル */
  title?: string;
  /** サムネURL */
  thumbnail?: string;
  /** 秒数（不明なら undefined） */
  duration?: number;
  /** 元投稿のレス番号 */
  postNo?: number;
  /** 同時視聴の再生基準時刻（epoch ms, UTC）。未設定 = 同時視聴対象外 */
  syncStartTime?: number;
}

// ----------------------------------------------------------
// 1. PlayerSlice — 再生インスタンス管理
// ----------------------------------------------------------

export type SlotId = "primary" | "secondary";

export type PlaybackStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export interface PlayerInstance {
  slotId: SlotId;
  status: PlaybackStatus;
  currentTrack: Track | null;
  /** 現在の再生位置（秒） */
  currentTime: number;
  /** 音量 0-1 */
  volume: number;
  muted: boolean;
  /** 再生速度（1 = 等倍）。同時視聴の追従でアダプターに反映される */
  playbackRate: number;
  /** シーク要求（null = 要求なし）。アダプターが消費後に clearSeekTarget する */
  seekTarget: number | null;
}

// ----------------------------------------------------------
// 2. PlaylistSlice — プレイリスト・モード管理
// ----------------------------------------------------------

export interface PlaylistState {
  /** 現在のモード（null = 未起動） */
  mode: PlayMode | null;
  /** 起動元クエリのキー（history 更新の参照に使用。null = 未起動） */
  queryKey: string | null;
  /** 再生サブモード */
  subMode: PlayModeSub;
  /** 再生元情報 */
  origin: PlayOrigin | null;
  /** プレイリストのトラック一覧（single/live では要素1つ） */
  tracks: Track[];
  /** 現在のトラックインデックス */
  currentIndex: number;
  /** シャッフル有効 */
  shuffle: boolean;
  /** リピートモード */
  repeat: "none" | "all" | "one";
  /** シャッフル時の再生順序 */
  shuffleOrder: number[];
}

// ----------------------------------------------------------
// 3. HistoryList — クエリ履歴（永続化対象）
// ----------------------------------------------------------

/** 再生クエリ — API に渡す情報の正規化形 */
export interface PlayerQuery {
  /** クエリの一意キー（モード+パラメータから生成） */
  queryKey: string;
  /** 元のクエリ文字列（URLパラメータ等） */
  raw: string;
  /** 解決されたモード */
  mode: PlayMode;
  subMode: PlayModeSub;
  /** 再生元 */
  origin: PlayOrigin;
  /** トラック情報（複数の場合あり） */
  tracks: Track[];
}

export interface HistorySingleQuery {
  query: PlayerQuery;
  /** 最後に再生していたトラックのインデックス */
  lastIndex: number;
  /** 最後の再生位置（秒） */
  lastTime: number;
  /** 最終アクセス日時（ISO 8601） */
  accessedAt: string;
}

// ----------------------------------------------------------
// 4. MediaListInThread — スレッド内メディアURL登録簿
// ----------------------------------------------------------
// PlayerTrigger がマウント時に登録、アンマウント時に解除。
// 登録元は LineDisplay 内の外部リンクに限らず、
// post 添付動画など複数箇所から登録される。

/** スレッド内の個々のメディアエントリ */
export interface MediaEntryInThread {
  /** 元URL */
  url: string;
  /** Track ID（provider:providerId 形式） */
  trackId: string;
  /** プロバイダー種別 */
  provider: Provider;
  /** プレイリストに含めるか（デフォルト: true） */
  checked: boolean;
  /** 元投稿のレス番号（並び順に使用） */
  postNo?: number;
}

// ----------------------------------------------------------
// 5. MiniPlayerState — ミニプレイヤー UI 状態
// ----------------------------------------------------------

export type MiniPlayerPosition = "br" | "tr" | "tl" | "bl";

export interface MiniPlayerState {
  /** 表示中か */
  visible: boolean;
  /** 画面4隅のポジション */
  position: MiniPlayerPosition;
  /** サイズインデックス（0=sm, 1=md, 2=lg, 3=xs「豆」） */
  sizeIndex: number;
  /** 画面外スタッシュ中か（現在の隅から画面端外へ収納） */
  stashed: boolean;
}

// ----------------------------------------------------------
// 統合ストア型
// ----------------------------------------------------------

export interface PlayerStore {
  // ---- PlayerSlice 状態 ----
  players: Record<SlotId, PlayerInstance>;

  // ---- PlaylistSlice 状態 ----
  playlist: PlaylistState;

  // ---- HistoryList 状態 ----
  history: HistorySingleQuery[];
  maxHistorySize: number;

  // ---- MiniPlayer 状態 ----
  miniPlayer: MiniPlayerState;

  // ---- PlayerSlice アクション ----
  loadTrack: (slotId: SlotId, track: Track) => void;
  play: (slotId: SlotId) => void;
  pause: (slotId: SlotId) => void;
  seek: (slotId: SlotId, time: number) => void;
  setVolume: (slotId: SlotId, volume: number) => void;
  setMuted: (slotId: SlotId, muted: boolean) => void;
  setPlaybackRate: (slotId: SlotId, rate: number) => void;
  setStatus: (slotId: SlotId, status: PlaybackStatus) => void;
  updateTime: (slotId: SlotId, time: number) => void;
  requestSeek: (slotId: SlotId, time: number) => void;
  clearSeekTarget: (slotId: SlotId) => void;
  resetSlot: (slotId: SlotId) => void;

  // ---- PlaylistSlice アクション ----
  initFromQuery: (query: PlayerQuery) => void;
  next: () => void;
  prev: () => void;
  jumpTo: (index: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  appendTrack: (track: Track) => void;
  removeTrack: (trackId: string) => void;
  clearMode: () => void;

  // ---- HistoryList アクション ----
  upsertHistory: (entry: Omit<HistorySingleQuery, "accessedAt">) => void;
  restoreFromHistory: (queryKey: string) => void;
  removeHistory: (queryKey: string) => void;
  clearHistory: () => void;

  // ---- MediaListInThread 状態 ----
  /** threadId → メディアエントリ配列 */
  mediaListInThread: Record<string, MediaEntryInThread[]>;

  // ---- MediaListInThread アクション ----
  /** メディアを登録（PlayerTrigger マウント時）。checked は true で初期化 */
  registerMedia: (
    threadId: string,
    entry: Omit<MediaEntryInThread, "checked">,
  ) => void;
  /** メディアを解除（PlayerTrigger アンマウント時） */
  unregisterMedia: (threadId: string, url: string) => void;
  /** チェック状態を個別トグル */
  toggleMediaChecked: (threadId: string, url: string) => void;
  /** スレッド内の全チェック状態を一括設定 */
  setAllMediaChecked: (threadId: string, checked: boolean) => void;
  /** チェック済みURLの一覧を取得（postNo 昇順） */
  getCheckedUrls: (threadId: string) => string[];
  /** スレッドのメディア登録簿をクリア（スレッド離脱時等） */
  clearMediaList: (threadId: string) => void;

  // ---- MiniPlayer アクション ----
  /** MiniPlayer の表示/非表示を設定 */
  setMiniPlayerVisible: (visible: boolean) => void;
  /** MiniPlayer の4隅ポジションを設定 */
  setMiniPlayerPosition: (position: MiniPlayerPosition) => void;
  /** MiniPlayer のサイズを巡回切り替え（sm → md → lg → xs「豆」→ sm） */
  cycleMiniPlayerSize: () => void;
  /** MiniPlayer の画面外スタッシュ状態を設定 */
  setMiniPlayerStashed: (stashed: boolean) => void;
}

// ----------------------------------------------------------
// 初期値
// ----------------------------------------------------------

const createInitialPlayerInstance = (slotId: SlotId): PlayerInstance => ({
  slotId,
  status: "idle",
  currentTrack: null,
  currentTime: 0,
  volume: 1,
  playbackRate: 1,
  seekTarget: null,
  muted: false,
});

const initialMiniPlayerState: MiniPlayerState = {
  visible: false,
  position: "br",
  sizeIndex: 1, // デフォルト「中」
  stashed: false,
};

const initialPlaylistState: PlaylistState = {
  mode: null,
  queryKey: null,
  subMode: "none",
  origin: null,
  tracks: [],
  currentIndex: 0,
  shuffle: false,
  repeat: "none",
  shuffleOrder: [],
};

// ----------------------------------------------------------
// ストア実装
// ----------------------------------------------------------

// biome-ignore lint/nursery/useExplicitType: 型が長いので推論に任せる
export const usePlayerStore = create<PlayerStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        // ---- 初期状態 ----
        players: {
          primary: createInitialPlayerInstance("primary"),
          secondary: createInitialPlayerInstance("secondary"),
        },
        playlist: { ...initialPlaylistState },
        history: [],
        maxHistorySize: 200,
        mediaListInThread: {},
        miniPlayer: { ...initialMiniPlayerState },

        // ---- PlayerSlice アクション ----
        loadTrack: (slotId: SlotId, track: Track) =>
          set((state) => ({
            players: {
              ...state.players,
              [slotId]: {
                ...state.players[slotId],
                currentTrack: track,
                status: "loading" as const,
                currentTime: 0,
              },
            },
          })),

        play: (slotId: SlotId) =>
          set((state) => ({
            players: {
              ...state.players,
              [slotId]: {
                ...state.players[slotId],
                status: "playing" as const,
              },
            },
          })),

        pause: (slotId: SlotId) =>
          set((state) => ({
            players: {
              ...state.players,
              [slotId]: {
                ...state.players[slotId],
                status: "paused" as const,
              },
            },
          })),

        seek: (slotId: SlotId, time: number) =>
          set((state) => ({
            players: {
              ...state.players,
              [slotId]: { ...state.players[slotId], currentTime: time },
            },
          })),

        setVolume: (slotId: SlotId, volume: number) =>
          set((state) => ({
            players: {
              ...state.players,
              [slotId]: { ...state.players[slotId], volume },
            },
          })),

        setMuted: (slotId: SlotId, muted: boolean) =>
          set((state) => ({
            players: {
              ...state.players,
              [slotId]: { ...state.players[slotId], muted },
            },
          })),

        setPlaybackRate: (slotId: SlotId, rate: number) =>
          set((state) => ({
            players: {
              ...state.players,
              [slotId]: { ...state.players[slotId], playbackRate: rate },
            },
          })),

        setStatus: (slotId: SlotId, status: PlaybackStatus) =>
          set((state) => ({
            players: {
              ...state.players,
              [slotId]: { ...state.players[slotId], status },
            },
          })),

        updateTime: (slotId: SlotId, time: number) =>
          set((state) => ({
            players: {
              ...state.players,
              [slotId]: { ...state.players[slotId], currentTime: time },
            },
          })),

        requestSeek: (slotId: SlotId, time: number) =>
          set((state) => ({
            players: {
              ...state.players,
              [slotId]: { ...state.players[slotId], seekTarget: time },
            },
          })),

        clearSeekTarget: (slotId: SlotId) =>
          set((state) => ({
            players: {
              ...state.players,
              [slotId]: { ...state.players[slotId], seekTarget: null },
            },
          })),

        resetSlot: (slotId: SlotId) =>
          set((state) => ({
            players: {
              ...state.players,
              [slotId]: createInitialPlayerInstance(slotId),
            },
          })),

        // ---- PlaylistSlice アクション ----
        initFromQuery: (query: PlayerQuery) =>
          set({
            playlist: {
              mode: query.mode,
              queryKey: query.queryKey,
              subMode: query.subMode,
              origin: query.origin,
              tracks: query.tracks,
              currentIndex: 0,
              shuffle: false,
              repeat: "none",
              shuffleOrder: [],
            },
          }),

        next: () =>
          set((state) => {
            const { tracks, currentIndex, repeat, shuffle, shuffleOrder } =
              state.playlist;
            if (tracks.length === 0) return state;

            let nextIndex: number;
            if (repeat === "one") {
              nextIndex = currentIndex;
            } else if (shuffle && shuffleOrder.length > 0) {
              const orderPos = shuffleOrder.indexOf(currentIndex);
              const nextOrderPos = orderPos + 1;
              if (nextOrderPos >= shuffleOrder.length) {
                nextIndex = repeat === "all" ? shuffleOrder[0] : currentIndex;
              } else {
                nextIndex = shuffleOrder[nextOrderPos];
              }
            } else {
              nextIndex = currentIndex + 1;
              if (nextIndex >= tracks.length) {
                nextIndex = repeat === "all" ? 0 : currentIndex;
              }
            }

            return {
              playlist: { ...state.playlist, currentIndex: nextIndex },
            };
          }),

        prev: () =>
          set((state) => {
            const { tracks, currentIndex, shuffle, shuffleOrder } =
              state.playlist;
            if (tracks.length === 0) return state;

            let prevIndex: number;
            if (shuffle && shuffleOrder.length > 0) {
              const orderPos = shuffleOrder.indexOf(currentIndex);
              prevIndex =
                orderPos > 0
                  ? shuffleOrder[orderPos - 1]
                  : shuffleOrder[shuffleOrder.length - 1];
            } else {
              prevIndex =
                currentIndex > 0 ? currentIndex - 1 : tracks.length - 1;
            }

            return {
              playlist: { ...state.playlist, currentIndex: prevIndex },
            };
          }),

        jumpTo: (index: number) =>
          set((state) => ({
            playlist: {
              ...state.playlist,
              currentIndex: Math.max(
                0,
                Math.min(index, state.playlist.tracks.length - 1),
              ),
            },
          })),

        toggleShuffle: () =>
          set((state) => {
            const newShuffle = !state.playlist.shuffle;
            let shuffleOrder: number[] = [];

            if (newShuffle) {
              // Fisher-Yates シャッフル
              shuffleOrder = state.playlist.tracks.map((_, i) => i);
              for (let i = shuffleOrder.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffleOrder[i], shuffleOrder[j]] = [
                  shuffleOrder[j],
                  shuffleOrder[i],
                ];
              }
              // 現在再生中のトラックを強制的に先頭（track1）へ。
              // 再生中トラックは維持したまま以降をランダム順で続ける。
              const cur = state.playlist.currentIndex;
              const pos = shuffleOrder.indexOf(cur);
              if (pos > 0) {
                shuffleOrder.splice(pos, 1);
                shuffleOrder.unshift(cur);
              }
            }

            return {
              playlist: {
                ...state.playlist,
                shuffle: newShuffle,
                shuffleOrder,
              },
            };
          }),

        cycleRepeat: () =>
          set((state) => {
            const order: Array<"none" | "all" | "one"> = ["none", "all", "one"];
            const current = order.indexOf(state.playlist.repeat);
            const next = order[(current + 1) % order.length];
            return {
              playlist: { ...state.playlist, repeat: next },
            };
          }),

        appendTrack: (track: Track) =>
          set((state) => ({
            playlist: {
              ...state.playlist,
              tracks: [...state.playlist.tracks, track],
              // トラック構成が変わるためシャッフル順序を無効化
              shuffle: false,
              shuffleOrder: [],
            },
          })),

        removeTrack: (trackId: string) =>
          set((state) => {
            const newTracks = state.playlist.tracks.filter(
              (t) => t.id !== trackId,
            );
            // 現在再生中のトラックを新配列内で再特定
            const currentTrackId =
              state.playlist.tracks[state.playlist.currentIndex]?.id;
            let newIndex = newTracks.findIndex((t) => t.id === currentTrackId);
            if (newIndex < 0) {
              newIndex = Math.min(
                state.playlist.currentIndex,
                Math.max(0, newTracks.length - 1),
              );
            }
            return {
              playlist: {
                ...state.playlist,
                tracks: newTracks,
                currentIndex: newIndex,
                // シャッフル順序はトラック構成が変わるため無効化
                shuffle: false,
                shuffleOrder: [],
              },
            };
          }),

        clearMode: () => set({ playlist: { ...initialPlaylistState } }),

        // ---- HistoryList アクション ----
        upsertHistory: (entry: Omit<HistorySingleQuery, "accessedAt">) =>
          set((state) => {
            const now = new Date().toISOString();
            const existing = state.history.findIndex(
              (h) => h.query.queryKey === entry.query.queryKey,
            );

            let newHistory: HistorySingleQuery[];
            const newEntry: HistorySingleQuery = {
              ...entry,
              accessedAt: now,
            };

            if (existing >= 0) {
              // 既存を更新して先頭に移動
              newHistory = [
                newEntry,
                ...state.history.filter((_, i) => i !== existing),
              ];
            } else {
              newHistory = [newEntry, ...state.history];
            }

            // 件数上限を適用
            if (newHistory.length > state.maxHistorySize) {
              newHistory = newHistory.slice(0, state.maxHistorySize);
            }

            return { history: newHistory };
          }),

        restoreFromHistory: (queryKey: string) => {
          const state = get();
          const entry = state.history.find(
            (h) => h.query.queryKey === queryKey,
          );
          if (!entry) return;

          // PlaylistSlice を復元
          state.initFromQuery(entry.query);
          state.jumpTo(entry.lastIndex);

          // PlayerSlice にトラックをロード（自動再生はしない）
          const track = entry.query.tracks[entry.lastIndex];
          if (track) {
            state.loadTrack("primary", track);
            // status は 'loading' のまま — ユーザーが再生ボタンを押すまで待機
          }
        },

        removeHistory: (queryKey: string) =>
          set((state) => ({
            history: state.history.filter((h) => h.query.queryKey !== queryKey),
          })),

        clearHistory: () => set({ history: [] }),

        // ---- MediaListInThread アクション ----
        registerMedia: (
          threadId: string,
          entry: Omit<MediaEntryInThread, "checked">,
        ) =>
          set((state) => {
            const list = state.mediaListInThread[threadId] ?? [];
            // 同一URLの重複登録を防止
            if (list.some((m) => m.url === entry.url)) return state;
            return {
              mediaListInThread: {
                ...state.mediaListInThread,
                [threadId]: [...list, { ...entry, checked: true }],
              },
            };
          }),

        unregisterMedia: (threadId: string, url: string) =>
          set((state) => {
            const list = state.mediaListInThread[threadId];
            if (!list) return state;
            const newList = list.filter((m) => m.url !== url);
            return {
              mediaListInThread: {
                ...state.mediaListInThread,
                [threadId]: newList,
              },
            };
          }),

        toggleMediaChecked: (threadId: string, url: string) =>
          set((state) => {
            const list = state.mediaListInThread[threadId];
            if (!list) return state;
            return {
              mediaListInThread: {
                ...state.mediaListInThread,
                [threadId]: list.map((m) =>
                  m.url === url ? { ...m, checked: !m.checked } : m,
                ),
              },
            };
          }),

        setAllMediaChecked: (threadId: string, checked: boolean) =>
          set((state) => {
            const list = state.mediaListInThread[threadId];
            if (!list) return state;
            return {
              mediaListInThread: {
                ...state.mediaListInThread,
                [threadId]: list.map((m) => ({ ...m, checked })),
              },
            };
          }),

        getCheckedUrls: (threadId: string) => {
          const list = get().mediaListInThread[threadId] ?? [];
          return list
            .filter((m) => m.checked)
            .sort((a, b) => (a.postNo ?? 0) - (b.postNo ?? 0))
            .map((m) => m.url);
        },

        clearMediaList: (threadId: string) =>
          set((state) => {
            const rest = { ...state.mediaListInThread };
            delete rest[threadId];
            return { mediaListInThread: rest };
          }),

        // ---- MiniPlayer アクション ----
        setMiniPlayerVisible: (visible: boolean) =>
          set((state) => ({
            // 新規再生で表示する際はスタッシュを解除して必ず見える状態にする
            miniPlayer: {
              ...state.miniPlayer,
              visible,
              stashed: visible ? false : state.miniPlayer.stashed,
            },
          })),

        setMiniPlayerPosition: (position: MiniPlayerPosition) =>
          set((state) => ({
            miniPlayer: { ...state.miniPlayer, position },
          })),

        cycleMiniPlayerSize: () =>
          set((state) => ({
            miniPlayer: {
              ...state.miniPlayer,
              sizeIndex: (state.miniPlayer.sizeIndex + 1) % 4,
            },
          })),

        setMiniPlayerStashed: (stashed: boolean) =>
          set((state) => ({
            miniPlayer: { ...state.miniPlayer, stashed },
          })),
      }),
      {
        name: "player-store",
        // 永続化対象を履歴のみに限定
        partialize: (state: PlayerStore) => ({
          history: state.history,
          maxHistorySize: state.maxHistorySize,
        }),
      },
    ),
  ),
);
