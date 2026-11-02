import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// [クラウドレビュー 11-02 #16] 画面リプレイの再生バーのボタンに乗ると、全体の
// `button:hover:not(:disabled) { background: #e8e8e8 }` が勝って背景が文字色と同じ明るさになり、文字が読めなかった。
// 再生バー (replay-screen は保存済み frames を返すだけなので API を差し替える)
const frames = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'review1102_replay_frames.json'), 'utf8'));

test('review1102 #16: replay bar button hover keeps a dark translucent background', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (/^\/api\/matches\/\d+\/replay-screen$/.test(url.pathname)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...frames, match_id: 1, seat: 0 }) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"x"}' });
  });
  await page.goto('/?replay=1&screen=1&seat=0&pause=1&at=0');
  const btn = page.locator('.screen-replay-bar button', { hasText: '1手' });
  await expect(btn).toBeVisible({ timeout: 15000 });
  await page.mouse.move(600, 500);
  const before = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
  await btn.hover();
  await page.waitForTimeout(200);
  const { bg, color } = await btn.evaluate((el) => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, color: cs.color }; });
  expect(bg).not.toBe('rgb(232, 232, 232)');
  expect(bg).not.toBe(color);
  // 乗った時は少しだけ明るくなる (半透明の白のまま)
  expect(bg).toMatch(/^rgba\(255, 255, 255, 0\.\d+\)$/);
  expect(bg).not.toBe(before);
});
