import { describe, expect, it } from 'vitest';
import { createRoomAuthority, type RoomAuthority } from '../../../server/authority';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import type { PlayerId } from '../types';

// [2026-07-23 リョー指示] 2試合連続・5試合連続でチップが正しく継続するか [online 権威側]。
// 各試合を終了状態にして nextMatch [ws 層と同じ finalize=!resetChip] を通し、
//  - 持越し: nextMatch 後の chipLedger = 前試合 getFinalScore の total [uma/topN/トントンブー込み]
//  - 基準: matchStartChipLedger が試合ごとに更新され、matchResultLedger が「その試合の差分」になる
//  - リセット: 全員同意で resetChip=true の試合だけ 0 に戻る
//  - changshu [東風/半荘設定] と回り親 [qijia] が連戦で維持/回転する
// を通しで検証する。

const SEATS: PlayerId[] = [0, 1, 2];
const MEMBERS = SEATS.map((seat) => ({ seat, is_cpu: false }));

function pool(): string[] {
  return generateTilePool(defaultSanmaRule()).map(String);
}

// 試合終了状態を注入 [終局遷移そのものは solo 共有 reducer の守備範囲]。
// matchResultLedger は validation mirror [a.game] の getFinalScore を読む
// [本番は validateAndApply の syncFromCanonical で常に同期済み] ため、
// canonical と mirror の両方に同じ終了状態を入れる
function forceFinish(a: RoomAuthority, defen: Record<PlayerId, number>, chipDelta: Record<PlayerId, number>): void {
  const state = a.canonicalState();
  state.game.state.finished = true;
  state.roundEnded = true;
  const mirror = (a as any).game;
  mirror.state.finished = true;
  for (const p of SEATS) {
    state.game.state.defen[p] = defen[p];
    state.game.chipLedger[p] += chipDelta[p];
    mirror.state.defen[p] = defen[p];
    mirror.chipLedger[p] = state.game.chipLedger[p];
  }
}

function applyNextMatch(a: RoomAuthority, opts: { resetChip: boolean; qijia: PlayerId }): void {
  const reason = a.validateAndApply(0, {
    type: 'nextMatch',
    // ws 層 acceptAction と同じ強制: finalize = !resetChip
    finalize: !opts.resetChip,
    resetChip: opts.resetChip,
    qijia: opts.qijia,
    preShuffledPool: pool(),
  }, MEMBERS);
  expect(reason).toBeNull();
}

describe('連戦チップ継続 [authority]', () => {
  it('2試合連続: finalize 持越しと基準 ledger の更新', () => {
    const a = createRoomAuthority({ preShuffledPool: pool(), qijia: 0, changshu: 2 });
    forceFinish(a, { 0: 41000, 1: 25000, 2: 9000 }, { 0: 10, 1: -4, 2: -6 });
    const expected = a.canonicalState().game.getFinalScore();
    // この試合の delta [POST/WSA 照合と同じ式]
    const delta1 = a.matchResultLedger();
    for (const p of SEATS) {
      expect(delta1[p]).toBe(expected.find((r: any) => r.player === p)!.total - 0);
    }

    applyNextMatch(a, { resetChip: false, qijia: 1 });
    const s2 = a.canonicalState();
    for (const p of SEATS) {
      // 持越し: 新試合の ledger = 前試合の最終精算 total
      expect(s2.game.chipLedger[p]).toBe(expected.find((r: any) => r.player === p)!.total);
      // 基準も同じ値に更新 [ここがズレると 2 試合目の POST/WSA 照合が全部壊れる]
      expect(a.currentMatchStartChipLedger()[p]).toBe(s2.game.chipLedger[p]);
    }
    // 設定の維持と回り親
    expect(s2.game.changshu).toBe(2);
    expect(s2.game.state.qijia).toBe(1);
    expect(s2.game.state.finished).toBe(false);
  });

  it('5試合連続: 毎試合の持越し/差分が破綻せず、途中の全員同意リセットで 0 に戻る', () => {
    const a = createRoomAuthority({ preShuffledPool: pool(), qijia: 0, changshu: 1 });
    // 試合ごとの成績 [defen と 祝儀 delta を変える]
    const rounds: Array<{ defen: Record<PlayerId, number>; chips: Record<PlayerId, number>; reset: boolean }> = [
      { defen: { 0: 41000, 1: 25000, 2: 9000 }, chips: { 0: 6, 1: -2, 2: -4 }, reset: false },
      { defen: { 0: 15000, 1: 45000, 2: 15000 }, chips: { 0: -3, 1: 8, 2: -5 }, reset: false },
      { defen: { 0: 25000, 1: 25000, 2: 25000 }, chips: { 0: 0, 1: 2, 2: -2 }, reset: true },  // 3試合目終了後に全員同意リセット
      { defen: { 0: 9000, 1: 25000, 2: 41000 }, chips: { 0: -7, 1: 0, 2: 7 }, reset: false },
      { defen: { 0: 30000, 1: 30000, 2: 15000 }, chips: { 0: 1, 1: 1, 2: -2 }, reset: false },
    ];
    let qijia: PlayerId = 0;
    for (const [i, round] of rounds.entries()) {
      const baseline = a.currentMatchStartChipLedger();
      forceFinish(a, round.defen, round.chips);
      const totals = a.canonicalState().game.getFinalScore();
      const delta = a.matchResultLedger();
      for (const p of SEATS) {
        // matchResultLedger は常に「この試合の差分」 [累積が混ざったら即破綻する]
        expect(delta[p], `match${i + 1} delta p${p}`).toBe(
          totals.find((r: any) => r.player === p)!.total - baseline[p],
        );
      }
      qijia = ((qijia + 1) % 3) as PlayerId;
      applyNextMatch(a, { resetChip: round.reset, qijia });
      const after = a.canonicalState();
      for (const p of SEATS) {
        const expectedLedger = round.reset ? 0 : totals.find((r: any) => r.player === p)!.total;
        expect(after.game.chipLedger[p], `match${i + 1}→${i + 2} carry p${p}`).toBe(expectedLedger);
        expect(a.currentMatchStartChipLedger()[p], `match${i + 1}→${i + 2} baseline p${p}`).toBe(expectedLedger);
      }
      expect(after.game.state.qijia, `match${i + 2} qijia`).toBe(qijia);
      expect(after.game.changshu, 'changshu 維持').toBe(1);
      expect(after.game.state.finished).toBe(false);
    }
  });
});
