import { useEffect } from "react";
import {
  extractXTweetId,
  extractYouTubeId,
  isXUrl,
  isYouTubeUrl,
} from "@/shared/lib/linkUtils";
import type { OgpData } from "@/shared/types/ogp";

interface Props {
  ogp: OgpData;
}

export const OgpCard: React.FunctionComponent<Props> = ({ ogp }: Props) => {
  const ogpMetadata = ogp.data;

  // 文字列をパースして有効な正の数値のみを返す
  const parsePositiveNumber = (value?: string): number | undefined => {
    if (!value) return undefined;
    const num = parseInt(value, 10);
    return Number.isFinite(num) && num > 0 ? num : undefined;
  };

  const isYouTube = isYouTubeUrl(ogp.url);
  const youtubeId = isYouTube ? extractYouTubeId(ogp.url) : null;

  const isX = isXUrl(ogp.url);
  const tweetId = isX ? extractXTweetId(ogp.url) : null;

  // X/Twitter埋め込みスクリプトの読み込み
  useEffect(() => {
    if (!isX || !tweetId) return;

    // Twitter Widgetsスクリプトが既に読み込まれているかチェック
    if (!("twttr" in window)) {
      const script = document.createElement("script");
      script.src = "https://platform.twitter.com/widgets.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, [isX, tweetId]);

  // X/Twitter埋め込みの場合
  if (isX && tweetId) {
    return (
      <div className="max-w-lg my-3">
        <blockquote className="twitter-tweet" data-theme="dark">
          <a href={`https://twitter.com/x/status/${tweetId}`}>
            ツイートを読み込み中...
          </a>
        </blockquote>
      </div>
    );
  }

  // YouTube埋め込みの場合
  if (isYouTube && youtubeId) {
    // SSR環境エラーを防ぐため、ブラウザ側でのみオリジンを取得する
    const currentOrigin =
      typeof window !== "undefined" ? window.location.origin : "";
    return (
      <div className="border border-border rounded-lg overflow-hidden bg-card max-w-lg">
        <div className="aspect-video">
          <iframe
            // 1. ドメインを youtube-nocookie.com に変更
            // 2. クエリパラメータに origin を追加
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}?origin=${currentOrigin}&enablejsapi=1`}
            title={ogpMetadata?.title || "YouTube video"}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="w-full h-full"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
    );
  }

  // OGP情報がある場合のみ表示
  let ogpImageUrl = ogpMetadata.image || ogpMetadata.imageUrl;
  if (ogpImageUrl) {
    // 相対URLやプロトコル相対URLをOGPページのURL基準で絶対URLに変換
    try {
      ogpImageUrl = new URL(ogpImageUrl, ogp.url).toString();
    } catch {
      // URLのパースに失敗した場合は何もしない
    }
  }
  if (!ogpMetadata.title && !ogpMetadata.description && !ogpImageUrl) {
    return null;
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card max-w-lg">
      {/* OGP画像 */}
      {ogpImageUrl && (
        <a
          href={ogpImageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden"
        >
          <img
            src={ogpImageUrl}
            alt={ogpMetadata.title || ""}
            className="w-full h-auto object-cover max-h-64"
            loading="lazy"
            width={parsePositiveNumber(ogpMetadata.imageWidth)}
            height={parsePositiveNumber(ogpMetadata.imageHeight)}
          />
        </a>
      )}

      {/* リンク情報 */}
      <a
        href={ogp.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block p-3 hover:bg-muted/50 transition-colors"
      >
        {ogpMetadata.siteName && (
          <div className="text-xs text-muted-foreground mb-1">
            {ogpMetadata.siteName}
          </div>
        )}
        {ogpMetadata.title && (
          <div className="font-semibold text-foreground text-sm mb-1 line-clamp-2">
            {ogpMetadata.title}
          </div>
        )}
        {ogpMetadata.description && (
          <div className="text-xs text-muted-foreground line-clamp-2">
            {ogpMetadata.description}
          </div>
        )}
      </a>
    </div>
  );
};
