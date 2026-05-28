// ============================================================
// features/player/components/PlayerTrigger.tsx
// URL横に配置されるミニパネル。URLの種類と同時視聴オプションの
// 有無に応じてボタン構成を自動的に切り替える。
// ============================================================
// 呼び出し例:
//   <PlayerTrigger url={seg.href} threadId={threadId} postNo={postNumber} />
//
// 登録元は LineDisplay 内の外部リンクに限らず、
// post 添付動画など複数箇所から呼び出される。
// ============================================================

import { useEffect, useMemo } from "react";
import { MdFormatListBulleted, MdPictureInPicture } from "react-icons/md";
import { usePlayerAPI } from "../hooks/usePlayerAPI";
import { usePlayerStore } from "../stores/playerStore";
import { analyzeUrl } from "../utils/providerDetect";

// ----------------------------------------------------------
// Props
// ----------------------------------------------------------

interface PlayerTriggerProps {
  /** 対象URL */
  url: string;
  /** スレッドID（PostDisplay から number で渡される） */
  threadId: number;
  /** 元投稿のレス番号（プレイリスト並び順に使用） */
  postNo?: number;
  /** モーダル等のサブビュー内表示。プレイリスト登録・チェックボックスを無効化 */
  isSubView?: boolean;
}

// ----------------------------------------------------------
// コンポーネント
// ----------------------------------------------------------

export const PlayerTrigger: React.FunctionComponent<PlayerTriggerProps> = ({
  url,
  threadId,
  postNo,
  isSubView,
}: PlayerTriggerProps) => {
  const {
    play,
    playLive,
    playChecked,
    registerMedia,
    unregisterMedia,
    toggleMediaChecked,
  } = usePlayerAPI();

  // URL を分析（プロバイダー判定・ライブ判定・同時視聴パラメータ抽出）
  const analysis = useMemo(() => analyzeUrl(url), [url]);
  const { provider, providerId, isLive, hasDouji } = analysis;
  const isPlayable = provider !== null && providerId !== null;
  // 連続再生対応プロバイダー:
  //  - youtube  : 同一 iframe + loadVideoById で次曲遷移
  //  - internal : 同一 <video> + src 差し替えで次曲遷移（iOS は要 user-gesture 活性化）
  // 連続再生は同一 provider 内でのみ可（プレイヤー要素を再マウントせず使い回すため）
  const canPlaylist = provider === "youtube" || provider === "internal";

  // threadId は number で受け取るが、ストアのキーは string
  const threadIdStr = String(threadId);

  // ---- チェック状態の取得 ----
  // フックは常に呼ぶ（Rules of Hooks）。非対応URLやライブの場合は false になるだけ
  const checked = usePlayerStore(
    (s) =>
      s.mediaListInThread[threadIdStr]?.find((m) => m.url === url)?.checked ??
      false,
  );

  // ---- 同一 provider 内で1個目のメディアかどうか ----
  // 連続再生ボタンは provider グループの1個目にのみ表示する
  // （YouTube / internal の2グループが並行存在しうる）
  const isFirstMediaOfProvider = usePlayerStore((s) => {
    const list = s.mediaListInThread[threadIdStr];
    if (!list || !provider) return false;
    const firstOfProvider = list.find((m) => m.provider === provider);
    return firstOfProvider?.url === url;
  });

  // ---- メディア登録簿への登録/解除 ----
  // ライブ配信はプレイリストに含めないので登録しない
  //
  // registerMedia / unregisterMedia はモジュールレベルの安定参照のため
  // 依存配列に含めても安全（参照が変わらない）。
  useEffect(() => {
    if (!isPlayable || isLive || !provider || !providerId || isSubView) return;
    // 連続再生候補は YouTube または internal のみ登録する
    if (!canPlaylist) return;
    registerMedia(threadIdStr, url, provider, providerId, postNo);
    return (): void => unregisterMedia(threadIdStr, url);
  }, [
    threadIdStr,
    url,
    provider,
    providerId,
    postNo,
    isLive,
    isPlayable,
    isSubView,
    canPlaylist,
    registerMedia,
    unregisterMedia,
  ]);

  // 非対応URLなら何も描画しない（フックの後で判定）
  if (!isPlayable) return null;

  // ---- ボタン構成の決定 ----
  if (isLive) {
    return (
      <LiveTriggerPanel
        hasDouji={hasDouji}
        onPlayLive={(): void => playLive(url, threadIdStr)}
        onPlayDualSync={(): void =>
          playChecked(threadIdStr, { subMode: "sync_dual" })
        }
      />
    );
  }

  return (
    <VideoTriggerPanel
      hasDouji={hasDouji}
      canPlaylist={canPlaylist}
      checked={checked}
      isFirstMediaOfProvider={isFirstMediaOfProvider}
      isSubView={isSubView}
      onToggleChecked={(): void => toggleMediaChecked(threadIdStr, url)}
      onPlaySingle={(): void => play(url, threadIdStr)}
      onPlayPlaylist={(): void =>
        playChecked(threadIdStr, { playlistProvider: provider ?? undefined })
      }
      onPlaySingleSync={(): void => play(url, threadIdStr, { subMode: "sync" })}
      onPlayPlaylistSync={(): void =>
        playChecked(threadIdStr, {
          subMode: "sync",
          playlistProvider: provider ?? undefined,
        })
      }
    />
  );
};

