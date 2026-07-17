import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';

function fuyuGame(): Game3 {
  const game = new Game3();
  game.qipai();
  game.shoupai.set(0, buildShoupai([
    'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7',
    's1', 's2', 's3', 's7', 's8', 's9',
  ]));
  game.huapai[0] = ['f4'];
  // 深い側は [上1, 下1, 上2, 下2, ...]。通常アリスは
  // z1 [下1] を開かず、p1 [上1] → p9 [上2] と進む。
  (game.shan as any)._pai = ['p1', 'z1', 'p9', 'z2', 's4', 's5'];
  (game.shan as any)._fuyuRevealed = [];
  return game;
}

describe('fixed deep-wall dora and Alice reveals', () => {
  it('冬めくりは通常巡目が進んでも同じ深い側の現物から始まる', () => {
    const early = fuyuGame();
    const late = fuyuGame();

    // 通常ツモは末尾側から進むため、深い側の p1 → p9 は変わらない。
    late.shan.zimo();
    late.shan.zimo();

    expect(early.applyFuyuChip(0, null, 1, false).status).toBe('complete');
    expect(late.applyFuyuChip(0, null, 1, false).status).toBe('complete');
    expect((early.shan as any)._fuyuRevealed).toEqual(['p1', 'p9']);
    expect((late.shan as any)._fuyuRevealed).toEqual(['p1', 'p9']);
    expect((early.shan as any)._pai).toEqual(['z1', 'z2', 's4', 's5']);
  });

  it('冬金北のときだけ同じ組の下段も開く', () => {
    const game = fuyuGame();
    (game.shan as any)._pai = ['p1', 'z1', 'z6', 'z7', 's4', 's5'];

    expect(game.applyFuyuChip(0, null, 2, true).status).toBe('complete');
    expect((game.shan as any)._fuyuRevealed).toEqual(['p1', 'z1', 'z6', 'z7']);
    expect((game.shan as any)._pai).toEqual(['s4', 's5']);
  });

  it('神ぽっち候補の冬見積りと実際の深い側めくりが一致する', () => {
    const game = fuyuGame();
    game.shan.zimo();
    game.shan.zimo();

    // 同じ牌への置換で手牌構成は変えず、見積りの山走査だけを検証する。
    const estimated = game.estimateFuyuChipForSwap(0, null, null, 's9', 's9');
    const before = game.chipLedger[0];
    expect(game.applyFuyuChip(0, null, 1, false).status).toBe('complete');

    expect(game.chipLedger[0] - before).toBe(estimated);
    expect((game.shan as any)._fuyuRevealed).toEqual(['p1', 'p9']);
  });

  it('和了再計算の snapshot 復元で冬公開牌も山と一緒に元へ戻る', () => {
    const game = fuyuGame();
    const wallBefore = [...((game.shan as any)._pai as string[])];
    game.saveSnapshot();

    expect(game.applyFuyuChip(0, null, 1, false).status).toBe('complete');
    expect((game.shan as any)._fuyuRevealed).toEqual(['p1', 'p9']);
    expect((game.shan as any)._pai).not.toEqual(wallBefore);

    game.restoreSnapshot();
    expect((game.shan as any)._pai).toEqual(wallBefore);
    expect((game.shan as any)._fuyuRevealed).toEqual([]);
  });
});
