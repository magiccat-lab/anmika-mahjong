import { expect, test } from '@playwright/test';

test('solo table stays readable at representative viewport sizes', async ({ page }) => {
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('main.mode-single')).toBeVisible();
  await expect(page.locator('.turn-status')).toContainText('打牌');

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile-landscape', width: 844, height: 390 },
    { name: 'mobile-portrait', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(300);
    const metrics = await page.evaluate(() => ({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
      },
      main: (() => {
        const rect = document.querySelector('main')?.getBoundingClientRect();
        return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })(),
    }));
    expect(metrics.document.scrollWidth).toBe(metrics.document.clientWidth);
    expect(metrics.document.scrollHeight).toBe(metrics.document.clientHeight);

    if (viewport.name === 'mobile-landscape') {
      const dora = await page.locator('.dora-main').boundingBox();
      const settings = await page.locator('.settings-group').boundingBox();
      const scoreBox = await page.locator('.score-box').boundingBox();
      const selfScore = await page.locator('.score-side.score-bottom .sval').boundingBox();
      expect(dora).not.toBeNull();
      expect(settings).not.toBeNull();
      expect(scoreBox).not.toBeNull();
      expect(selfScore).not.toBeNull();
      expect(dora!.x + dora!.width).toBeLessThanOrEqual(settings!.x);
      expect(selfScore!.y + selfScore!.height).toBeLessThanOrEqual(scoreBox!.y + scoreBox!.height);
    }

    if (viewport.name === 'mobile-portrait') {
      await expect(page.locator('.orientation-notice')).toBeVisible();
      await expect(page.locator('.orientation-notice')).toContainText('横向き');
    }

  }
});

test('entry menu buttons fit a 320px-wide screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  const menuFits = await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);
  expect(menuFits).toBe(true);
  for (const button of await page.locator('.entry-btn').all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
});
