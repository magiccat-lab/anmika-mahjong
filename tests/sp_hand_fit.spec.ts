// [2026-10-14 リョー「スマホの横持ちだと端の牌に判定が無くて切れない (枠から出てる)」]
// 横持ちの手牌は枠 (自分の席の札) に収まり、どの牌も真ん中 ・ 両端を押せる事。鳴きが 2 つあっても同じ
import { test, expect } from '@playwright/test';
const SIZES: Array<[number, number, string]> = [[932, 430, 'iphone14max'], [915, 412, 'pixel7'], [844, 390, 'iphone14'], [740, 360, 'galaxyS9'], [667, 375, 'iphoneSE']];
async function soloAt(browser: any, w: number, h: number) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible();
  await page.waitForTimeout(1000);
  return { ctx, page };
}
async function measure(page: any) {
  return page.evaluate(() => {
    const sec = document.querySelector('.seat-bottom > section.player') as HTMLElement;
    const sr = sec.getBoundingClientRect();
    const items = Array.from(sec.querySelectorAll('.hand > *')) as HTMLElement[];
    // 隠れている物 (v2 の華と抜きの帯は display: none) は幅 0 なので数えない
    const rects = items.map((e) => e.getBoundingClientRect()).filter((q) => q.width > 0);
    const btns = Array.from(sec.querySelectorAll('button.tile-btn')) as HTMLElement[];
    const miss = btns.filter((b) => {
      const q = b.getBoundingClientRect();
      return [q.left + 3, q.left + q.width / 2, q.right - 3].some((x) => {
        const e = document.elementFromPoint(x, q.top + q.height / 2);
        return !(e && (e === b || b.contains(e)));
      });
    }).length;
    return { secL: sr.left, secR: sr.right, minL: Math.min(...rects.map((q) => q.left)), maxR: Math.max(...rects.map((q) => q.right)), n: btns.length, miss };
  });
}
for (const [w, h, name] of SIZES) {
  test(`SP hand fit: ${name} ${w}x${h}`, async ({ browser }) => {
    const { ctx, page } = await soloAt(browser, w, h);
    const r = await measure(page);
    expect(r.n).toBeGreaterThanOrEqual(13);
    expect(r.miss, JSON.stringify(r)).toBe(0);
    expect(r.minL, JSON.stringify(r)).toBeGreaterThanOrEqual(r.secL - 1);
    expect(r.maxR, JSON.stringify(r)).toBeLessThanOrEqual(r.secR + 1);
    await ctx.close();
  });
}
for (const [w, h] of [[667, 375], [844, 390]]) {
  test(`SP hand fit with pon + kan: ${w}x${h}`, async ({ browser }) => {
    const { ctx, page } = await soloAt(browser, w, h);
    await page.evaluate(() => {
      // 表示だけの形: 手から 7 枚抜いて、ポン 1 つと暗槓 1 つを足す
      const g = (window as any).__game; const sp = g.game.shoupai.get(0);
      let left = 7;
      for (const s of ['m', 'p', 's', 'z']) for (let n = 1; n < sp._bingpai[s].length && left > 0; n++) {
        while (sp._bingpai[s][n] > 0 && left > 0) { sp._bingpai[s][n]--; left--; }
      }
      sp._fulou.push('z666=', 'p7777');
      (window as any).__gameStore.setCpuSeats([1, 2]);
    });
    await page.waitForTimeout(400);
    const r = await measure(page);
    expect(r.miss, JSON.stringify(r)).toBe(0);
    expect(r.minL, JSON.stringify(r)).toBeGreaterThanOrEqual(r.secL - 1);
    expect(r.maxR, JSON.stringify(r)).toBeLessThanOrEqual(r.secR + 1);
    await ctx.close();
  });
}
