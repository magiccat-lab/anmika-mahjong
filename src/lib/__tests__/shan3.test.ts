import { describe, it, expect } from 'vitest';
import { Shan3, type ShanRule, generateTilePool, defaultSanmaRule } from '../shan3';

const baseRule: ShanRule = defaultSanmaRule();
const tenhouRule: ShanRule = { hongpai: { m: 0, p: 1, s: 1 }, tileSet: 'tenhou', fudora: true };
const anmikaFullRule: ShanRule = { hongpai: { m: 0, p: 1, s: 1 }, tileSet: 'anmika', fudora: true };

function countBy(pool: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of pool) out[p] = (out[p] || 0) + 1;
  return out;
}

describe('generateTilePool [SanmaTileSet 3 種]', () => {
  it('jansoul [defaultSanmaRule] = 116 枚', () => {
    expect(generateTilePool(baseRule)).toHaveLength(116);
  });
  it('tenhou も 116 枚', () => {
    expect(generateTilePool(tenhouRule)).toHaveLength(116);
  });
  it('anmika [萬子フル] は萬子 +28 枚 [計 144]', () => {
    expect(generateTilePool(anmikaFullRule)).toHaveLength(144);
  });

  it('jansoul: 萬子は 7m / 9m のみ', () => {
    const c = countBy(generateTilePool(baseRule));
    expect(c.m7).toBe(4);
    expect(c.m9).toBe(4);
    expect(c.m1).toBeUndefined();
    expect(c.m8).toBeUndefined();
  });
  it('tenhou: 萬子は 1m / 9m のみ', () => {
    const c = countBy(generateTilePool(tenhouRule));
    expect(c.m1).toBe(4);
    expect(c.m9).toBe(4);
    expect(c.m7).toBeUndefined();
  });

  it('p5 / s5 は 金 1 + 赤 1 + 通常 2 [hongpai=1]', () => {
    const c = countBy(generateTilePool(baseRule));
    expect(c.gp).toBe(1);
    expect(c.p0).toBe(1);
    expect(c.p5).toBe(2);
    expect(c.gs).toBe(1);
    expect(c.s0).toBe(1);
    expect(c.s5).toBe(2);
  });

  it('z5 [白] は 4 色別牌 各 1 枚', () => {
    const c = countBy(generateTilePool(baseRule));
    expect(c.z5b).toBe(1);
    expect(c.z5r).toBe(1);
    expect(c.z5g).toBe(1);
    expect(c.z5y).toBe(1);
    expect(c.z5).toBeUndefined();
  });
  it('z4 [北] は 金北 1 + 通常 z4 3', () => {
    const c = countBy(generateTilePool(baseRule));
    expect(c.gN).toBe(1);
    expect(c.z4).toBe(3);
  });
  it('華牌 f1-f4 各 2 枚 [計 8]', () => {
    const c = countBy(generateTilePool(baseRule));
    expect(c.f1).toBe(2);
    expect(c.f2).toBe(2);
    expect(c.f3).toBe(2);
    expect(c.f4).toBe(2);
  });
});

describe('Shan3 構築 / paishu', () => {
  it('初期 paishu = 116 - 16 リンシャン - 4 ドラ予約 = 96', () => {
    const s = new Shan3(baseRule);
    expect(s.paishu).toBe(96);
  });
  it('_initialPai は 116 枚の snapshot', () => {
    const s = new Shan3(baseRule);
    expect(s._initialPai).toHaveLength(116);
  });
  it('baopai 2 枚 / fubaopai 2 枚 [fudora=true]', () => {
    const s = new Shan3(baseRule) as any;
    expect(s._baopai).toHaveLength(2);
    expect(s._fubaopai).toHaveLength(2);
  });
  it('baopai は華牌 [f*] を skip', () => {
    const s = new Shan3(baseRule) as any;
    for (const b of s._baopai) expect((b as string).startsWith('f')).toBe(false);
    for (const b of s._fubaopai ?? []) expect((b as string).startsWith('f')).toBe(false);
  });
  it('fudora=false なら fubaopai は null', () => {
    const s = new Shan3({ ...baseRule, fudora: false }) as any;
    expect(s._fubaopai).toBeNull();
  });
});

describe('Shan3 rinshan / drawNewDora', () => {
  it('consumeRinshan で rinshanUsed +1', () => {
    const s = new Shan3(baseRule);
    expect(s.rinshanUsed).toBe(0);
    s.consumeRinshan();
    expect(s.rinshanUsed).toBe(1);
  });
  it('drawNewDora(false) で baopai +1 / 残山 -1', () => {
    const s = new Shan3(baseRule) as any;
    const before = s.paishu;
    const beforeBaopai = s._baopai.length;
    const p = s.drawNewDora(false);
    expect(p).not.toBeNull();
    expect(s._baopai.length).toBe(beforeBaopai + 1);
    expect(s.paishu).toBe(before - 1);
  });
  it('drawNewDora(true) で fubaopai +1', () => {
    const s = new Shan3(baseRule) as any;
    const beforeFu = s._fubaopai.length;
    s.drawNewDora(true);
    expect(s._fubaopai.length).toBe(beforeFu + 1);
  });
  it('consumeWangpai は consumeRinshan の alias [後方互換]', () => {
    const s = new Shan3(baseRule);
    expect(s.consumeWangpai()).toBe(true);
    expect(s.rinshanUsed).toBe(1);
  });
});
