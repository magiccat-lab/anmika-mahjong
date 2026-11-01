// [2026-11-02 リョー「演出が出た瞬間に方向性決まるの微妙だから無演出とかでも一定の確率でちゃんと当たるようにして欲しい、
//  もうちょっと全体のバランス考えて」「サイコロとかの演出も足すとかね」「サイコロのゾロ目連続ボーナスとかももっと強調してほしい」
//  「フィーバーの連続の時に通算何点何枚きたかとか出してほしい」]
import { describe, it, expect } from 'vitest';
import {
  CRACK_TABLE, DELAY_RATE, GLOW_ORDER, GLOW_TABLE, LAMP_PRE_RATE, OPENING_TABLE, PARTICLE_TABLE, PULSE_TABLE, PUSH_TABLE, type OddsTable,
} from '../pochiFx';
import { ballColor, planRoll, STRONG_REACH_RATE, zoroBonusBase, zoroStreakAt } from '../diceFx';
import { diceReachRows, diceBallRows } from '../fxOdds';
import { EMPTY_FEVER_RUNS, feverRunTotal, trackFeverRuns } from '../feverRun';

/** 見えている演出の組ごとに当たりの割合を数える (当たりの元の割合 5 割) */
function visiblePosteriors(): Array<{ w: number; hit: number; plain: boolean }> {
  const ent = <K extends string>(t: OddsTable<K>) => Object.entries(t) as Array<[K, readonly [number, number]]>;
  const vis = new Map<string, [number, number]>();
  for (const good of [true, false]) {
    const j = good ? 0 : 1;
    for (const [o, po] of ent(OPENING_TABLE)) for (const [g, pg] of ent(GLOW_TABLE)) for (const [pu, ppu] of ent(PULSE_TABLE))
      for (const [pa, ppa] of ent(PARTICLE_TABLE)) for (const [c, pc] of ent(CRACK_TABLE)) for (const [ps, pps] of ent(PUSH_TABLE)) {
        let p = 0.5 * po[j] * pg[j] * ppu[j] * ppa[j] * pc[j] * pps[j] / 1e12;
        if (p === 0) continue;
        const conf = o === 'freeze_black' || o === 'freeze_still' || o === 'premium';
        const sg = conf ? 'rainbow' : g;
        const dev = GLOW_ORDER.indexOf(sg) >= GLOW_ORDER.indexOf('red');
        for (const lamp of [true, false]) {
          const pl = good ? (lamp ? LAMP_PRE_RATE : 1 - LAMP_PRE_RATE) : (lamp ? 0 : 1);
          if (!pl) continue;
          for (const delay of [true, false]) {
            const dr = o.startsWith('freeze') ? 0 : good ? DELAY_RATE.good : DELAY_RATE.bad;
            const pd = delay ? dr : 1 - dr;
            if (!pd) continue;
            const key = [conf ? 'C' : o, sg, pu, dev ? pa : '-', dev ? c : '-', ps, lamp, delay].join('|');
            const a = vis.get(key) ?? [0, 0];
            a[j] += p * pl * pd;
            vis.set(key, a);
          }
        }
      }
  }
  return [...vis.entries()].map(([k, [g, b]]) => ({ w: g + b, hit: g / (g + b), plain: k === 'none|white|slow|-|-|normal|false|false' }));
}

describe('白ぽっちの演出の均し (11-02)', () => {
  const rows = visiblePosteriors();
  const share = (f: (h: number) => boolean) => rows.filter((r) => f(r.hit)).reduce((a, r) => a + r.w, 0);
  it('全部が地味 (予告なし ・ 白 ・ ゆっくり ・ PUSH 通常) でも 5% 以上当たる (前は 0.07%)', () => {
    const plain = rows.find((r) => r.plain)!;
    expect(plain.hit).toBeGreaterThan(0.05);
  });
  it('見えている演出だけで当たりが 15〜85% の間に残る回が 6 割以上 (前は 18%)', () => {
    expect(share((h) => h >= 0.15 && h <= 0.85)).toBeGreaterThan(0.6);
  });
  it('ほぼ外れ (5% 未満) と決まる回は 5% 未満、確定は 2 割以下', () => {
    expect(share((h) => h < 0.05)).toBeLessThan(0.05);
    expect(share((h) => h > 0.999)).toBeLessThan(0.2);
  });
  it('引いた瞬間の予告だけでは決まらない: 予告なしでも 3 割以上、確定以外の予告は 8 割未満', () => {
    const rel = (k: keyof typeof OPENING_TABLE) => OPENING_TABLE[k][0] / (OPENING_TABLE[k][0] + OPENING_TABLE[k][1]);
    expect(rel('none')).toBeGreaterThan(0.3);
    for (const k of ['mono', 'bolt', 'line'] as const) expect(rel(k)).toBeLessThan(0.8);
  });
});

