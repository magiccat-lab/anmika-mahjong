// [2026-10-25 リョー「白ぽっち演出の作り直し 仕様」] 表の当たり時 ・ 外れ時の % をそのまま引き、ムービーの長さは当落で変えない
import { describe, expect, it } from 'vitest';
import {
  ALL_TABLES, CRACK_TABLE, DEFAULT_PLAN, GLOW_ORDER, GLOW_TABLE, OPENING_TABLE, PARTICLE_TABLE, PREMIUM_TABLE, PULSE_TABLE, PUSH_TABLE,
  develops, glowSteps, movieTimeline, pickFromTable, planFromRelay, pochiGood, rollPlan, shownGlow,
  type GlowColor, type OddsTable, type PochiPlan,
} from '../pochiFx';
import { pochiCrackRows, pochiExtraRows, pochiGlowRows, pochiOpeningRows, pochiParticleRows, pochiPremiumRows, pochiPulseRows, pochiPushRows } from '../fxOdds';

/** 種つきの乱数 (mulberry32)。試験のたびに同じ列 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sum = (t: OddsTable<string>, col: 0 | 1) => Object.values(t).reduce((a, v) => a + v[col], 0);

describe('表 (仕様の当たり時 ・ 外れ時の列)', () => {
  it('各表の 2 列はそれぞれ合計 100', () => {
    for (const [name, t] of Object.entries(ALL_TABLES)) {
      expect(sum(t, 0), `${name} 当たり`).toBeCloseTo(100, 9);
      expect(sum(t, 1), `${name} 外れ`).toBeCloseTo(100, 9);
    }
  });
  it('仕様の数そのまま (抜き打ち)', () => {
    expect(OPENING_TABLE.freeze_black).toEqual([0.8, 0]);
    expect(OPENING_TABLE.line).toEqual([24, 30]);
    expect(GLOW_TABLE.gold).toEqual([49.3, 6.7]);
    expect(GLOW_TABLE.rainbow[1]).toBe(0);
    expect(PULSE_TABLE.blink).toEqual([3, 0]);
    expect(PARTICLE_TABLE.none).toEqual([40, 80]);
    expect(CRACK_TABLE.all).toEqual([5, 0]);
    expect(PUSH_TABLE.normal).toEqual([57, 88]);
    expect(PREMIUM_TABLE).toEqual({ kirin: 0.5, revive: 0.5 });
  });
  it('外れでは出ない物 (虹 ・ フリーズ ・ プレミア ・ 牌全体のひび ・ PUSH 虹) は外れの列が 0', () => {
    for (let r = 0; r < 1; r += 0.001) {
      expect(pickFromTable(GLOW_TABLE, false, r)).not.toBe('rainbow');
      expect(['freeze_black', 'freeze_still', 'premium']).not.toContain(pickFromTable(OPENING_TABLE, false, r));
      expect(pickFromTable(CRACK_TABLE, false, r)).not.toBe('all');
      expect(pickFromTable(PUSH_TABLE, false, r)).not.toBe('rainbow');
    }
  });
  it('当落は色と確定で決まる', () => {
    expect(pochiGood('blue', null)).toBe(true);
    expect(pochiGood('red', null)).toBe(false);
    expect(pochiGood('red', 'good')).toBe(true);
    expect(pochiGood('blue', 'bad')).toBe(false);
  });
});

describe('100 万回の引き (仕様 7: 当たり 50 ± 0.2%、出る割合 ・ 期待度は ± 0.3 pt)', () => {
  const N = 1_000_000;
  const rng = mulberry32(20261025);
  const count: Record<string, Record<string, { n: number; good: number }>> = {};
  let goods = 0;
  let premiumOnBad = 0, lampMissing = 0, lampOnBad = 0, delayOnFreeze = 0;
  const bump = (table: string, key: string, good: boolean) => {
    const t = (count[table] ??= {});
    const c = (t[key] ??= { n: 0, good: 0 });
    c.n += 1;
    if (good) c.good += 1;
  };
  for (let i = 0; i < N; i += 1) {
    const good = rng() < 0.5;
    if (good) goods += 1;
    const plan = rollPlan(good, rng);
    bump('opening', plan.opening, good); bump('glow', plan.glow, good); bump('pulse', plan.pulse, good);
    bump('particle', plan.particle, good); bump('crack', plan.crack, good); bump('push', plan.push, good);
    if (plan.premium) bump('premium', plan.premium, good);
    if (plan.premium && !good) premiumOnBad += 1;
    if (good && !plan.lamp) lampMissing += 1;
    if (!good && plan.lamp) lampOnBad += 1;
    if (plan.delay && plan.opening.startsWith('freeze')) delayOnFreeze += 1;
  }
  it('当たりは 50 ± 0.2%', () => {
    expect(Math.abs(goods / N - 0.5) * 100).toBeLessThan(0.2);
  });
  it('①〜⑥ の出る割合と期待度が表の数の ± 0.3 pt', () => {
    for (const [name, t] of Object.entries(ALL_TABLES)) {
      for (const [key, [g, b]] of Object.entries(t as OddsTable<string>)) {
        const expRate = (g + b) / 2;
        const c = count[name][key] ?? { n: 0, good: 0 };
        expect(Math.abs((c.n / N) * 100 - expRate), `${name}.${key} 出る割合`).toBeLessThan(0.3);
        if (expRate > 0) {
          const expHit = (g / (g + b)) * 100;
          expect(Math.abs((c.good / c.n) * 100 - expHit), `${name}.${key} 期待度`).toBeLessThan(0.3);
        }
      }
    }
  });
  it('プレミアは当たりの時だけ、当たりの 0.5% ずつ', () => {
    expect(premiumOnBad).toBe(0);
    for (const k of ['kirin', 'revive']) expect(Math.abs((count.premium[k].n / goods) * 100 - 0.5), k).toBeLessThan(0.3);
  });
  it('告知ランプは当たりなら必ず、外れでは点かない。遅れはフリーズでは引かない', () => {
    expect(lampMissing).toBe(0);
    expect(lampOnBad).toBe(0);
    expect(delayOnFreeze).toBe(0);
  });
  it('演出一覧の表の数は、同じ数式なので引きと合う', () => {
    const rows = { opening: pochiOpeningRows(), glow: pochiGlowRows(), pulse: pochiPulseRows(), particle: pochiParticleRows(), crack: pochiCrackRows(), push: pochiPushRows() };
    for (const [name, rs] of Object.entries(rows)) {
      expect(rs.reduce((a, r) => a + r.rate, 0), name).toBeCloseTo(1, 9);
      const total = Object.values(count[name]).reduce((a, c) => a + c.n, 0);
      expect(total).toBe(N);
    }
    const none = pochiOpeningRows().find((r) => r.none)!;
    expect(none.rate).toBeCloseTo(0.28, 9);
    expect(none.hit!).toBeCloseTo(6 / 56, 9);
    for (const r of pochiOpeningRows().slice(0, 3)) expect(r.hit).toBe(1);
    expect(pochiExtraRows()[0].rate).toBeCloseTo(0.15, 9);
    expect(pochiPremiumRows().map((r) => r.hit)).toEqual([1, 1]);
    expect(pochiPremiumRows()[0].rate).toBeCloseTo(0.0025, 9);
  });
});

describe('ムービーの長さは引いた演出と確定だけで決まる (仕様 3: 当落で変えない)', () => {
  const plans: PochiPlan[] = [];
  const rng = mulberry32(7);
  for (let i = 0; i < 2000; i += 1) plans.push(rollPlan(i % 2 === 0, rng));
  it('同じ plan なら当落が違っても同じ尺 (関数は当落を受け取らない)', () => {
    for (const p of plans) {
      const a = movieTimeline(p, null);
      const b = movieTimeline({ ...p }, null);
      expect(a).toEqual(b);
      expect(a.untilPushMs).toBe(a.openingMs + a.kakuteiMs + a.glowMs + a.developMs + a.tameMs);
    }
  });
  it('赤以上だけ発展と溜めが入る。緑以下は光りの段階から PUSH へ', () => {
    for (const p of plans) {
      const t = movieTimeline(p, null);
      // フリーズ ・ プレミアの予告は虹で見せるので、画面に出す色で判定する
      const dev = GLOW_ORDER.indexOf(shownGlow(p, null)) >= GLOW_ORDER.indexOf('red');
      expect(develops(p, null)).toBe(dev);
      expect(t.developMs > 0).toBe(dev);
      expect(t.tameMs > 0).toBe(dev);
    }
  });
  it('光りの段階の尺は色に関係なく一定', () => {
    const glows = new Set(plans.map((p) => movieTimeline(p, null).glowMs));
    expect(glows.size).toBe(1);
  });
  it('確定: 正は虹 ・ 逆は白で見せ、帯の分だけ長い。フリーズ ・ プレミアの予告は虹', () => {
    const p: PochiPlan = { ...DEFAULT_PLAN, glow: 'blue' };
    expect(shownGlow(p, 'good')).toBe('rainbow');
    expect(shownGlow({ ...p, glow: 'gold' }, 'bad')).toBe('white');
    expect(shownGlow({ ...p, opening: 'freeze_black' }, null)).toBe('rainbow');
    expect(shownGlow({ ...p, opening: 'premium' }, null)).toBe('rainbow');
    expect(movieTimeline(p, 'good').kakuteiMs).toBeGreaterThan(0);
    expect(movieTimeline(p, null).kakuteiMs).toBe(0);
  });
  it('色の上がる時刻は 1 色ずつ', () => {
    expect(glowSteps('white')).toEqual([]);
    expect(glowSteps('green').map((s) => s.color)).toEqual(['blue', 'green']);
    expect(glowSteps('rainbow').length).toBe(5);
    const last = glowSteps('rainbow').at(-1)!;
    expect(last.at).toBeLessThanOrEqual(movieTimeline(DEFAULT_PLAN, null).glowMs);
  });
  it('中継で届いた物は表に無い値を既定に戻す', () => {
    expect(planFromRelay({ opening: 'bolt', glow: 'purple', push: 'gold', lamp: 'pre', delay: true, premium: 'kirin' })).toEqual({
      ...DEFAULT_PLAN, opening: 'bolt', glow: 'white', push: 'gold', lamp: 'pre', delay: true, premium: 'kirin',
    });
    expect(planFromRelay(undefined)).toEqual(DEFAULT_PLAN);
  });
});
