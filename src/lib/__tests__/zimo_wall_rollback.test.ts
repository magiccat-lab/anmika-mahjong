import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';

describe('normal draw wall rollback', () => {
  it('restores live wall, rinshan and rinshanUsed when a flower replacement cannot enter the hand', () => {
    const game = new Game3();
    game.qipai();
    const player = game.lunbanToPlayerId(game.state.lunban);
    game.shoupai.set(player, buildShoupai([
      'p1', 'p1', 'p1', 'p1',
      'p2', 'p3', 'p4', 's2', 's3', 's4', 'm7', 'm9', 'z1',
    ]));
    (game.shan as any)._pai = ['f1'];
    (game.shan as any)._rinshan = ['p1'];
    game.shan.rinshanUsed = 0;

    expect(game.zimo()).toBeNull();
    expect((game.shan as any)._pai).toEqual(['f1']);
    expect((game.shan as any)._rinshan).toEqual(['p1']);
    expect(game.shan.rinshanUsed).toBe(0);
    expect(game.shan.lastDrawnHuapai).toEqual([]);
  });
});
