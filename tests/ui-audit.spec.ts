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
      // [2026-10-09 shun2] 点は席の札へ、設定は ⋯ へ移った。今だれの番かの札が ⋯ と重ならず、
      // 自分の点が自分の札の中に収まる
      const status = await page.locator('.turn-status').boundingBox();
      const menu = await page.locator('.table-menu-btn').boundingBox();
      const myCard = await page.locator('.seat-card.sc-me').boundingBox();
      const selfScore = await page.locator('.seat-card.sc-me .sval').boundingBox();
      expect(status).not.toBeNull();
      expect(menu).not.toBeNull();
      expect(myCard).not.toBeNull();
      expect(selfScore).not.toBeNull();
      expect(status!.x + status!.width).toBeLessThanOrEqual(menu!.x);
      expect(selfScore!.y + selfScore!.height).toBeLessThanOrEqual(myCard!.y + myCard!.height);
    }

    if (viewport.name === 'mobile-portrait') {
      // [2026-10-09 shun2] 縦持ちの卓を作ったので「横向きにして」は出さず、手牌 14 枚が 2 段に収まる
      await expect(page.locator('.orientation-notice')).toBeHidden();
      const tops = await page.locator('.seat-bottom .tile-btn').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      // 浮かせた牌 [ツモ牌 ・ 候補の強調] は数 px ずれるので、20px 以上離れた時だけ別の段と数える
      const rows = [...tops].sort((a, b) => a - b).filter((t, i, arr) => i === 0 || t - arr[i - 1] > 20).length;
      expect(rows).toBeLessThanOrEqual(2);
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
