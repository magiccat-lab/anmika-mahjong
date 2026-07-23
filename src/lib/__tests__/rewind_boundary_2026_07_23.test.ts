import { describe, expect, it } from 'vitest';
import { computeRewindPlan } from '../../../server/ws_server';

// [2026-07-23 Sol 7周目 P0] rewind 局頭境界:
// 2試合目の第1局 [まだ nextRound なし] で rewind すると、旧実装は前試合最後の
// nextRound まで戻して nextMatch command ごと削除し、canonical が前試合へ戻る一方
// snapshot.matchId は現試合のままズレていた。nextMatch も境界として keep し、
// matchId/roundId を kept 列から再算出する。

const cmd = (revision: number, type: string) => ({ revision, action: { type } });

describe('computeRewindPlan', () => {
  it('通常局: 最後の nextRound が境界', () => {
    const plan = computeRewindPlan([
      cmd(1, 'discard'), cmd(2, 'nextRound'), cmd(3, 'discard'), cmd(4, 'tsumo'),
    ]);
    expect(plan).toEqual({ keepThrough: 2, matchId: 1, roundId: 2 });
  });

  it('2試合目の第1局: nextMatch を境界として keep する [前試合へ戻らない]', () => {
    const plan = computeRewindPlan([
      cmd(1, 'discard'),
      cmd(2, 'nextRound'),
      cmd(3, 'tsumo'),
      cmd(4, 'nextMatch'),
      cmd(5, 'discard'),
      cmd(6, 'discard'),
    ]);
    // 境界は nextMatch [rev4]。matchId は 2、roundId は新試合の 1
    expect(plan).toEqual({ keepThrough: 4, matchId: 2, roundId: 1 });
  });

  it('2試合目の第2局以降: 最後の nextRound が境界で matchId は 2 のまま', () => {
    const plan = computeRewindPlan([
      cmd(1, 'nextMatch'),
      cmd(2, 'discard'),
      cmd(3, 'nextRound'),
      cmd(4, 'discard'),
    ]);
    expect(plan).toEqual({ keepThrough: 3, matchId: 2, roundId: 2 });
  });

  it('第1試合の第1局 [境界 command なし]: 全部捨てて初期 ID', () => {
    const plan = computeRewindPlan([cmd(1, 'discard'), cmd(2, 'tsumo')]);
    expect(plan).toEqual({ keepThrough: 0, matchId: 1, roundId: 1 });
  });
});
