import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

// [2026-11-01 リョー「ポッチの演出、やっぱめくりたい。1p2p だと早くわかるからそこだけ解消」]
// PUSH の段で牌を指で下から絞れる。絞りの途中は白ぽっちもでかぽっちも同じ真ん中の点だけ (1p ・ 2p の絵はめくれ切ってから)
const output = process.env.SHOT_DIR;
const QUIET_PLAN = { opening: 'none', glow: 'white', pulse: 'slow', particle: 'none', crack: 'none', push: 'normal', lamp: null, delay: false, premium: null };
async function solo(page: Page) {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible();
  await page.evaluate((p) => { (window as any).__gameStore.setCpuSeats([]); (window as any).__forcePlan = p; }, QUIET_PLAN);
}
async function draw(page: Page, kind: 'z5g' | 'p1' | 'p2') {
  await page.evaluate((kind) => {
    const s = (window as any).__game;
    s.game.lizhi.add(0);
    s.game.feverActive = [false, false, false];
    if (kind !== 'z5g') s.game.lastZimoInfo = { player: 0, pai: kind, pochi: 'green' };
    s.game.events.push({ type: 'zimo', player: 0, pai: kind });
    (window as any).__gameStore.setCpuSeats([]);
  }, kind);
  await expect(page.locator('.sq-tile')).toBeVisible();
  await page.locator('[data-testid=pochi-skip]').click({ position: { x: 4, y: 4 } });
  await expect(page.locator('[data-testid=pochi-push]')).toBeVisible();
}
async function peelTo(page: Page, ratio: number) {
  const box = (await page.locator('.sq-tile').boundingBox())!;
  const x = box.x + box.width / 2;
  const y0 = box.y + box.height - 4;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  const dy = box.height * 1.1 * ratio;
  for (let i = 1; i <= 10; i++) await page.mouse.move(x, y0 - (dy * i) / 10);
  await page.mouse.up();
}
async function shot(page: Page, name: string) {
  if (!output) return;
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: `${output}/${name}.png` });
}

for (const kind of ['z5g', 'p1', 'p2'] as const) {
  test(`FX15: ${kind} peel shows only the same centre dot, then opens`, async ({ page }) => {
    await solo(page);
    await draw(page, kind);
    // 絞る前は色も絵も無い
    await expect(page.locator('.sq-tile circle')).toHaveCount(0);
    await expect(page.locator('.sq-tile img')).toHaveCount(0);
    await peelTo(page, 0.35);
    await shot(page, `fx15-${kind}-35`);
    // 途中: 1p ・ 2p の絵は出さず、点は白ぽっちと同じ r=30 の 1 つだけ
    await expect(page.locator('.sq-tile img')).toHaveCount(0);
    await expect(page.locator('.sq-tile circle')).toHaveCount(1);
    await expect(page.locator('.sq-tile circle')).toHaveAttribute('r', '30');
    await peelTo(page, 0.25);
    await shot(page, `fx15-${kind}-60`);
    await expect(page.locator('.sq-tile img')).toHaveCount(0);
    await peelTo(page, 0.4);
    await expect(page.locator('.sq-word')).toHaveText(kind === 'z5g' ? '緑ぽっち' : 'でかぽっち');
    if (kind !== 'z5g') await expect(page.locator('.sq-tile img.sq-pin.grow')).toHaveCount(1);
    await page.waitForTimeout(600);
    await shot(page, `fx15-${kind}-open`);
  });
}
