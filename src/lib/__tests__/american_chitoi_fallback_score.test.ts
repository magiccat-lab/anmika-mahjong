import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';

function gameWithAmericanChitoi(tiles: string[]): Game3 {
  const game = new Game3({ qijia: 0 });
  game.qipai();
  game.shoupai.set(0, buildShoupai(tiles));
  (game.shan as any)._pai = ['p2', 's2', 'p3', 's3'];
  (game.shan as any)._baopai = [];
  (game.shan as any)._fubaopai = [];
  // [2026-07-21 fix] qipai のランダム配牌で華 [秋 f3 等] が残ると和了時に追加ドラが開いて
  // doraFanshu がブレる flaky だった [vitest retry=2 が隠していた]。華牌も完全初期化する
  game.huapai[0] = [];
  game.huapai[1] = [];
  game.huapai[2] = [];
  game.firstTurnState.players[0].drawCount = 2;
  game.firstTurnState.players[0].hasDiscarded = true;
  game.lizhi.add(0);
  return game;
}

describe('American seven-pairs fallback scoring', () => {
  it('applies this table\'s four-fan double-riichi ruling', () => {
    const game = gameWithAmericanChitoi([
      'p1', 'p1', 'p1', 'p1',
      'p2', 'p2', 'p4', 'p4', 's2', 's2', 's4', 's4', 'z1', 'z1',
    ]);
    game.doubleLizhi.add(0);

    const result = game.hule(0);

    expect(result).not.toBeNull();
    expect(result.hupai).toContainEqual({ name: 'ダブリー', fanshu: 4 });
  });

  it('counts a physical red five but not a core-equal gold five', () => {
    const game = gameWithAmericanChitoi([
      'p0', 'p5', 'p5', 'gp',
      'p1', 'p1', 'p3', 'p3', 's2', 's2', 's4', 's4', 'z1', 'z1',
    ]);

    const result = game.hule(0);

    expect(result).not.toBeNull();
    expect(result.hupai).toContainEqual({ name: '赤ドラ', fanshu: 1 });
  });

  it('does not apply the core zero-tile dora repair after its complete manual count', () => {
    const game = gameWithAmericanChitoi([
      'p0', 'p5', 'p5', 'gp',
      'p1', 'p1', 'p3', 'p3', 's2', 's2', 's4', 's4', 'z1', 'z1',
    ]);
    (game.shan as any)._baopai = ['p4'];

    const result = game.hule(0);

    expect(result).not.toBeNull();
    const doraFanshu = result.hupai
      .filter((h: any) => h.name === 'ドラ')
      .reduce((sum: number, h: any) => sum + h.fanshu, 0);
    expect(doraFanshu).toBe(4);
  });

  it('retains flush yaku and the small-wheel upgrade', () => {
    const game = gameWithAmericanChitoi([
      'p1', 'p1', 'p1', 'p1',
      'p3', 'p3', 'p5', 'p5', 'p7', 'p7', 'p9', 'p9', 'z1', 'z1',
    ]);

    const result = game.hule(0);

    expect(result).not.toBeNull();
    expect(result.hupai).toContainEqual({ name: '混一色', fanshu: 3 });
    expect(result.hupai).toContainEqual({ name: '小車輪 [+1翻]', fanshu: 1 });
  });

  it.each([
    {
      name: 'all honors',
      tiles: ['z1', 'z1', 'z1', 'z1', 'z2', 'z2', 'z3', 'z3', 'z4', 'z4', 'z5', 'z5', 'z6', 'z6'],
      yaku: '字一色',
    },
    {
      name: 'all terminals',
      tiles: ['p1', 'p1', 'p1', 'p1', 'p9', 'p9', 's1', 's1', 's9', 's9', 'm7', 'm7', 'm9', 'm9'],
      yaku: '清老頭',
    },
    {
      name: 'all green',
      tiles: ['s2', 's2', 's2', 's2', 's3', 's3', 's4', 's4', 's6', 's6', 's8', 's8', 'z6', 'z6'],
      yaku: '緑一色',
    },
  ])('preserves $name yakuman', ({ tiles, yaku }) => {
    const game = gameWithAmericanChitoi(tiles);

    const result = game.hule(0);

    expect(result).not.toBeNull();
    expect(result.hupai).toContainEqual({ name: yaku, fanshu: '*' });
    expect(result.damanguan).toBeGreaterThanOrEqual(1);
  });
});
