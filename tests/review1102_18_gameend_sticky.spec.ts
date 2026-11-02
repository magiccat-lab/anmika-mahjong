import { test, expect } from '@playwright/test';

// [クラウドレビュー 11-02 #18] 試合終了の表を 390px 幅で横にスクロールすると、左に残る名前の列 (left: 3.2em) が
// 順位の列 (3.2em + padding、見出しと本文で字の大きさも違う) より狭い所に止まり、順位の字に 8px 被っていた。
// GameEndPanel だけを出す頁 (tests/fixtures/review1102_ge.html) は vite dev でしか開けないので、無い時は飛ばす
test('review1102 #18: sticky name column does not overlap rank column when scrolled at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  const res = await page.goto('/tests/fixtures/review1102_ge.html');
  test.skip(!res || !res.ok() || !(await res.text()).includes('review1102_ge.ts'),'GameEndPanel harness needs the vite dev server');
  await expect(page.locator('.ranking')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => { document.querySelector('.table-wrap')!.scrollLeft = 200; });
  await page.waitForTimeout(200);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.ranking tr')].map((tr) => {
    const pos = tr.children[0] as HTMLElement;
    const who = tr.children[1] as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(pos);
    return { posRight: pos.getBoundingClientRect().right, posTextRight: range.getBoundingClientRect().right, whoLeft: who.getBoundingClientRect().left };
  }));
  expect(rows.length).toBe(4);
  for (const r of rows) {
    expect(r.whoLeft).toBeGreaterThanOrEqual(r.posTextRight);
    expect(Math.abs(r.whoLeft - r.posRight)).toBeLessThanOrEqual(1);
  }
});
