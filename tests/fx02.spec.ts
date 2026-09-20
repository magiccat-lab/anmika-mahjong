import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const output = process.env.SHOT_DIR;
async function solo(page: Page) {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible();
  await page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
}
async function pochi(page: Page, color = 'blue') {
  // Forced visual fixture through the existing zimo observer, not a product hook.
  await page.evaluate((color) => {
    const s = (window as any).__game;
    s.game.lizhi.add(0);
    s.game.feverActive = [false, false, false];
    const pai = ({ blue: 'z5b', red: 'z5r', green: 'z5g', yellow: 'z5y' } as any)[color];
    s.game.events.push({ type: 'zimo', player: 0, pai });
    (window as any).__gameStore.setCpuSeats([]);
  }, color);
  await expect(page.locator('.pochi-tile')).toBeVisible();
}
async function shot(page: Page, name: string) {
  if (!output) return;
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: `${output}/${name}.png` });
}

test('FX02: all six words, three seats, three DOM, queue and heavy skip', async ({ page }) => {
  await solo(page);
  await page.clock.install();
  const ids = ['pon', 'kan', 'reach', 'ron', 'tsumo', 'fever'];
  for (const [index, id] of ids.entries()) {
    await page.evaluate(({ id, seat }) => (window as any).__gameStore.enqueueCutin(id, seat), { id, seat: index % 3 });
    await page.clock.runFor(350);
    await expect(page.locator('.fx')).toBeVisible();
    expect(await page.locator('.fx *').count()).toBe(2);
    // [2026-09-20] 語は img からサブセットフォントの実テキストになった。
    // 「字が出ているか」は、語が入っていて幅を持っている事で見る
    const word = page.locator('.fx-word');
    expect((await word.innerText()).trim().length).toBeGreaterThan(0);
    expect((await word.boundingBox())!.width).toBeGreaterThan(20);
    await shot(page, `fx02-${id}`);
    if (id === 'fever') await page.locator('.fx').click({ position: { x: 10, y: 10 } });
    else await page.clock.runFor(1300);
    await expect(page.locator('.fx')).toHaveCount(0);
  }
  await page.evaluate(() => {
    const store = (window as any).__gameStore;
    store.enqueueCutin('pon', 1); store.enqueueCutin('ron', 2);
  });
  await page.clock.runFor(800);
  await expect(page.locator('.fx-ron')).toHaveCount(1);
  await page.clock.runFor(1300);
  await expect(page.locator('.fx')).toHaveCount(0);
});

test('FX02: unopened privacy, four colors, click close and auto close', async ({ page }) => {
  await solo(page);
  await page.clock.install();
  for (const color of ['blue', 'red', 'green', 'yellow']) {
    await pochi(page, color);
    const dialog = page.locator('[role=dialog]').filter({ has: page.locator('.pochi-tile') });
    expect(await dialog.locator('*').count()).toBe(2);
    await expect(dialog).not.toHaveAttribute('aria-label', /青|赤|緑|黄|正|逆/);
    await expect(page.locator('.pochi-tile')).toHaveCSS('--pochi', 'transparent');
    await shot(page, `fx02-${color}-unopened`);
    await page.locator('.pochi-tile').click();
    await expect(page.locator('.pochi-tile')).toHaveClass(/revealed/);
    await page.clock.runFor(300);
    await shot(page, `fx02-${color}-revealed`);
    if (color === 'blue') await page.locator('.pochi-tile').click();
    else await page.clock.runFor(1500);
    await expect(dialog).toHaveCount(0);
  }
});

test('FX02: unattended reveal deadline still opens and closes', async ({ page }) => {
  await solo(page);
  await page.clock.install();
  await pochi(page);
  await page.clock.runFor(10050);
  await expect(page.locator('.pochi-tile')).toHaveClass(/revealed/);
  await page.clock.runFor(3100);
  await expect(page.locator('.pochi-tile')).toHaveCount(0);
});
