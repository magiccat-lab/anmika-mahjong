import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function freshGame(): Game3 {
  const g = new Game3({ qijia: 0 });
  g.qipai();
  g.diyizimo = false;
  g.state.benbang = 0;
  g.state.lizhibang = 0;
  g.chipLedger = { 0: 0, 1: 0, 2: 0 };
  g.shoupai.set(1 as PlayerId, buildShoupai([
    'm1', 'm1', 'm1',
    'm9', 'm9', 'm9',
    'p1', 'p1', 'p1',
    's1', 's1', 's1',
    'z1', 'z1',
  ]));
  g.huapai[1] = [];
  g.nukidora[1] = 0;
  g.nukidoraGold[1] = 0;
  g.goldHand[1] = { p: 0, s: 0, z: 0 };
  g.pochiHand[1] = { blue: 0, red: 0, green: 0, yellow: 0 };
  return g;
}

describe('tobi transition regression 2026-05-21', () => {
  it('黄ぽっちツモ払いで winner が 0 から飛んでも受取側にトビ賞が付く', () => {
    const g = freshGame();
    g.state.defen = { 0: 35000, 1: 0, 2: 35000 };
    g.pochiMultiplier[1] = { defen: -1, chip: -1 };
    g.pochiPaymentMode[1] = true;

    g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, 1 as PlayerId, null);

    expect(g.state.defen[1]).toBeLessThan(0);
    expect(g.chipLedger[0]).toBe(0);
    expect(g.chipLedger[2]).toBe(0);
    expect(g.chipLedger[1]).toBe(0);
    expect(g.chipBreakdown.filter((b) => b.label.includes('トビ賞 [p1 飛び]'))).toHaveLength(0);
  });

  it('ツモで 2 人同時に >=0 から <0 へ落ちたら 2 人分のトビ賞が付く', () => {
    const g = freshGame();
    g.state.defen = { 0: 1900, 1: 35000, 2: 1400 };

    g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, 1 as PlayerId, null);

    expect(g.state.defen[0]).toBeLessThan(0);
    expect(g.state.defen[2]).toBeLessThan(0);
    expect(g.chipLedger).toEqual({ 0: -5, 1: 10, 2: -5 });
    expect(g.chipBreakdown.filter((b) => b.label.includes('トビ賞'))).toHaveLength(2);
  });
});
