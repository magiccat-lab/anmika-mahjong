import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';

describe('review 11-02 #8: 逆→逆 (1倍正) では金ペーを自動にしない', () => {
  it('result is positive, so the winner picks the kinpei target', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban) as 0 | 1 | 2;
    g.shoupai.set(player, buildShoupai(['p2','p3','p4','p4','p5','p6','s7','s8','s9','m9','m9','s1','s1']));
    g.lizhi.add(player);
    g.lizhiDeclareDapai[player] = false;
    g.yifaActive[player] = false;
    (g as any).goldHand[player] = { p: 0, s: 0, z: 0 };
    (g as any).nukidoraGold[player] = 1;
    g.effectiveHuapaiAtHule = () => ['f2'];
    (g as any).setPochiMultiplier(player, { defen: -1, chip: -1 });
    g.kinpeiTarget[player] = null;
    (g.shan as any)._pai.push('z5y');
    expect(g.zimo()).toBe('z5y');
    expect(g.pochiPaymentMode[player]).toBe(false);
    expect(g.kinpeiTarget[player]).toBeNull();
  });
  it('single 逆 (result is reverse) still auto-resolves kinpei', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban) as 0 | 1 | 2;
    g.shoupai.set(player, buildShoupai(['p2','p3','p4','p4','p5','p6','s7','s8','s9','m9','m9','s1','s1']));
    g.lizhi.add(player);
    g.lizhiDeclareDapai[player] = false;
    g.yifaActive[player] = false;
    (g as any).goldHand[player] = { p: 0, s: 0, z: 0 };
    (g as any).nukidoraGold[player] = 1;
    g.effectiveHuapaiAtHule = () => ['f2'];
    g.kinpeiTarget[player] = null;
    (g.shan as any)._pai.push('z5y');
    expect(g.zimo()).toBe('z5y');
    expect(g.pochiPaymentMode[player]).toBe(true);
    expect(g.kinpeiTarget[player]).toBe('natsu');
  });
});
