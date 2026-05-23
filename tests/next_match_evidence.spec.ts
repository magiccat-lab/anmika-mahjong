// リョー報告 fix の実機エビデンス: face=up + 次の試合 chip 持越し
import { test, expect } from '@playwright/test';

const BASE = process.env.ANMIKA_BASE_URL ?? 'https://anmika.magiccatlab.com';

test('リョー報告 fix evidence: face=up + 次の試合 chip 持越し', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });

  // タイル画像 load 待ち [networkidle + img.complete check]
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll('section.player .hand .tile-btn img')) as HTMLImageElement[];
    await Promise.all(imgs.map((im) => im.complete ? Promise.resolve() : new Promise<void>((r) => { im.onload = () => r(); im.onerror = () => r(); })));
  });

  await page.screenshot({ path: 'test-results/evidence_01_initial_hand.png', fullPage: false });
  const tileInfo = await page.locator('section.player .hand .tile-btn .tile').evaluateAll(
    (nodes) => nodes.map((n) => {
      const img = n.querySelector('img') as HTMLImageElement | null;
      return { cls: (n as HTMLElement).className, src: img?.src ?? null, alt: img?.alt ?? null, complete: !!img?.complete, w: img?.naturalWidth ?? 0 };
    })
  );
  console.log('[evidence 1] tiles:', JSON.stringify(tileInfo.slice(0, 3)));
  for (const t of tileInfo) {
    expect(t.cls, '自家手牌は face=up').toContain('up');
    expect(t.cls).not.toContain('down');
    expect(t.src, 'tile img src 解決').toMatch(/\/tiles\/.+\.svg$/);
    expect(t.w, 'tile img 実 load 確認').toBeGreaterThan(0);
  }
  console.log('[evidence 1] 自家手牌 face=up + 画像 load OK, count=', tileInfo.length);

  // [2] 半荘終了 + nextMatch chip 検証
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.game.chipLedger[0] = 30;
    g.game.chipLedger[1] = -10;
    g.game.chipLedger[2] = -20;
    g.game.state.finished = true;
    g.game.state.defen = [45000, 35000, 25000];
  });
  const before = await page.evaluate(() => {
    const g = (window as any).__game;
    return { 0: g.game.chipLedger[0], 1: g.game.chipLedger[1], 2: g.game.chipLedger[2] };
  });
  await page.evaluate(() => (window as any).__gameStore.nextMatch({ finalize: true, resetChip: false }));
  const after = await page.evaluate(() => {
    const g = (window as any).__game;
    return { 0: g.game.chipLedger[0], 1: g.game.chipLedger[1], 2: g.game.chipLedger[2], finished: g.game.state.finished };
  });
  console.log('[evidence 2] chipLedger before:', JSON.stringify(before), 'after:', JSON.stringify(after));
  expect((after as any)[0]).toBe(75);
  expect((after as any)[1]).toBe(-25);
  expect((after as any)[2]).toBe(-50);
  expect((after as any).finished).toBe(false);

  // 画像 load 再待ち、 screenshot
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll('section.player .hand .tile-btn img')) as HTMLImageElement[];
    await Promise.all(imgs.map((im) => im.complete ? Promise.resolve() : new Promise<void>((r) => { im.onload = () => r(); im.onerror = () => r(); })));
  });
  await page.screenshot({ path: 'test-results/evidence_02_after_next_match.png', fullPage: false });
  const tileInfo2 = await page.locator('section.player .hand .tile-btn .tile').evaluateAll(
    (nodes) => nodes.map((n) => {
      const img = n.querySelector('img') as HTMLImageElement | null;
      return { cls: (n as HTMLElement).className, src: img?.src ?? null, w: img?.naturalWidth ?? 0 };
    })
  );
  for (const t of tileInfo2) {
    expect(t.cls).toContain('up');
    expect(t.cls).not.toContain('down');
    expect(t.w).toBeGreaterThan(0);
  }
  console.log('[evidence 3] 次試合 自家手牌 face=up + 画像 load OK, count=', tileInfo2.length);
});
