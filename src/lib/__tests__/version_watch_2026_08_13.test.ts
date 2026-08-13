import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startVersionWatch } from '../versionWatch';

// SPA 長寿タブ対策 [2026-07-22 リョー実害] の回帰テスト。
// 「トーストが暴発しない」「非表示タブで polling しない」が守りたい線

type FetchCall = { url: string; init?: RequestInit };

function makeFetch(responses: Array<() => Promise<unknown> | unknown>) {
  const calls: FetchCall[] = [];
  let i = 0;
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const step = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return await step();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ok = (v: unknown) => () => ({ ok: true, json: async () => ({ v }) });
const notOk = () => ({ ok: false, json: async () => ({}) });
const boom = () => {
  throw new Error('offline');
};

let visibilityListeners: Array<() => void>;
let hidden: boolean;

function watchOpts(fetchImpl: typeof fetch, onNewVersion: () => void, intervalMs = 1000) {
  return {
    onNewVersion,
    intervalMs,
    fetchImpl,
    isHidden: () => hidden,
    onVisibilityChange: (listener: () => void) => {
      visibilityListeners.push(listener);
      return () => {
        visibilityListeners = visibilityListeners.filter((l) => l !== listener);
      };
    },
  };
}

beforeEach(() => {
  visibilityListeners = [];
  hidden = false;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startVersionWatch', () => {
  it('初回取得値は基準として保持し、同じ値のままなら通知しない', async () => {
    const onNew = vi.fn();
    const { impl } = makeFetch([ok('100'), ok('100'), ok('100')]);
    const w = startVersionWatch(watchOpts(impl, onNew));
    await vi.advanceTimersByTimeAsync(0); // 起動時 check [boot = 100]
    await w.checkNow();
    await w.checkNow();
    expect(onNew).not.toHaveBeenCalled();
    w.stop();
  });

  it('build id が変わったら1回だけ通知して watch を止める', async () => {
    const onNew = vi.fn();
    const { impl, calls } = makeFetch([ok('100'), ok('200'), ok('300')]);
    const w = startVersionWatch(watchOpts(impl, onNew));
    await vi.advanceTimersByTimeAsync(0); // boot = 100
    expect(await w.checkNow()).toBe(true); // 200 → 通知
    expect(onNew).toHaveBeenCalledTimes(1);
    const after = calls.length;
    await w.checkNow(); // stop 済みなので fetch しない
    expect(calls.length).toBe(after);
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('fetch が落ちても 404 でも黙って無視する [オフラインで暴発しない]', async () => {
    const onNew = vi.fn();
    const { impl } = makeFetch([ok('100'), boom, notOk, ok('100')]);
    const w = startVersionWatch(watchOpts(impl, onNew));
    await vi.advanceTimersByTimeAsync(0); // boot = 100
    await w.checkNow(); // throw
    await w.checkNow(); // 404
    await w.checkNow(); // 100 に戻る
    expect(onNew).not.toHaveBeenCalled();
    w.stop();
  });

  it('初回 fetch が失敗した場合は次に成功した値を基準にする', async () => {
    const onNew = vi.fn();
    const { impl } = makeFetch([boom, ok('200'), ok('200')]);
    const w = startVersionWatch(watchOpts(impl, onNew));
    await vi.advanceTimersByTimeAsync(0); // 起動時 check が失敗 → 基準未設定
    await w.checkNow(); // 200 が基準
    await w.checkNow();
    expect(onNew).not.toHaveBeenCalled();
    w.stop();
  });

  it('v が空の応答は基準にしない', async () => {
    const onNew = vi.fn();
    const { impl } = makeFetch([() => ({ ok: true, json: async () => ({}) }), ok('200'), ok('200')]);
    const w = startVersionWatch(watchOpts(impl, onNew));
    await vi.advanceTimersByTimeAsync(0); // v なし → 基準未設定
    await w.checkNow();
    await w.checkNow();
    expect(onNew).not.toHaveBeenCalled();
    w.stop();
  });

  it('cache: no-store と cache-buster 付きで取りに行く', async () => {
    const { impl, calls } = makeFetch([ok('100')]);
    const w = startVersionWatch(watchOpts(impl, vi.fn()));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].url).toMatch(/^\/version\.json\?ts=\d+$/);
    expect(calls[0].init?.cache).toBe('no-store');
    w.stop();
  });

  it('非表示タブでは interval で fetch しない。表示に戻ったら追いつく', async () => {
    const onNew = vi.fn();
    const { impl, calls } = makeFetch([ok('100'), ok('200')]);
    const w = startVersionWatch(watchOpts(impl, onNew));
    await vi.advanceTimersByTimeAsync(0); // 起動時の1回目 [boot = 100]
    const afterBoot = calls.length;
    expect(afterBoot).toBe(1);

    hidden = true;
    await vi.advanceTimersByTimeAsync(5000); // 5 interval 分回しても増えない
    expect(calls.length).toBe(afterBoot);
    expect(onNew).not.toHaveBeenCalled();

    hidden = false;
    visibilityListeners.forEach((l) => l());
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(afterBoot + 1);
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('stop で interval と visibility 購読を解除する', async () => {
    const { impl, calls } = makeFetch([ok('100')]);
    const w = startVersionWatch(watchOpts(impl, vi.fn()));
    await vi.advanceTimersByTimeAsync(0);
    const before = calls.length;
    w.stop();
    expect(visibilityListeners.length).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.length).toBe(before);
  });
});
