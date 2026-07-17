import { describe, expect, it, vi } from 'vitest';
import { Game3 } from '../game3';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import { settleRonResultsInKamichaOrder, type RonResult } from '../store/winPipeline';

function advanceOneDraw(game: Game3): void {
  const player = game.lunbanToPlayerId(game.state.lunban);
  const discard = game.pickBestDiscard(player);
  if (!discard) throw new Error(`p${player} has no legal discard`);
  game.dapai(discard);
  game.zimo();
}

function preparedGame(benbang = 0): Game3 {
  const pool = generateTilePool(defaultSanmaRule());
  const game = new Game3({ qijia: 0, preShuffledPool: pool });
  if (benbang > 0) {
    game.nextRound({ winner: 0, renchan: true, preShuffledPool: generateTilePool(defaultSanmaRule()) });
  }
  game.qipai();
  game.zimo();

  vi.spyOn(game, 'canLizhi').mockReturnValue(true);
  expect(game.declareLizhi({ open: true })).toBe(true);
  expect(game.state.lizhibang).toBe(2);

  // Return the turn to p0 through legal discard/draw commands. p0 is the
  // eventual discarder used by the double-ron settlement below.
  advanceOneDraw(game);
  advanceOneDraw(game);
  advanceOneDraw(game);
  expect(game.lunbanToPlayerId(game.state.lunban)).toBe(0);
  return game;
}

function claims(order: [1 | 2, 1 | 2]): RonResult[] {
  return order.map((player) => ({
    player,
    result: { fanshu: 2, fu: 30, hupai: [] },
  }));
}

function settle(order: [1 | 2, 1 | 2], benbang = 0) {
  const game = preparedGame(benbang);
  const before = { ...game.state.defen };
  const settled = settleRonResultsInKamichaOrder(game, 0, claims(order));
  return {
    order: settled.map((entry) => entry.player),
    defen: { ...game.state.defen },
    delta: {
      0: game.state.defen[0] - before[0],
      1: game.state.defen[1] - before[1],
      2: game.state.defen[2] - before[2],
    },
    chips: { ...game.chipLedger },
    lizhibang: game.state.lizhibang,
  };
}

describe('WSA-A6 double-ron claim order', () => {
  it('is independent of declaration arrival order for points, chips, and deposits', () => {
    expect(settle([1, 2])).toEqual(settle([2, 1]));
  });

  it('awards the deposit to the first winner counterclockwise from the discarder', () => {
    const outcome = settle([1, 2]);

    expect(outcome.order).toEqual([2, 1]);
    expect(outcome.delta).toEqual({ 0: -4000, 1: 2000, 2: 4000 });
    expect(outcome.lizhibang).toBe(0);
  });

  it('keeps the current double-ron honba payment for both winners', () => {
    const outcome = settle([2, 1], 1);

    expect(outcome.delta).toEqual({ 0: -8000, 1: 4000, 2: 6000 });
  });

  it('starts Winter after Autumn indicators even when the Winter winner settles first', () => {
    const game = new Game3({ qijia: 0, preShuffledPool: generateTilePool(defaultSanmaRule()) });
    const shan = game.shan as any;
    shan._pai = ['p1', 'p9', 's1', 's9'];
    const beforeAutumn = game.shan.snapshot();

    const autumnResult: any = {
      fanshu: 1,
      fu: 30,
      hupai: [{ name: '秋 [ドラ表追加]', fanshu: 0 }],
      _akiRevealCount: 1,
    };
    const winterResult: any = {
      fanshu: 1,
      fu: 30,
      // Plain Winter is only labelled later by applyHule; ordering must use
      // the effective flower state, not this result text.
      hupai: [],
    };
    game.huapai[2] = ['f4'];

    expect(game.shan.drawNewDora(false)).toBe('p1');
    expect(game.shan.drawNewDora(true)).toBe('p9');
    game.akiUsedCount[1] = 1;
    const afterAutumn = game.shan.snapshot();
    (game as any)._huleRevealStateByResult.set(autumnResult, {
      shan: afterAutumn,
      akiUsedCount: { ...game.akiUsedCount },
      effectiveHuapai: ['f3'],
    });

    // The last candidate evaluation was the Winter winner, so the live game has
    // returned to the pre-Autumn wall. Settlement must recover Autumn's wall.
    game.shan.restore(beforeAutumn);
    game.akiUsedCount[1] = 0;
    const winterStart: string[] = [];
    vi.spyOn(game, 'applyHule').mockImplementation((_result, winner) => {
      if (winner === 2) winterStart.push((game.shan as any)._pai.shift());
    });

    settleRonResultsInKamichaOrder(game, 0, [
      { player: 1, result: autumnResult },
      { player: 2, result: winterResult },
    ]);

    // p2 is first in upper-seat settlement order, but its Winter starts after
    // Autumn's fixed [front, back] pair p1/p9 rather than reopening p1.
    expect(winterStart).toEqual(['s1']);
    expect(game.shan.baopai.at(-1)).toBe('p1');
    expect(game.shan.fubaopai?.at(-1)).toBe('p9');
    expect(game.akiUsedCount[1]).toBe(1);
  });
});