// ----------------------------------------------------------
// 単品動画URL用パネル
// ----------------------------------------------------------

interface VideoTriggerPanelProps {
  hasDouji: boolean;
  canPlaylist: boolean;
  checked: boolean;
  /** 同一 provider グループ内で1個目のメディアかどうか（連続再生ボタンの表示制御） */
  isFirstMediaOfProvider: boolean;
  isSubView?: boolean;
  onToggleChecked: () => void;
  onPlaySingle: () => void;
  onPlayPlaylist: () => void;
  onPlaySingleSync: () => void;
  onPlayPlaylistSync: () => void;
}

const VideoTriggerPanel: React.FunctionComponent<VideoTriggerPanelProps> = ({
  hasDouji,
  canPlaylist,
  checked,
  isFirstMediaOfProvider,
  isSubView,
  onToggleChecked,
  onPlaySingle,
  onPlayPlaylist,
  onPlaySingleSync,
  onPlayPlaylistSync,
}: VideoTriggerPanelProps) => {
  return (
    <span className="inline-flex items-center gap-1 ml-1 align-middle">
      <TriggerButton onClick={onPlaySingle} title="再生">
        <MdPictureInPicture className="w-7 h-5 text-primary" /> 再生
      </TriggerButton>

      {!isSubView && canPlaylist && isFirstMediaOfProvider && (
        <TriggerButton onClick={onPlayPlaylist} title="連続再生">
          <MdFormatListBulleted className="w-7 h-5 text-primary" /> 連続再生
        </TriggerButton>
      )}

      {hasDouji && (
        <>
          <TriggerButton onClick={onPlaySingleSync} title="同時視聴">
            <MdPictureInPicture className="w-7 h-5 text-destructive" /> 同時視聴
          </TriggerButton>
          {!isSubView && canPlaylist && isFirstMediaOfProvider && (
            <TriggerButton
              onClick={onPlayPlaylistSync}
              title="連続再生+同時視聴:未実装"
            >
              <MdFormatListBulleted className="w-7 h-5 text-destructive" />{" "}
              連続再生同時視聴:未実装
            </TriggerButton>
          )}
        </>
      )}

      {!isSubView && canPlaylist && (
        <label
          className="inline-flex items-center gap-1.5 text-xs cursor-pointer select-none"
          title="連続再生に含める"
        >
          連続再生
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggleChecked}
            className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
          />
        </label>
      )}
    </span>
  );
};

// ----------------------------------------------------------
// 配信URL用パネル
// ----------------------------------------------------------

interface LiveTriggerPanelProps {
  hasDouji: boolean;
  onPlayLive: () => void;
  onPlayDualSync: () => void;
}

const LiveTriggerPanel: React.FunctionComponent<LiveTriggerPanelProps> = ({
  hasDouji,
  onPlayLive,
  onPlayDualSync,
}: LiveTriggerPanelProps) => {
  return (
    <span className="inline-flex items-center gap-1 ml-1 align-middle">
      <TriggerButton onClick={onPlayLive} title="配信を再生">
        <MdPictureInPicture className="w-7 h-5 text-primary" /> Live
      </TriggerButton>

      {hasDouji && (
        <TriggerButton onClick={onPlayDualSync} title="連続再生+同時視聴+配信">
          <MdFormatListBulleted className="w-7 h-5 text-destructive" /> Live +
          動画同時視聴
        </TriggerButton>
      )}
    </span>
  );
};

// ----------------------------------------------------------
// 共通ボタン
// ----------------------------------------------------------

interface TriggerButtonProps {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}

const TriggerButton: React.FunctionComponent<TriggerButtonProps> = ({
  onClick,
  title,
  children,
}: TriggerButtonProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center h-9 min-w-9 justify-center px-2 py-0.5 text-18px leading-none rounded border border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    >
      {children}
    </button>
  );
};
