import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import { computeTileInventory, expectedInventory, diffInventory } from '../game3/inventory';

// inventory pure helper の挙動 verify。 fuzz は V33 でカバーされてるが
// 基本性質は ここで 単発 unit に分解しておく [赤/金/ぽっち 別 key の集計漏れ防衛]。
describe('expectedInventory', () => {
  it('合計 116 枚 [ANMIKA 牌構成]', () => {
    const exp = expectedInventory();
    const total = Object.values(exp).reduce((a, b) => a + b, 0);
    expect(total).toBe(116);
  });

  it('m7 / m9 のみ 4 枚、 m1-m6 / m8 はキーに無い [ANMIKA 仕様]', () => {
    const exp = expectedInventory();
    expect(exp['m7']).toBe(4);
    expect(exp['m9']).toBe(4);
    for (const n of [1, 2, 3, 4, 5, 6, 8]) {
      expect(exp[`m${n}`]).toBeUndefined();
    }
  });

  it('z5 は plain key で 0、 色別 z5b/z5r/z5g/z5y で各 1', () => {
    const exp = expectedInventory();
    expect(exp['z5']).toBe(0);
    for (const c of ['z5b', 'z5r', 'z5g', 'z5y']) expect(exp[c]).toBe(1);
  });

  it('gp / gs / gN [金牌] 各 1、 p0 / s0 [赤] 各 1', () => {
    const exp = expectedInventory();
    expect(exp['gp']).toBe(1);
    expect(exp['gs']).toBe(1);
    expect(exp['gN']).toBe(1);
    expect(exp['p0']).toBe(1);
    expect(exp['s0']).toBe(1);
  });

  it('z4 [北] 3 枚 [+ 金北 gN 1 枚で実質 4]、 f1-f4 [華牌] 各 2', () => {
    const exp = expectedInventory();
    expect(exp['z4']).toBe(3);
    for (let n = 1; n <= 4; n++) expect(exp[`f${n}`]).toBe(2);
  });
});

describe('computeTileInventory + diffInventory', () => {
  it('qipai 直後の inventory は期待値と完全一致 [diff 空]', () => {
    const g = new Game3();
    g.qipai();
    const diff = diffInventory(g);
    expect(diff).toEqual([]);
  });

  it('zimo / dapai を繰り返しても inventory が保たれる [bug 検出用 fuzz]', () => {
    const g = new Game3();
    g.qipai();
    for (let i = 0; i < 20; i++) {
      let z = g.zimo();
      if (!z) break;
      while (z === 'z4') {
        const cur = g.lunbanToPlayerId(g.state.lunban);
        const rep = g.declareNukiBei(cur);
        if (!rep) break;
        z = rep;
      }
      if (!z || z === 'z4') break;
      g.dapai(z);
    }
    const diff = diffInventory(g);
    expect(diff).toEqual([]);
  });

  it('computeTileInventory の合計枚数は常に 116', () => {
    const g = new Game3();
    g.qipai();
    for (let i = 0; i < 10; i++) {
      let z = g.zimo();
      if (!z) break;
      while (z === 'z4') {
        const cur = g.lunbanToPlayerId(g.state.lunban);
        const rep = g.declareNukiBei(cur);
        if (!rep) break;
        z = rep;
      }
      if (!z || z === 'z4') break;
      g.dapai(z);
    }
    const counts = computeTileInventory(g);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(116);
  });

  it('方向記号の前へ牌が入る加槓表記でも、元ポンの物理牌メタ情報を引き継ぐ', () => {
    const zeros = (length: number) => Array.from({ length }, () => 0);
    const sp = {
      _bingpai: { m: zeros(10), p: zeros(10), s: zeros(10), z: zeros(8) },
      _fulou: ['p000+0'],
      _anmikaFulou: [{ mianzi: 'p00+0', taken: 'gp' }],
      _anmikaFulouPhysical: [
        { mianzi: 'p00+0', consumed: ['p0', 'gp'] },
        { mianzi: 'p000+0', consumed: ['p0'] },
      ],
    };
    const g = {
      shan: { _pai: [], _rinshan: [], _baopai: [], _fubaopai: [], _fuyuRevealed: [] },
      shoupai: new Map([[0, sp]]),
      he: new Map(),
      goldHand: { 0: { p: 0, s: 0, z: 0 } },
      pochiHand: { 0: { blue: 0, red: 0, green: 0, yellow: 0 } },
      discardLog: { 0: [], 1: [], 2: [] },
      huapai: { 0: [], 1: [], 2: [] },
      nukidora: { 0: 0, 1: 0, 2: 0 },
      nukidoraGold: { 0: 0, 1: 0, 2: 0 },
    };

    const counts = computeTileInventory(g);
    expect(counts.gp).toBe(2);
    expect(counts.p0).toBe(2);
  });
});