describe('サイコロの演出 (11-02)', () => {
  it('白の玉でも当たる (当たりの 25%)', () => {
    const g = Array.from({ length: 1000 }, (_, i) => (i + 0.5) / 1000);
    expect(g.filter((r) => ballColor('hit', r) === 'white').length).toBe(250);
    const white = diceBallRows().find((r) => r.name === '玉 白')!;
    expect(white.hit!).toBeGreaterThan(0.02);
  });
  it('強リーチはリーチの時だけ、当たりほど出やすい。一覧に強リーチの行がある', () => {
    expect(STRONG_REACH_RATE.hit).toBeGreaterThan(STRONG_REACH_RATE.miss);
    let strongNoReach = 0;
    for (let s = 0; s < 300; s++) {
      const p = planRoll([1, 6], { dice: [2, 3], hit: false, zoro: false }, [s]);
      if (p.strong) strongNoReach++;
    }
    expect(strongNoReach).toBe(0);
    const rows = diceReachRows();
    const strong = rows.find((r) => r.name.startsWith('強リーチ'))!;
    const normal = rows.find((r) => r.name.startsWith('リーチ ('))!;
    expect(strong.hit!).toBeGreaterThan(0.25);
    expect(normal.hit!).toBeGreaterThan(0);
    expect(strong.hit!).toBeGreaterThan(normal.hit!);
    expect(rows.reduce((a, r) => a + r.rate, 0)).toBeCloseTo(1, 6);
  });
  it('ゾロ目の連続の数と特典の枚数 (store と同じ: 1・1 は 111、ほかは目 × 11)', () => {
    const rolls = [{ zoro: false }, { zoro: true }, { zoro: true }, { zoro: true }, { zoro: false }];
    expect([0, 1, 2, 3, 4].map((i) => zoroStreakAt(rolls, i))).toEqual([0, 1, 2, 3, 0]);
    expect(zoroBonusBase(1)).toBe(111);
    expect(zoroBonusBase(4)).toBe(44);
  });
});

describe('フィーバーの通算 (11-02)', () => {
  const at = (fa: boolean, defen: number, chip: number, rk = '0-0-0') => ({ feverActive: { 0: fa, 1: false, 2: false }, defen: [defen, 0, 0], chip: { 0: chip, 1: 0, 2: 0 }, rk });
  it('フィーバーに入った時からの差を出し、終わっても局が変わるまで残す', () => {
    let r = trackFeverRuns(EMPTY_FEVER_RUNS, at(false, 30000, 10));
    expect(r[0]).toBeNull();
    r = trackFeverRuns(r, at(true, 29000, 10));
    expect(feverRunTotal(r[0])).toBeNull();
    r = trackFeverRuns(r, at(true, 41000, 22));
    expect(feverRunTotal(r[0])).toEqual({ defen: 12000, chip: 12 });
    r = trackFeverRuns(r, at(true, 53000, 40));
    expect(feverRunTotal(r[0])).toEqual({ defen: 24000, chip: 30 });
    r = trackFeverRuns(r, at(false, 53000, 40));
    expect(feverRunTotal(r[0])).toEqual({ defen: 24000, chip: 30 });
    // 終わった後の動きは混ぜない
    r = trackFeverRuns(r, at(false, 60000, 50));
    expect(feverRunTotal(r[0])).toEqual({ defen: 24000, chip: 30 });
    r = trackFeverRuns(r, at(false, 60000, 50, '0-1-0'));
    expect(r[0]).toBeNull();
  });
  it('次のフィーバーは 0 から数え直す', () => {
    let r = trackFeverRuns(EMPTY_FEVER_RUNS, at(true, 30000, 0));
    r = trackFeverRuns(r, at(true, 38000, 8));
    r = trackFeverRuns(r, at(false, 38000, 8));
    r = trackFeverRuns(r, at(true, 37000, 8, '0-1-0'));
    expect(feverRunTotal(r[0])).toBeNull();
  });
});
