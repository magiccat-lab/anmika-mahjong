// [2026-10-15 fx10 の答え] 告知ランプ (画面の外周が光る、L1 a) と遅れ (ピキーンが 0.3 秒遅れる、B1 a) を本番に
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import fs from 'node:fs';
import PochiSqueeze from '../PochiSqueeze.svelte';
import { DELAY_MS, DELAY_RATE, FREEZE_RATE, LAMP_PRE_RATE, delayRoll, lampRoll } from '../pochiFx';
import { pochiExtraRows } from '../fxOdds';
import { sanitizePochiFx } from '../../../server/ws_server';

const grid = (n = 1000) => Array.from({ length: n }, (_, i) => (i + 0.5) / n);

describe('告知ランプ (fx10 L1)', () => {
  it('当たりなら必ず光り、先告知 3 割 ・ 後告知 7 割。外れは光らない', () => {
    const g = grid();
    expect(g.every((r) => lampRoll(true, r) !== null)).toBe(true);
    expect(g.filter((r) => lampRoll(true, r) === 'pre').length / 1000).toBeCloseTo(LAMP_PRE_RATE, 3);
    expect(g.every((r) => lampRoll(false, r) === null)).toBe(true);
  });
  it('点く前の絞りには外周の光りが無い (先告知でも onMount の後に点く)', () => {
    const { body } = render(PochiSqueeze, { props: { color: 'blue', step: 2, teaser: 'none', lamp: 'pre' } });
    expect(body).not.toContain('sq-edge');
    expect(body).toContain('sq-tile');
  });
  it('他の席へもランプの先 ・ 後が流れる。知らない値は捨てる', () => {
    expect(sanitizePochiFx({ phase: 'open', lamp: 'pre' })).toMatchObject({ lamp: 'pre' });
    expect(sanitizePochiFx({ phase: 'open', lamp: 'post' })).toMatchObject({ lamp: 'post' });
    expect(sanitizePochiFx({ phase: 'open', lamp: 'side' })).not.toHaveProperty('lamp');
    expect(sanitizePochiFx({ phase: 'peel', peel: 0.2, lamp: 'pre' })).not.toHaveProperty('lamp');
  });
});

describe('遅れ (fx10 B1)', () => {
  it('当たりの 20%、外れの 5% で遅れ、遅れは 0.3 秒', () => {
    const g = grid();
    expect(g.filter((r) => delayRoll(true, r)).length / 1000).toBeCloseTo(DELAY_RATE.good, 3);
    expect(g.filter((r) => delayRoll(false, r)).length / 1000).toBeCloseTo(DELAY_RATE.bad, 3);
    expect(DELAY_MS).toBe(300);
  });
  it('他の席へも遅れが流れる (true の時だけ)', () => {
    expect(sanitizePochiFx({ phase: 'open', delay: true })).toMatchObject({ delay: true });
    expect(sanitizePochiFx({ phase: 'open', delay: 'yes' })).not.toHaveProperty('delay');
  });
});

describe('演出一覧の「引いた後」', () => {
  const rows = pochiExtraRows();
  it('先告知 15% ・ 後告知 35% で、どちらも当たり確定', () => {
    const pre = rows.find((r) => r.name.includes('先告知'))!;
    const post = rows.find((r) => r.name.includes('後告知'))!;
    expect(pre.rate).toBeCloseTo(0.15, 3);
    expect(post.rate).toBeCloseTo(0.35, 3);
    expect(pre.hit).toBe(1);
    expect(post.hit).toBe(1);
  });
  it('遅れはフリーズの分を除いて数える (当たりの 20% のうちフリーズの 9% は遅れない)', () => {
    const d = rows.find((r) => r.name.startsWith('遅れ'))!;
    const noFreeze = 1 - FREEZE_RATE.black - FREEZE_RATE.still;
    const good = noFreeze * DELAY_RATE.good, bad = DELAY_RATE.bad;
    expect(d.rate).toBeCloseTo((good + bad) / 2, 4);
    expect(d.hit!).toBeCloseTo(good / (good + bad), 4);
  });
  it('ランプの行の絵が public/fx_odds にある', () => {
    for (const r of rows.filter((x) => x.img)) expect(fs.existsSync(`public/fx_odds/${r.img}.webp`)).toBe(true);
  });
});
