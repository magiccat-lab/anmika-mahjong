/** SPA 長寿タブ対策 [2026-07-22 リョー実害: 1日前のバンドルのままのタブで「直ってない」誤認]。
 *
 *  build 時に `dist/version.json` を吐き、起動中の client が定期 fetch して
 *  初回取得値との差分でリロード案内トーストを出す。
 *
 *  設計方針:
 *  - 対局を邪魔しない。検知しても勝手にリロードしない [通知するだけ]
 *  - タブが非表示の間は fetch しない。表示に戻った瞬間に1回追いつく
 *  - fetch 失敗 [オフライン / 502 / deploy 中の一瞬の 404] は黙って無視。トーストを暴発させない
 *  - 一度検知したら watch を止める [それ以上見る意味がない]
 */

export const VERSION_JSON_URL = '/version.json';
/** 5分。長寿タブ対策なので秒単位の即応性は要らない */
export const VERSION_POLL_INTERVAL_MS = 300_000;

export type VersionWatchHandle = {
  /** 手動チェック [テスト / 表示復帰時に使う]。戻り値は「新版を検知したか」 */
  checkNow: () => Promise<boolean>;
  stop: () => void;
};

export type VersionWatchOptions = {
  onNewVersion: () => void;
  intervalMs?: number;
  url?: string;
  fetchImpl?: typeof fetch;
  /** タブ非表示なら true。省略時は document.visibilityState を見る */
  isHidden?: () => boolean;
  /** 表示状態が変わったら listener を呼ぶ購読。戻り値は解除関数 */
  onVisibilityChange?: (listener: () => void) => () => void;
};

function defaultIsHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function defaultOnVisibilityChange(listener: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

export function startVersionWatch(opts: VersionWatchOptions): VersionWatchHandle {
  const url = opts.url ?? VERSION_JSON_URL;
  const intervalMs = opts.intervalMs ?? VERSION_POLL_INTERVAL_MS;
  const doFetch = opts.fetchImpl ?? ((typeof fetch !== 'undefined' ? fetch : null) as typeof fetch | null);
  const isHidden = opts.isHidden ?? defaultIsHidden;
  const subscribeVisibility = opts.onVisibilityChange ?? defaultOnVisibilityChange;

  let bootVersion: string | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeVisibility: (() => void) | null = null;

  const stop = (): void => {
    stopped = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (unsubscribeVisibility) unsubscribeVisibility();
    unsubscribeVisibility = null;
  };

  const checkNow = async (): Promise<boolean> => {
    if (stopped || !doFetch) return false;
    let version: string;
    try {
      // cache: no-store + cache-buster query。 CDN / bfcache 越しの stale を踏まない
      const res = await doFetch(`${url}?ts=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return false;
      const body = await res.json();
      version = String((body as { v?: unknown } | null)?.v ?? '');
    } catch {
      return false; // オフライン等。黙って無視する
    }
    if (!version || stopped) return false;
    if (bootVersion === null) {
      bootVersion = version;
      return false;
    }
    if (version === bootVersion) return false;
    stop();
    opts.onNewVersion();
    return true;
  };

  void checkNow();
  timer = setInterval(() => {
    if (isHidden()) return; // 非表示タブでは polling しない
    void checkNow();
  }, intervalMs);
  unsubscribeVisibility = subscribeVisibility(() => {
    if (isHidden()) return;
    void checkNow(); // 表示に戻った瞬間に1回追いつく
  });

  return { checkNow, stop };
}
