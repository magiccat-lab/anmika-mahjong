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

type Shot = { name: string; color?: string; plan?: Record<string, unknown>; waitMs?: number; push?: boolean };
// [2026-10-25] 台本 (plan) を決め打ちして撮る。光りの段は skip で PUSH まで飛ばさず、段の途中の絵を撮る
const SHOTS: Shot[] = [
  { name: 'freeze_black', plan: { opening: 'freeze_black' }, waitMs: 120 },
  { name: 'freeze_still', plan: { opening: 'freeze_still' }, waitMs: 700 },
  { name: 'premium', plan: { opening: 'premium' }, waitMs: 900 },
  { name: 'teaser_mono', plan: { opening: 'mono' }, waitMs: 1000 },
  { name: 'teaser_line', plan: { opening: 'line' }, waitMs: 650 },
  { name: 'teaser_bolt', plan: { opening: 'bolt' }, waitMs: 450 },
  { name: 'teaser_none', plan: { opening: 'none' }, waitMs: 700 },
  { name: 'bolt_rainbow', plan: { opening: 'bolt', glow: 'rainbow' }, waitMs: 450 },
  { name: 'bolt_gold', plan: { opening: 'bolt', glow: 'gold' }, waitMs: 450 },
  { name: 'bolt_white', plan: { opening: 'bolt', glow: 'white' }, waitMs: 450 },
  // [fx10] 告知ランプ: 先告知は引いた直後、後告知は PUSH の後
  { name: 'lamp_pre', plan: { opening: 'none', lamp: 'pre' }, waitMs: 900 },
  { name: 'lamp_post', plan: { opening: 'none', lamp: 'post' }, waitMs: 700, push: true },
  ...(['rainbow', 'gold', 'red', 'green', 'blue', 'white'] as const).map((glow) => ({ name: `glow_${glow}`, plan: { opening: 'none', glow }, waitMs: 3200 })),
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
      w.__forcePlan = { opening: 'none', glow: 'white', pulse: 'slow', particle: 'none', crack: 'none', push: 'normal', lamp: null, delay: false, premium: null, ...(s.plan ?? {}) };
      const g = w.__game;
      g.game.lizhi.add(0);
      g.game.feverActive = [false, false, false];
      g.game.events.push({ type: 'zimo', player: 0, pai: ({ blue: 'z5b', red: 'z5r' } as any)[s.color ?? 'blue'] });
      w.__gameStore.setCpuSeats([]);
    }, s);
    await expect(page.locator('.sq-tile')).toBeVisible();
    if (s.push) {
      await page.locator('[data-testid=pochi-skip]').click({ position: { x: 4, y: 4 } });
      await page.locator('[data-testid=pochi-push]').click();
    }
    await page.waitForTimeout(s.waitMs ?? 500);
    const png = path.join(RAW, `${s.name}.png`);
    await page.screenshot({ path: png });
    await ctx.close();
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', png, '-vf', 'scale=320:180', '-quality', '80', path.join(OUT, `${s.name}.webp`)]);
  }
});
