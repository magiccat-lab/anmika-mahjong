import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// [2026-10-15 リョー「演出一覧のところ、ページが見づらいから、ラフで画像とか入れてあげよう」] 演出一覧の行の絵を本物の卓で撮る。
// 普段の試験では回さない (FX_ODDS_IMAGES=1 の時だけ)。撮った png を ffmpeg で 320x180 の webp にして public/fx_odds/ に置く
const OUT = 'public/fx_odds';
const RAW = 'tmp/fx_odds_raw';
test.skip(!process.env.FX_ODDS_IMAGES, 'FX_ODDS_IMAGES=1 の時だけ撮る');
test.setTimeout(180_000);

type Shot = { name: string; color?: string; teaser?: string | null; freeze?: string | null; step?: number; premium?: boolean; waitMs?: number; pull?: number };
const SHOTS: Shot[] = [
  { name: 'freeze_black', freeze: 'black', waitMs: 120 },
  { name: 'freeze_still', freeze: 'still', waitMs: 700 },
  { name: 'premium', step: 4, premium: true, waitMs: 900 },
  { name: 'teaser_mono', teaser: 'mono', step: 3, waitMs: 1000 },
  { name: 'teaser_line', teaser: 'line', step: 3, waitMs: 650 },
  { name: 'teaser_bolt', teaser: 'bolt', step: 3, waitMs: 450 },
  { name: 'teaser_none', teaser: 'none', step: 1, waitMs: 700 },
  { name: 'bolt_rainbow', teaser: 'bolt', step: 4, waitMs: 450 },
  { name: 'bolt_gold', teaser: 'bolt', step: 3, waitMs: 450 },
  { name: 'bolt_white', teaser: 'bolt', step: 1, waitMs: 450 },
  // 光りの段: 予告なしで、点がのぞく手前 (0.44) まで絞った所。溜め (0.37〜) は指の半分しか進まないので 0.51 引く
  ...[4, 3, 2, 1, 0].map((k) => ({ name: `step${k}`, teaser: 'none', step: k, waitMs: 500, pull: 0.51 })),
];

async function solo(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible();
  await page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
  await page.waitForTimeout(800);
}

test('演出一覧の絵を撮る', async ({ browser }) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(RAW, { recursive: true });
  for (const s of SHOTS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await solo(page);
    await page.evaluate((s) => {
      const w = window as any;
      w.__forceTeaser = s.teaser ?? null;
      w.__forceFreeze = s.freeze ?? null;
      w.__forceStep = typeof s.step === 'number' ? s.step : undefined;
      w.__forcePremium = typeof s.premium === 'boolean' ? s.premium : false;
      const g = w.__game;
      g.game.lizhi.add(0);
      g.game.feverActive = [false, false, false];
      g.game.events.push({ type: 'zimo', player: 0, pai: ({ blue: 'z5b', red: 'z5r' } as any)[s.color ?? 'blue'] });
      w.__gameStore.setCpuSeats([]);
    }, s);
    await expect(page.locator('.sq-tile')).toBeVisible();
    if (s.pull) {
      await expect(page.locator('.sq-band.teaser, .sq-premium, .fz, .sq-ci')).toHaveCount(0, { timeout: 6000 });
      await page.waitForTimeout(300);
      const box = (await page.locator('.sq-tile').boundingBox())!;
      const x = box.x + box.width / 2, y0 = box.y + box.height - 4;
      await page.mouse.move(x, y0); await page.mouse.down();
      for (let i = 1; i <= 30; i += 1) { await page.mouse.move(x, y0 - box.height * 1.1 * s.pull * (i / 30)); await page.waitForTimeout(20); }
      await page.mouse.up();
    }
    await page.waitForTimeout(s.waitMs ?? 500);
    const png = path.join(RAW, `${s.name}.png`);
    await page.screenshot({ path: png });
    await ctx.close();
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', png, '-vf', 'scale=320:180', '-quality', '80', path.join(OUT, `${s.name}.webp`)]);
  }
});
