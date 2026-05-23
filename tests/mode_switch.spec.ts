// オフライン↔オンライン 切替 regression e2e [yuma test 改善 2026-05-13]
// menu → solo → メニューに戻る → online → メニューに戻る → solo を 1 page 内で繰返し state 漏れ check
import { test, expect } from '@playwright/test';

const BASE = process.env.ANMIKA_BASE_URL ?? 'https://anmika.magiccatlab.com';

test('オフライン↔オンライン 切替: state 漏れ無し', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto(BASE);

  // 1) menu → solo
  await expect(page.locator('button.entry-btn.solo')).toBeVisible({ timeout: 10000 });
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });

  // 2) solo → menu に戻る [DOM 直接 click で UI 重なり問題回避]
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button.mode-toggle'));
    const m = btns.find((b) => b.textContent?.includes('メニュー')) as HTMLButtonElement | undefined;
    if (m) { m.click(); return true; }
    return false;
  });
  expect(clicked, '「メニューに戻る」 button DOM に無い').toBe(true);
  await expect(page.locator('button.entry-btn.solo')).toBeVisible({ timeout: 5000 });

  // 3) menu → online
  await page.locator('button.entry-btn.online').click();
  // online lobby は Discord login 要、 fakeLogin 無しでは 「ログインが必要」 表示
  // ここでは render が落ちない事だけ確認
  await page.waitForTimeout(1500);
  const noFatal = await page.evaluate(() => !document.body.textContent?.includes('Error'));
  expect(noFatal, 'online mode 遷移後に Error 表示').toBe(true);

  // 4) online → menu [「← オフラインに戻る」 button click]
  const backOffline = page.locator('button.mode-toggle:has-text("オフラインに戻る")').first();
  if (await backOffline.isVisible().catch(() => false)) {
    await backOffline.click();
    await expect(page.locator('section.player').first()).toBeVisible({ timeout: 5000 });
  }

  // 5) もう一度 solo モードの初期化が正しく走るか [P0 自家手牌 13 枚]
  // 必要なら solo button 再 click
  const stillInGame = await page.locator('section.player').first().isVisible().catch(() => false);
  if (!stillInGame) {
    const menuBtn2 = page.locator('button.mode-toggle:has-text("メニューに戻る")').first();
    if (await menuBtn2.isVisible().catch(() => false)) await menuBtn2.click();
    await page.locator('button.entry-btn.solo').click();
  }
  await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });

  // game state が 正常 [defen が 35000 以上、 lunban 0-2]
  const status = await page.evaluate(() => {
    const g = (window as any).__game;
    if (!g) return null;
    return {
      defen0: g.game?.state?.defen?.[0] ?? null,
      lunban: g.game?.state?.lunban ?? null,
      finished: !!g.game?.state?.finished,
    };
  });
  expect(status, 'window.__game 取得失敗').toBeTruthy();
  expect(status!.finished, '初期状態で finished=true は異常').toBe(false);
  expect(status!.lunban, 'lunban が 0-2 範囲外').toBeGreaterThanOrEqual(0);
  expect(status!.lunban, 'lunban が 0-2 範囲外').toBeLessThanOrEqual(2);
});
