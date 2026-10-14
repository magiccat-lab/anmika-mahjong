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
  await expect(page.locator('.sq-tile')).toBeVisible();
}
// [2026-10-14] 白ぽっちは指で下から絞る (PochiSqueeze)。牌の下から上へ引いて一気にめくる
async function squeezeOpen(page: Page) {
  const box = (await page.locator('.sq-tile').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height - 4;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x, y - box.height * 1.2, { steps: 10 }); await page.mouse.up();
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
    // [2026-10-09 華の見せ方 6 版目] どの重さも卓の真ん中の帯 [帯 ・ 語 ・ 誰の 3 つ]
    expect(await page.locator('.fx *').count()).toBe(3);
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

test('FX02: unopened privacy, four colors, squeeze open and close', async ({ page }) => {
  await solo(page);
  for (const color of ['blue', 'red', 'green', 'yellow']) {
    await pochi(page, color);
    const dialog = page.locator('.sq[role=dialog]');
    // めくる前は色の名前を出さない
    await expect(dialog).not.toHaveAttribute('aria-label', /青|赤|緑|黄/);
    await expect(page.locator('.sq-word')).toHaveCount(0);
    await shot(page, `fx02-${color}-unopened`);
    await squeezeOpen(page);
    await expect(page.locator('.sq-word')).toHaveText(({ blue: '青ぽっち', red: '赤ぽっち', green: '緑ぽっち', yellow: '黄ぽっち' } as any)[color]);
    await shot(page, `fx02-${color}-revealed`);
    if (color === 'blue') await page.locator('.sq').click();
    await expect(dialog).toHaveCount(0, { timeout: 3000 });
  }
});

test('FX02: unattended squeeze opens by itself and closes', async ({ page }) => {
  await solo(page);
  await page.clock.install();
  await pochi(page);
  await page.clock.runFor(31050);
  await expect(page.locator('.sq.revealed')).toHaveCount(1);
  await page.clock.runFor(1700);
  await expect(page.locator('.sq')).toHaveCount(0);
});

// [2026-10-14 リョー「手牌のところにツモが見えてネタバレしてる」] 絞っている間は引いた牌 (でかぽっちの 2筒) を伏せる
test('FX02: drawn tile stays face-down while squeezing', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible();
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => {
    const g = (window as any).__game; const sp = g.game.shoupai.get(0);
    return { zimo: sp._zimo, cur: g.game.lunbanToPlayerId(g.game.state.lunban) };
  });
  expect(before.zimo).toBeTruthy();
  const lastAlt = () => page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.seat-bottom button.tile-btn')) as HTMLElement[];
    const last = btns[btns.length - 1];
    return { n: btns.length, alt: last?.querySelector('img')?.getAttribute('alt'), src: last?.querySelector('img')?.getAttribute('src') };
  });
  // 引いた牌をでかぽっち (2筒、一発) にした事にする: 手の zimo を p2 にし、lastZimoInfo に黄
  await page.evaluate(() => {
    const g = (window as any).__game; const sp = g.game.shoupai.get(0);
    const z = sp._zimo; const s = z[0], n = Number(z[1]);
    sp._bingpai[s][n]--; sp._bingpai.p[2]++; sp._zimo = 'p2';
    g.game.lizhi.add(0); g.game.feverActive = [false, false, false];
    g.game.lastZimoInfo = { player: 0, pai: 'p2', pochi: 'yellow' };
    g.game.events.push({ type: 'zimo', player: 0, pai: 'p2' });
    (window as any).__gameStore.setCpuSeats([1, 2]);
  });
  await expect(page.locator('.sq-tile')).toBeVisible({ timeout: 4000 });
  const during = await lastAlt();
  await shot(page, 'fx02-deka-during');
  expect(during.src).toContain('Back.svg');
  const box = (await page.locator('.sq-tile').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height - 4;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - box.height * 1.2, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('.sq-word')).toHaveText('でかぽっち');
  await expect(page.locator('.sq')).toHaveCount(0, { timeout: 4000 });
  const after = await lastAlt();
  expect(after.src).toContain('Pin2');
});
