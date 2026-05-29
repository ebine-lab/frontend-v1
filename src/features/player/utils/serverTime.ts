// ============================================================
// features/player/utils/serverTime.ts
// 同時視聴用のサーバー時刻オフセット取得・キャッシュ
// ============================================================
//
// 同期計算は PC のローカル時計（Date.now()）を基準にしているため、
// 視聴者の PC 時計がずれていると同期位置そのものが丸ごとずれる。
// 同時視聴開始時に 1 回だけ外部の正確な時刻を取得し、PC時計との
// 差分（オフセット）をモジュールキャッシュして補正する。
//
// 取得に失敗した場合はオフセット 0（= PC時刻）にフォールバックするため、
// 同期は従来どおり動作する（退行なし）。
//
// 時刻ソース: timeapi.io（CORS対応・APIキー不要）を JST で取得し、
//   extractDoujiTime と同じ JST(+9)→UTC epoch 変換で絶対時刻を得る。
// ============================================================

const TIME_API_URL =
  "https://timeapi.io/api/Time/current/zone?timeZone=Asia/Tokyo";
const FETCH_TIMEOUT_MS = 5000;

/** serverEpochMs - localEpochMs。null = 未取得（PC時刻を使用） */
let cachedOffsetMs: number | null = null;
/** 取得中の Promise（同時呼び出しを束ねる） */
let inFlight: Promise<void> | null = null;

/** timeapi.io のレスポンス（必要なフィールドのみ） */
interface TimeApiResponse {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  seconds: number;
  milliSeconds: number;
}

/**
 * JST の各時刻フィールドから UTC epoch ms を算出する。
 * extractDoujiTime と同じ JST(+9)→UTC 変換方式に揃える。
 * @returns epoch ms。フィールド不正なら null
 */
function jstFieldsToEpochMs(d: Partial<TimeApiResponse>): number | null {
  const { year, month, day, hour, minute, seconds, milliSeconds } = d;
  const required = [year, month, day, hour, minute, seconds];
  if (required.some((v) => typeof v !== "number" || Number.isNaN(v))) {
    return null;
  }
  // 値域検証。Date.UTC は範囲外の値を黙って正規化（例: month=13 → 翌年）
  // してしまうため、不正なペイロードを誤ったオフセットに採用しないよう弾く。
  const inRange =
    (year as number) >= 1970 &&
    (month as number) >= 1 &&
    (month as number) <= 12 &&
    (day as number) >= 1 &&
    (day as number) <= 31 &&
    (hour as number) >= 0 &&
    (hour as number) <= 23 &&
    (minute as number) >= 0 &&
    (minute as number) <= 59 &&
    (seconds as number) >= 0 &&
    (seconds as number) <= 59;
  if (!inRange) {
    return null;
  }
  const ms = Date.UTC(
    year as number,
    (month as number) - 1,
    day as number,
    (hour as number) - 9,
    minute as number,
    seconds as number,
    typeof milliSeconds === "number" ? milliSeconds : 0,
  );
  return Number.isNaN(ms) ? null : ms;
}

/**
 * サーバー時刻オフセットを 1 回だけ取得してキャッシュする。
 * 取得済みなら即 return。取得中なら同じ Promise を共有する。
 * 失敗時は cachedOffsetMs を null のまま据え置き（次回開始で再試行可能）。
 */
export function primeServerTimeOffset(): Promise<void> {
  if (cachedOffsetMs !== null) return Promise.resolve();
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const t0 = Date.now();
      const res = await fetch(TIME_API_URL, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const t1 = Date.now();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as Partial<TimeApiResponse>;
      const serverEpochMs = jstFieldsToEpochMs(data);
      if (serverEpochMs === null) throw new Error("invalid time payload");

      // ラウンドトリップ遅延を半分で補正（送信〜受信の中点を基準にする）
      const localMid = (t0 + t1) / 2;
      cachedOffsetMs = serverEpochMs - localMid;
    } catch {
      // 取得失敗時は PC時刻にフォールバック（オフセット 0 扱い）。
      // cachedOffsetMs は null のまま据え置き、次回開始時に再試行できる。
    } finally {
      clearTimeout(timer);
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * オフセット補正済みの現在時刻（epoch ms）を返す。
 * 未取得時は PC時刻をそのまま返す。
 */
export function getSyncedNow(): number {
  return Date.now() + (cachedOffsetMs ?? 0);
}
