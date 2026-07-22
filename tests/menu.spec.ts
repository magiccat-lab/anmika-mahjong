import { test, expect } from '@playwright/test';

const BASE = process.env.ANMIKA_BASE_URL ?? 'https://anmika.magiccatlab.com';

test('menu shows two buttons + single mode starts', async ({ page }) => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const solo = page.locator('button.entry-btn.solo');
  const online = page.locator('button.entry-btn.online');
  await expect(solo).toBeVisible({ timeout: 10000 });
  await expect(online).toBeVisible();
  await expect(solo).toContainText('一人回し');
  await expect(online).toContainText('対戦');
  await solo.click();
  await expect(page.locator('h1').first()).toContainText('ONLINE ANMIKA');
  await expect(page.locator('section.player').first()).toBeVisible({ timeout: 5000 });
});
