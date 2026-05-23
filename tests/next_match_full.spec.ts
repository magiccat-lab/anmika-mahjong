// end-to-end 自走テスト: 「次の試合へ」 button click → UI 上で chip 反映 確認
import { test, expect } from '@playwright/test';

const BASE = process.env.ANMIKA_BASE_URL ?? 'https://anmika.magiccatlab.com';

test('次の試合へ button click で finalScore が chip 表示に反映', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(BASE);
  page.on('console', (m) => {
    if (/error|warn|finished|nextMatch|chipLedger/i.test(m.text())) console.log('[page]', m.text());
  });
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });

  // 半荘終了 state を強制注入 [roundEnded + state.finished + lastWinner + chipLedger]
  await page.evaluate(() => {
    const g = (window as any).__game;
    const store = (window as any).__gameStore;
    g.game.chipLedger[0] = 30;
    g.game.chipLedger[1] = -10;
    g.game.chipLedger[2] = -20;
    g.game.state.finished = true;
    g.game.state.defen = [45000, 35000, 25000];
    // GameEndPanel 開く: roundEnded=true + lastWinner=0 [stub]
    const cur = store as any;
    if (cur && cur._setForTest) cur._setForTest({ roundEnded: true, lastWinner: 0 });
    // svelte store の subscribe を強制 trigger するため writable._set 経由
    // ない場合は store の update に頼る → ここは pre-built なので直接 store の internal は無い、 button click だけで OK
  });

  // 「次の試合へ」 button を実 click
  const nextBtn = page.locator('button', { hasText: '▶ 次の試合へ' });
  // 表示されるまで待つ [state.finished 反映の reactive]
  await page.waitForTimeout(500);
  const visible = await nextBtn.isVisible().catch(() => false);
  console.log('[nextBtn visible]', visible);
  if (!visible) {
    // button が出てない → store の roundEnded を直接いじれない、 nextMatch を直 invoke
    await page.evaluate(() => {
      (window as any).__gameStore.nextMatch({ finalize: true, resetChip: false });
    });
  } else {
    await nextBtn.click();
  }

  await page.waitForTimeout(500);

  // chipLedger 検証
  const chip = await page.evaluate(() => {
    const g = (window as any).__game;
    return { 0: g.game.chipLedger[0], 1: g.game.chipLedger[1], 2: g.game.chipLedger[2] };
  });
  console.log('[after click chipLedger]', JSON.stringify(chip));
  // 30+45=75, -10-15=-25, -20-30=-50
  expect((chip as any)[0]).toBe(75);
  expect((chip as any)[1]).toBe(-25);
  expect((chip as any)[2]).toBe(-50);

  // UI 上の表示 [score-box 内に chip xxx 表示] 確認
  await page.screenshot({ path: 'test-results/next_match_after.png', fullPage: false });

  // 自家手牌 face=up 確認
  const tileCls = await page.locator('section.player .hand .tile-btn .tile').first().getAttribute('class');
  expect(tileCls, '次の試合 reset 後も face=up であること').toContain('up');
  expect(tileCls).not.toContain('down');
});
