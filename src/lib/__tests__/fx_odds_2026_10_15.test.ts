// [2026-10-15 fx10 の答え] 演出一覧のページ。[2026-10-25] 白ぽっちの表は pochiFx の表から数える形に直した (pochi_movie_2026_10_25 が本体)
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { diceBallRows, diceReachRows, pct, pochiExtraRows, pochiGlowRows, pochiOpeningRows, pochiPushRows } from '../fxOdds';

describe('白ぽっちの表', () => {
  it('引いた瞬間は足して 100%、フリーズとプレミアは確定', () => {
    const rows = pochiOpeningRows();
    expect(rows.reduce((a, r) => a + r.rate, 0)).toBeCloseTo(1, 9);
    for (const r of rows.filter((x) => x.name.startsWith('フリーズ') || x.name.startsWith('プレミア'))) expect(r.hit).toBe(1);
  });
  it('当たりの元の割合を変えると数も変わる (確定の時に近い形)', () => {
    const none = (p: number) => pochiOpeningRows(p).find((r) => r.none)!;
    expect(none(1).hit).toBe(1);
    expect(none(0).hit).toBe(0);
    expect(none(0.5).rate).toBeCloseTo(0.28, 9);
  });
  it('光りの虹は確定、PUSH 虹も確定', () => {
    expect(pochiGlowRows().find((r) => r.name.startsWith('虹'))!.hit).toBe(1);
    expect(pochiPushRows().find((r) => r.name === 'PUSH 虹')!.hit).toBe(1);
  });
  it('告知ランプ (先 15% ・ 後 35%) と遅れ (フリーズの分を除く)', () => {
    const [pre, post, delay] = pochiExtraRows();
    expect(pre.rate).toBeCloseTo(0.15, 9);
    expect(post.rate).toBeCloseTo(0.35, 9);
    expect(pre.hit).toBe(1);
    expect(delay.rate).toBeCloseTo(0.5 * (1 - 0.028) * 0.2 + 0.5 * 0.05, 9);
  });
  it('絵のある行の絵はある', () => {
    for (const r of [...pochiOpeningRows(), ...pochiGlowRows(), ...pochiExtraRows()]) {
      if (r.img) expect(fs.existsSync(`public/fx_odds/${r.img}.webp`), r.img).toBe(true);
    }
  });
});

describe('サイコロの表', () => {
  it('玉の色は足して 100%、虹は確定', () => {
    const rows = diceBallRows();
    expect(rows.reduce((a, r) => a + r.rate, 0)).toBeCloseTo(1, 9);
    expect(rows[0].ball).toBe('rainbow');
    expect(rows[0].hit).toBe(1);
  });
  it('リーチは足して 100%', () => {
    expect(diceReachRows().reduce((a, r) => a + r.rate, 0)).toBeCloseTo(1, 9);
  });
  it('% の字', () => {
    expect(pct(null)).toBe('—');
    expect(pct(0)).toBe('0%');
    expect(pct(1)).toBe('100%');
    expect(pct(0.005)).toBe('0.50%');
    expect(pct(0.123)).toBe('12.3%');
  });
});
