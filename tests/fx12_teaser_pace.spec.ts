import { test, expect, type Page } from '@playwright/test';

// [2026-10-15 リョー「ポッチツモチャンスの演出が出てくるのが高速すぎてイけないな」]
// 予告 (稲妻 ・ 決め台詞 ・ 白黒) の「ぽっちチャンス」の帯は 2 秒たっても出ていて、4 秒までには消えて絞りに入る (前は稲妻 1.6 秒で消えていた)
async function solo(page: Page) {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible();
  await page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
}
async function pochi(page: Page, teaser: 'bolt' | 'line' | 'mono') {
  await page.evaluate((teaser) => {
    const w = window as any;
    w.__forceTeaser = teaser; w.__forceFreeze = null; w.__forcePremium = false; w.__forceLamp = null; w.__forceDelay = false;
    const s = w.__game;
    s.game.lizhi.add(0);
    s.game.feverActive = [false, false, false];
    s.game.events.push({ type: 'zimo', player: 0, pai: 'z5b' });
    w.__gameStore.setCpuSeats([]);
  }, teaser);
  await expect(page.locator('.sq-tile')).toBeVisible();
}

for (const [teaser, ms] of [['bolt', 2600], ['line', 3300], ['mono', 3000]] as const) {
  test(`予告 ${teaser} の帯は ${ms} ms 出ている`, async ({ page }) => {
    await solo(page);
    await pochi(page, teaser);
    const t0 = Date.now();
    await expect(page.locator('.sq-band.teaser')).toHaveCount(1);
    await page.waitForTimeout(Math.max(0, 2000 - (Date.now() - t0)));
    await expect(page.locator('.sq-band.teaser')).toHaveCount(1);
    // 帯の入りは 0.5 秒かけて (前は 0.28 秒)
    const dur = await page.locator('.sq-band.teaser').evaluate((el) => getComputedStyle(el).animationDuration);
    expect(dur).toBe('0.5s');
    await expect(page.locator('.sq-band.teaser')).toHaveCount(0, { timeout: 4000 - (Date.now() - t0) + 500 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(ms - 300);
  });
}
