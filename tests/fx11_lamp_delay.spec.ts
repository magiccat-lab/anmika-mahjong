import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

// [2026-10-15 fx10 の答え L1 a ・ B1 a] 告知ランプ (画面の外周が金に光る) と遅れ (ピキーンが 0.3 秒遅れる)
const output = process.env.SHOT_DIR;
async function shot(page: Page, name: string) {
  if (!output) return;
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: `${output}/${name}.png` });
}
async function solo(page: Page) {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible();
  await page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
}
async function pochi(page: Page, color: string, force: { lamp: 'pre' | 'post' | null; delay: boolean }) {
  await page.evaluate(({ color, force }) => {
    const w = window as any;
    w.__forcePlan = { opening: 'none', glow: 'white', pulse: 'slow', particle: 'none', crack: 'none', push: 'normal', premium: null, lamp: force.lamp, delay: force.delay };
    w.__seLog = [];
    const s = w.__game;
    s.game.lizhi.add(0);
    s.game.feverActive = [false, false, false];
    s.game.events.push({ type: 'zimo', player: 0, pai: ({ blue: 'z5b', red: 'z5r' } as any)[color] });
    w.__gameStore.setCpuSeats([]);
  }, { color, force });
  await expect(page.locator('.sq-tile')).toBeVisible();
}
// [2026-10-25] 画面を触って PUSH まで飛ばし、PUSH を押す
async function pull(page: Page) {
  await page.locator('[data-testid=pochi-skip]').click({ position: { x: 4, y: 4 } });
  await page.locator('[data-testid=pochi-push]').click();
}
const log = (page: Page) => page.evaluate(() => ((window as any).__seLog ?? []) as { path: string; at: number }[]);

test('FX11: 先告知のランプは引いた直後に画面の外周が光る', async ({ page }) => {
  await solo(page);
  await pochi(page, 'blue', { lamp: 'pre', delay: false });
  await expect(page.locator('.sq-edge')).toHaveCount(1, { timeout: 1500 });
  await expect(page.locator('.sq-edge')).toHaveCSS('pointer-events', 'none');
  await shot(page, 'fx11-lamp-pre');
  // 光っている間も PUSH で開く
  await pull(page);
  await expect(page.locator('.sq-band.reveal')).toHaveCount(1);
});

test('FX11: 後告知のランプはPUSH の後に光り、その前は光らない', async ({ page }) => {
  await solo(page);
  await pochi(page, 'blue', { lamp: 'post', delay: false });
  await page.waitForTimeout(700);
  await expect(page.locator('.sq-edge')).toHaveCount(0);
  await pull(page);
  await expect(page.locator('.sq-edge')).toHaveCount(1, { timeout: 1500 });
  await shot(page, 'fx11-lamp-post');
});

test('FX11: 外れはランプが光らない', async ({ page }) => {
  await solo(page);
  await pochi(page, 'red', { lamp: null, delay: false });
  await page.waitForTimeout(700);
  await pull(page);
  await page.waitForTimeout(800);
  await expect(page.locator('.sq-edge')).toHaveCount(0);
});

test('FX11: 遅れはピキーンだけが 0.3 秒遅れる (先告知のキュインより後になる)', async ({ page }) => {
  await solo(page);
  // 遅れなし: ピキーンは引いた時、先告知のキュイン (0.25 秒後) より前
  await pochi(page, 'blue', { lamp: 'pre', delay: false });
  await page.waitForTimeout(900);
  let l = await log(page);
  let pik = l.find((x) => x.path.endsWith('/pikiin.mp3'))!, kyu = l.find((x) => x.path.endsWith('/kyuin.mp3'))!;
  expect(kyu.at - pik.at).toBeGreaterThan(150);
  await pull(page);
  await expect(page.locator('.sq')).toHaveCount(0, { timeout: 5000 });
  // 遅れ: ピキーンは 0.3 秒後なので、キュインより後
  await pochi(page, 'blue', { lamp: 'pre', delay: true });
  await page.waitForTimeout(900);
  l = await log(page);
  pik = l.find((x) => x.path.endsWith('/pikiin.mp3'))!; kyu = l.find((x) => x.path.endsWith('/kyuin.mp3'))!;
  expect(pik.at - kyu.at).toBeGreaterThan(20);
  expect(pik.at - kyu.at).toBeLessThan(200);
});
