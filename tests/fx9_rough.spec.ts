import { test, expect, type Browser } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// [2026-10-15] 煽り演出 (2 シャンテン以上からの放銃) と役満放銃のラフを本物の卓で録る。声は録れないので後で ffmpeg で載せる
const OUT = process.env.FX9_OUT ?? 'tmp/fx9';
const SIZE = { width: 1280, height: 720 };

async function record(browser: Browser, name: string, fire: string, holdMs: number): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const dir = path.join(OUT, `raw_${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir, size: SIZE } });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible();
  await page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
  await page.waitForTimeout(1800);
  await page.evaluate(fire);
  await page.waitForTimeout(holdMs);
  await ctx.close();
  const webm = fs.readdirSync(dir).find((f) => f.endsWith('.webm'))!;
  fs.renameSync(path.join(dir, webm), path.join(OUT, `${name}.webm`));
  fs.rmSync(dir, { recursive: true, force: true });
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

test('fx9 aori', async ({ browser }) => {
  await record(browser, 'a1', "window.__gameStore.enqueueCutin('aori', 1, { label: 'どっから切っとんねーん！' }); window.__gameStore.enqueueCutin('ron', 0, { label: 'ロン' })", 4800);
});
test('fx9 yakuman', async ({ browser }) => {
  await record(browser, 'a3', "window.__gameStore.enqueueCutin('yakumanHoju', 1, { label: '役満放銃' }); window.__gameStore.enqueueCutin('ron', 0, { label: 'ロン' })", 5200);
});
