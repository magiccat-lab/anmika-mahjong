import { describe, expect, it } from 'vitest';
import { claimTileIdentity } from '../game3/claimTile';
import { Game3, buildShoupai } from '../game3';

describe('completed hand claim tile identity', () => {
  it('distinguishes red, gold and green pochi without a discard log', () => {
    expect(claimTileIdentity('p0+')).toMatchObject({ core: 'p0', redSuit: 'p', goldSuit: null });
    expect(claimTileIdentity('gp')).toMatchObject({ core: 'p0', redSuit: null, goldSuit: 'p' });
    expect(claimTileIdentity('z5g-')).toMatchObject({ core: 'z5', pochiColor: 'green' });
  });

  it('counts a red-five ron claim for chips without river metadata', () => {
    const game = new Game3();
    game.qipai();
    game.shoupai.set(1, buildShoupai(['m7', 'm9', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's1', 's2', 's3', 'z1', 'z1']));
    game.chipLedger = { 0: 0, 1: 0, 2: 0 };
    game.huapai[1] = [];
    game.goldHand[1] = { p: 0, s: 0, z: 0 };
    game.nukidora[1] = 0;
    game.nukidoraGold[1] = 0;
    const result: any = { hupai: [], fanshu: 1, fu: 30, _ronpaiForChip: 'p0' };

    game.applyChipsOnHule(result, 1, 0);

    expect(game.chipLedger).toEqual({ 0: -2, 1: 2, 2: 0 });
  });

  it('counts a gold-five ron claim without river metadata', () => {
    const game = new Game3();
    game.qipai();
    game.shoupai.set(1, buildShoupai(['m7', 'm9', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's1', 's2', 's3', 'z1', 'z1']));
    game.chipLedger = { 0: 0, 1: 0, 2: 0 };
    game.huapai[1] = [];
    game.goldHand[1] = { p: 0, s: 0, z: 0 };
    game.nukidora[1] = 0;
    game.nukidoraGold[1] = 0;
    game.discardLog[0] = [];
    const result: any = { hupai: [], fanshu: 1, fu: 30, _ronpaiForChip: 'gp' };

    game.applyChipsOnHule(result, 1, 0);

    expect(game.chipLedger).toEqual({ 0: -4, 1: 4, 2: 0 });
  });
});
