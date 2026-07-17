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
  it('flower indicators remain physically separated from the live wall', () => {
    const pool = Array.from({ length: 116 }, () => 'p1');
    pool[4] = 'f1';
    pool[6] = 'f4';
    const s = new Shan3(baseRule, pool as any) as any;
    expect(s._baopai).toContain('f1');
    expect(s._fubaopai).toContain('f4');
    expect(s._pai).not.toContain('f1');
    expect(s._pai).not.toContain('f4');
  });
  it('fudora=false なら fubaopai は null', () => {
    const s = new Shan3({ ...baseRule, fudora: false }) as any;
    expect(s._fubaopai).toBeNull();
  });
});

describe('Shan3 rinshan / drawNewDora', () => {
  it('追加ドラは巡目に左右されず、配牌時に固定された山の深い側から開く', () => {
    // zimo は配列末尾から進む。追加ドラは反対側（王牌との境界）に
    // 配牌時から固定されているため、何巡進んでも同じ現物になる。
    const pool = Array.from({ length: 116 }, () => 'z1');
    pool[4] = 'm7';
    pool[5] = 'm9';
    pool[6] = 'p1';
    pool[7] = 's1';
    pool[20] = 'p2';
    pool[21] = 's2';
    for (let i = 96; i < pool.length; i += 1) pool[i] = i % 2 === 0 ? 'p9' : 's9';

    const early = new Shan3(baseRule, pool as any);
    const late = new Shan3(baseRule, pool as any);
    const initialBaopai = [...late.baopai];
    const initialFubaopai = [...(late.fubaopai ?? [])];

    for (let i = 0; i < 12; i += 1) late.zimo();
    expect(late.baopai).toEqual(initialBaopai);
    expect(late.fubaopai).toEqual(initialFubaopai);

    const earlyFront = early.drawNewDora(false);
    const earlyBack = early.drawNewDora(true);
    const lateFront = late.drawNewDora(false);
    const lateBack = late.drawNewDora(true);

    expect([lateFront, lateBack]).toEqual([earlyFront, earlyBack]);
    expect([lateFront, lateBack]).toEqual(['p2', 's2']);
    expect(late.baopai).toEqual([...initialBaopai, 'p2']);
    expect(late.fubaopai).toEqual([...initialFubaopai, 's2']);
  });

  it('rejects a kan when only one live-wall indicator tile remains', () => {
    const s = new Shan3(baseRule) as any;
    s._pai = ['p1'];
    expect(s.canOpenKanDora).toBe(false);
    expect(() => s.gangzimo()).toThrow(/not enough wall tiles/);
  });

  it('blind 山でも裏ドラ秘匿 null を裏ドラなしと誤認しない', () => {
    const hiddenUra = Shan3.createBlind({
      rule: baseRule,
      baopai: ['p1'],
      fubaopai: null,
      paishu: 1,
    });
    expect(hiddenUra.fubaopai).toBeNull();
    expect(hiddenUra.canOpenKanDora).toBe(false);

    const noUra = Shan3.createBlind({
      rule: { ...baseRule, fudora: false },
      baopai: ['p1'],
      fubaopai: null,
      paishu: 1,
    });
    expect(noUra.canOpenKanDora).toBe(true);
  });

  it('嶺上枯渇後の華牌は存在しない補充牌の使用数を増やさない', () => {
    const s = new Shan3(baseRule) as any;
    s._pai = ['p1', 'f1'];
    s._rinshan = [];
    s.rinshanUsed = 16;

    expect(s.zimo()).toBe('p1');
    expect(s.lastDrawnHuapai).toEqual(['f1']);
    expect(s.rinshanUsed).toBe(16);
  });

  it('replaces a flower in the last live-wall slot before exhausting the hand', () => {
    const s = new Shan3(baseRule) as any;
    s._pai = ['f1'];
    s._rinshan = ['s9'];
    s.rinshanUsed = 0;

    expect(s.zimo()).toBe('s9');
    expect(s.lastDrawnHuapai).toEqual(['f1']);
    expect(s.paishu).toBe(0);
    expect(s.rinshanUsed).toBe(1);
  });

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
