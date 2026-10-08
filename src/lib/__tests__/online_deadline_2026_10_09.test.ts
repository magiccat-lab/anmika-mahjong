import { describe, expect, it } from 'vitest';
import {
  DEADLINE_WARN_MS,
  applyDeadlineMessage,
  deadlineRemainingMs,
  isWaitingOnSeat,
  planDeadlineWarn,
  type OnlineDeadline,
} from '../onlineDeadline';

// [2026-10-09 遊真 C1] server の deadline message → 席の札に出す残り時間の状態。
// 時計は引数で渡す pure 関数なので、固定の now で全分岐を押さえる

const msg = (over: Record<string, unknown> = {}) => ({
  type: 'deadline', kind: 'turn', seats: [1], remainingMs: 30_000, revision: 5, ...over,
});

describe('applyDeadlineMessage', () => {
  it('turn の message から endsAt = now + remainingMs の状態を作る', () => {
    const d = applyDeadlineMessage(null, msg(), 1000);
    expect(d).toEqual({ kind: 'turn', seats: [1], endsAt: 31_000, totalMs: 30_000, revision: 5 });
  });

  it('kind none は待ち無し [null] に畳む', () => {
    const cur = applyDeadlineMessage(null, msg(), 0);
    expect(applyDeadlineMessage(cur, msg({ kind: 'none', seats: [], remainingMs: 0, revision: 6 }), 10)).toBeNull();
  });

  it('seats が空 [誰も待っていない] も null', () => {
    expect(applyDeadlineMessage(applyDeadlineMessage(null, msg(), 0), msg({ seats: [], revision: 6 }), 0)).toBeNull();
  });

  it('新しい revision は置き換える [kind と seats も変わる]', () => {
    const cur = applyDeadlineMessage(null, msg(), 0);
    const next = applyDeadlineMessage(cur, msg({ kind: 'reaction', seats: [0, 2], remainingMs: 8000, revision: 6 }), 100);
    expect(next).toEqual({ kind: 'reaction', seats: [0, 2], endsAt: 8100, totalMs: 8000, revision: 6 });
  });

  it('古い revision は無視して今の状態をそのまま返す [同一参照]', () => {
    const cur = applyDeadlineMessage(null, msg({ revision: 9 }), 0);
    expect(applyDeadlineMessage(cur, msg({ revision: 8, seats: [2] }), 50)).toBe(cur);
    // 古い revision の none でも消さない
    expect(applyDeadlineMessage(cur, msg({ kind: 'none', revision: 7 }), 50)).toBe(cur);
  });

  it('同じ revision ・ 同じ kind の再送 [再接続直後] は totalMs を保つ', () => {
    const first = applyDeadlineMessage(null, msg({ remainingMs: 30_000 }), 0);
    const resent = applyDeadlineMessage(first, msg({ remainingMs: 12_000 }), 18_000);
    expect(resent?.totalMs).toBe(30_000);
    expect(resent?.endsAt).toBe(30_000);
  });

  it('壊れた message は無視する', () => {
    const cur = applyDeadlineMessage(null, msg(), 0);
    expect(applyDeadlineMessage(cur, null, 0)).toBe(cur);
    expect(applyDeadlineMessage(cur, 'x', 0)).toBe(cur);
    expect(applyDeadlineMessage(cur, msg({ kind: 'bogus' }), 0)).toBe(cur);
    expect(applyDeadlineMessage(cur, msg({ remainingMs: 'soon' }), 0)).toBe(cur);
    expect(applyDeadlineMessage(null, msg({ remainingMs: NaN }), 0)).toBeNull();
  });

  it('seats に整数以外が混じっても整数だけ拾う / 負の残りは 0', () => {
    const d = applyDeadlineMessage(null, msg({ seats: [0, 'x', 1.5, 2], remainingMs: -5 }), 100);
    expect(d?.seats).toEqual([0, 2]);
    expect(d?.endsAt).toBe(100);
  });
});

describe('isWaitingOnSeat / deadlineRemainingMs', () => {
  const d: OnlineDeadline = { kind: 'turn', seats: [1, 3], endsAt: 5000, totalMs: 5000, revision: 1 };
  it('待たれている room seat だけ true、期限後は false', () => {
    expect(isWaitingOnSeat(d, 1, 0)).toBe(true);
    expect(isWaitingOnSeat(d, 3, 4999)).toBe(true);
    expect(isWaitingOnSeat(d, 0, 0)).toBe(false);
    expect(isWaitingOnSeat(d, 1, 5000)).toBe(false);
    expect(isWaitingOnSeat(null, 1, 0)).toBe(false);
    expect(isWaitingOnSeat(d, null, 0)).toBe(false);
  });
  it('残りは 0 未満にならない', () => {
    expect(deadlineRemainingMs(d, 1000)).toBe(4000);
    expect(deadlineRemainingMs(d, 9999)).toBe(0);
    expect(deadlineRemainingMs(null, 0)).toBe(0);
  });
});

describe('planDeadlineWarn [残り 10 秒の知らせ]', () => {
  const mk = (over: Partial<OnlineDeadline> = {}): OnlineDeadline =>
    ({ kind: 'turn', seats: [2], endsAt: 30_000, totalMs: 30_000, revision: 7, ...over });

  it('自席が turn で待たれていれば、残り 10 秒になる時刻までの遅延を返す', () => {
    expect(planDeadlineWarn(mk(), 2, 0)).toEqual({ key: 'turn:7', delayMs: 30_000 - DEADLINE_WARN_MS });
  });
  it('すでに残り 10 秒以内なら delay 0 [すぐ鳴らす]', () => {
    expect(planDeadlineWarn(mk(), 2, 25_000)).toEqual({ key: 'turn:7', delayMs: 0 });
  });
  it('reaction も対象', () => {
    expect(planDeadlineWarn(mk({ kind: 'reaction' }), 2, 0)?.key).toBe('reaction:7');
  });
  it('postWin ・ 他人待ち ・ 観戦 [-1] ・ 席不明 ・ 期限切れは null', () => {
    expect(planDeadlineWarn(mk({ kind: 'postWin' }), 2, 0)).toBeNull();
    expect(planDeadlineWarn(mk(), 0, 0)).toBeNull();
    expect(planDeadlineWarn(mk(), -1, 0)).toBeNull();
    expect(planDeadlineWarn(mk(), undefined, 0)).toBeNull();
    expect(planDeadlineWarn(mk(), 2, 30_000)).toBeNull();
    expect(planDeadlineWarn(null, 2, 0)).toBeNull();
  });
  it('同じ待ちは同じ key [1 回だけ鳴らす判定に使う]', () => {
    const a = planDeadlineWarn(mk(), 2, 0);
    const b = planDeadlineWarn(mk({ endsAt: 28_000 }), 2, 1000);
    expect(a?.key).toBe(b?.key);
    expect(planDeadlineWarn(mk({ revision: 8 }), 2, 0)?.key).not.toBe(a?.key);
  });
});
