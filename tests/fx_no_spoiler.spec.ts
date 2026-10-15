// [2026-10-14 リョー「アンミカの演出、裏に上がりが出てばれてることあるよ」]
// 白ぽっちの絞りの幕 (78%) の裏で、めくる前に和了か外れかが分からない事。
// 和了の時: ツモのボタン ・ 上の帯の「ツモ和了」が出ず、自動和了も絞りが閉じるまで待つ。
// 外れの時: リーチの自動ツモ切りが絞りの途中で牌を河へ捨てない
import { test, expect, type Page } from '@playwright/test';

async function solo(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible();
  await page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
  await page.waitForTimeout(300);
}
async function pochi(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__game;
    s.game.lizhi.add(0);
    s.game.feverActive = [false, false, false];
    s.game.events.push({ type: 'zimo', player: 0, pai: 'z5b' });
    (window as any).__gameStore.setCpuSeats([]);
  });
  await expect(page.locator('.sq-tile')).toBeVisible();
}
async function squeezeOpenAndWaitClose(page: Page) {
  await expect(page.locator('.sq-band.teaser, .sq-premium, .fz')).toHaveCount(0, { timeout: 6000 }); // [10-15] 当たりの 9% はフリーズ (1.3 秒) が予告の代わり
  const box = (await page.locator('.sq-tile').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height - 4;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x, y - box.height * 1.2, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('.sq')).toHaveCount(0, { timeout: 8000 });
}
// 手を和了の形にする: 123456789p 11s 999s、ツモ 9s
async function winningHand(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const g = (window as any).__game;
    const sp = g.game.shoupai.get(0);
    if (!sp?._zimo) return false;
    for (const s of ['m', 'p', 's', 'z']) for (let n = 0; n < sp._bingpai[s].length; n++) sp._bingpai[s][n] = 0;
    for (let n = 1; n <= 9; n++) sp._bingpai.p[n] = 1;
    sp._bingpai.s[1] = 2; sp._bingpai.s[9] = 3;
    sp._zimo = 's9';
    return g.game.canTsumo(0);
  });
}

test('和了の時: 絞りの裏にツモのボタンと「ツモ和了」が出ず、自動和了は閉じてから', async ({ page }) => {
  await solo(page);
  await page.locator('.me-toggles .autowin-toggle input').check();
  // 自動和了が先に動かない様に、絞りを出してから和了の形にする
  await pochi(page);
  expect(await winningHand(page)).toBe(true);
  await page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
  await page.waitForTimeout(1500);
  expect(await page.locator('.agari-center-btn').count()).toBe(0);
  expect(await page.locator('.turn-status').textContent()).not.toContain('ツモ和了');
  expect(await page.evaluate(() => (window as any).__game.lastWinner)).toBeNull();
  await squeezeOpenAndWaitClose(page);
  await expect.poll(async () => page.evaluate(() => (window as any).__game.lastWinner), { timeout: 5000 }).toBe(0);
});

test('和了の時 (自動和了なし): 閉じた後にツモのボタンが出る', async ({ page }) => {
  await solo(page);
  await pochi(page);
  expect(await winningHand(page)).toBe(true);
  await page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
  await page.waitForTimeout(500);
  expect(await page.locator('.agari-center-btn').count()).toBe(0);
  await squeezeOpenAndWaitClose(page);
  await expect(page.locator('.agari-center-btn')).toBeVisible({ timeout: 3000 });
});

test('外れの時: リーチの自動ツモ切りは絞りが閉じるまで捨てない', async ({ page }) => {
  await solo(page);
  const before = await page.evaluate(() => (window as any).__game.game.he.get(0)._pai.length);
  await pochi(page);
  expect(await page.evaluate(() => (window as any).__game.game.canTsumo(0))).toBe(false);
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => (window as any).__game.game.he.get(0)._pai.length)).toBe(before);
  await squeezeOpenAndWaitClose(page);
  await expect.poll(async () => page.evaluate(() => (window as any).__game.game.he.get(0)._pai.length), { timeout: 5000 }).toBe(before + 1);
});
