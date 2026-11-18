import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// [2026-11-18 通報 20261118_1 isg. 部屋 U1TQ rev 852]
// 「面前満貫 3枚→29枚 で飛びが出た時、29+5 ではなく 3+5=8 と解釈しそう」
// トビ賞は applyChipsOnHule の前に別口で払うので、29 枚の判定 [支払者ごとの倍率前 3 枚] には入らない。
// 放銃者は 29 + トビ賞 5 = 34 枚を払う [U1TQ の最後の局も p2 -34]
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

const hule = () => ({
  fanshu: 4, fu: 30, damanguan: 0,
  hupai: [{ name: '立直', fanshu: 1 }, { name: '一発', fanshu: 1 }, { name: '裏ドラ', fanshu: 2 }],
});

describe('面前満貫 3→29 とトビ賞の順 2026-11-18', () => {
  it('飛ばない満貫ロン: 放銃者 3 枚 → 29 枚', () => {
    const g = freshGame();
    g.state.defen = { 0: 35000, 1: 35000, 2: 35000 };
    g.applyHule(hule(), 1 as PlayerId, 0 as PlayerId);
    expect(g.chipLedger[0]).toBe(-29);
  });

  it('放銃者が飛ぶ満貫ロン: 29 + トビ賞 5 = 34 枚 [3+5=8 ではない]', () => {
    const g = freshGame();
    g.state.defen = { 0: 3000, 1: 35000, 2: 35000 };
    g.applyHule(hule(), 1 as PlayerId, 0 as PlayerId);
    expect(g.state.defen[0]).toBeLessThan(0);
    expect(g.chipBreakdown.some((b) => b.label === '面前満貫 3枚→29枚')).toBe(true);
    expect(g.chipBreakdown.filter((b) => b.label.includes('トビ賞'))).toHaveLength(1);
    expect(g.chipLedger[0]).toBe(-34);
  });
});
