import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';

describe('review 11-02 #7: ippatsu-turn white ankan, rinshan 2p is not dekapochi', () => {
  it('rinshan 2p after own ankan should not be dekapochi (kan kills ippatsu)', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban) as 0 | 1 | 2;
    g.shoupai.set(player, buildShoupai(['z5','z5','z5','p2','p3','p4','p4','p5','p6','s7','s8','s9','m9']));
    g.lizhi.add(player);
    g.lizhiDeclareDapai[player] = false;
    g.yifaActive[player] = true;
    (g as any).goldHand[player] = { p: 0, s: 0, z: 0 };
    (g as any).nukidoraGold[player] = 0;
    const shan = g.shan as any;
    shan._pai.push('z5r');
    shan._rinshan[0] = 'p2';
    expect(g.zimo()).toBe('z5r');
    expect(g.pochiMultiplier[player]).toEqual({ defen: -1, chip: -2 });
    const rep = g.declareKan(player, 'z5555');
    expect(rep).toBe('p2');
    expect(g.yifaActive[player]).toBe(false);
    expect(g.lastZimoInfo.pochi ?? null).toBeNull();
    expect(g.kinpeiTarget[player]).toBeNull();
    expect(g.pochiMultiplier[player]).toEqual({ defen: 1, chip: 1 });
  });
});
