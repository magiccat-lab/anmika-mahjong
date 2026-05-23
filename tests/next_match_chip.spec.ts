// 「次の試合へ」 chip 持越し + 自家手牌 face=up regression [2026-05-14 リョー報告 fix]
import { test, expect } from '@playwright/test';

const BASE = process.env.ANMIKA_BASE_URL ?? 'https://anmika.magiccatlab.com';

test('single mode: 自家手牌は face=up', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });
  const firstTile = page.locator('section.player .hand .tile-btn .tile').first();
  await expect(firstTile).toBeVisible();
  const cls = await firstTile.getAttribute('class');
  expect(cls, '自家手牌が face=down [bug 再発]').not.toContain('down');
  expect(cls, '自家手牌は face=up であるべき').toContain('up');
});

test('nextMatch: 半荘終了で finalScore を chipLedger に carry', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto(BASE);
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });

  // 半荘終了 state を強制注入: state.finished=true, chipLedger 設定, finalScore 検証
  const result = await page.evaluate(() => {
    const g = (window as any).__game;
    const store = (window as any).__gameStore;
    if (!g || !store) return { error: 'no globals' };
    // chipLedger 任意値
    g.game.chipLedger[0] = 30;
    g.game.chipLedger[1] = -10;
    g.game.chipLedger[2] = -20;
    g.game.state.finished = true;
    // 適当な defen [getRanking が要求]
    g.game.state.defen = [45000, 35000, 25000];
    // ranking が回るか確認、 getFinalScore 取得
    const fs = g.game.getFinalScore();
    return { fs, before: { 0: g.game.chipLedger[0], 1: g.game.chipLedger[1], 2: g.game.chipLedger[2] } };
  });
  expect((result as any).error).toBeUndefined();
  console.log('[finalScore]', JSON.stringify(result));

  // nextMatch finalize → chipLedger に total が書き戻されるはず
  const after = await page.evaluate(() => {
    const store = (window as any).__gameStore;
    store.nextMatch({ finalize: true, resetChip: false });
    const g = (window as any).__game;
    return { 0: g.game.chipLedger[0], 1: g.game.chipLedger[1], 2: g.game.chipLedger[2] };
  });
  console.log('[after chipLedger]', JSON.stringify(after));

  // finalScore.total の値が反映されてるはず
  const fs = (result as any).fs as Array<{ player: number; total: number }>;
  for (const r of fs) {
    expect((after as any)[r.player], `player ${r.player}: chipLedger should = total ${r.total}`).toBe(r.total);
  }
});
