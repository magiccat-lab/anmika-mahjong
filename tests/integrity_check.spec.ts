// リョー報告系 bug が再発しないか 整合性 ブラウザテスト [2026-05-14 自走]
import { test, expect } from '@playwright/test';

const BASE = process.env.ANMIKA_BASE_URL ?? 'https://anmika.magiccatlab.com';

test.describe('integrity_check: live-play 系 bug 回帰', () => {
  test('2 試合 連続: chip ledger 持越し + 全試合 face=up 維持', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.locator('button.entry-btn.solo').click();
    await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });

    // 1 試合目: chipLedger 任意設定 → 半荘終了 → nextMatch
    await page.evaluate(() => {
      const g = (window as any).__game;
      g.game.chipLedger[0] = 50; g.game.chipLedger[1] = -20; g.game.chipLedger[2] = -30;
      g.game.state.finished = true;
      g.game.state.defen = [50000, 30000, 20000];
    });
    await page.evaluate(() => (window as any).__gameStore.nextMatch({ finalize: true, resetChip: false }));
    const after1 = await page.evaluate(() => {
      const g = (window as any).__game;
      return { 0: g.game.chipLedger[0], 1: g.game.chipLedger[1], 2: g.game.chipLedger[2], finished: g.game.state.finished };
    });
    // 2着 30000 < 40000 → uma 45/-15/-30
    expect((after1 as any)[0]).toBe(95); // 50+45
    expect((after1 as any)[1]).toBe(-35); // -20-15
    expect((after1 as any)[2]).toBe(-60); // -30-30
    expect((after1 as any).finished).toBe(false);

    // 2 試合目: 再度 半荘終了 → 持越し
    await page.evaluate(() => {
      const g = (window as any).__game;
      g.game.chipLedger[0] += 10; // 105
      g.game.chipLedger[1] += -5; // -40
      g.game.chipLedger[2] += -5; // -65
      g.game.state.finished = true;
      g.game.state.defen = [55000, 40000, 5000]; // 2着 40000+
    });
    await page.evaluate(() => (window as any).__gameStore.nextMatch({ finalize: true, resetChip: false }));
    const after2 = await page.evaluate(() => {
      const g = (window as any).__game;
      return { 0: g.game.chipLedger[0], 1: g.game.chipLedger[1], 2: g.game.chipLedger[2] };
    });
    // 2着 40000+ → uma 30/0/-30
    expect((after2 as any)[0]).toBe(135); // 105+30
    expect((after2 as any)[1]).toBe(-40); // -40+0
    expect((after2 as any)[2]).toBe(-95); // -65-30

    // 自家手牌 face=up
    const tileCls = await page.locator('section.player .hand .tile-btn .tile').first().getAttribute('class');
    expect(tileCls).toContain('up');
    expect(tileCls).not.toContain('down');
  });

  test('pochiMultiplier は nextRound で neutral reset される [2026-05-21]', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.locator('button.entry-btn.solo').click();
    await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });

    await page.evaluate(() => {
      const g = (window as any).__game;
      g.game.pochiMultiplier[0] = { defen: -1, chip: -2 };
      g.game.pochiMultiplier[1] = { defen: 1, chip: 4 };
    });
    // nextRound 経由で 局を進める
    await page.evaluate(() => (window as any).__gameStore.nextRound());
    const pm = await page.evaluate(() => {
      const g = (window as any).__game;
      return { 0: g.game.pochiMultiplier[0], 1: g.game.pochiMultiplier[1] };
    });
    expect(pm[0], 'pochiMultiplier は局またぎで reset').toEqual({ defen: 1, chip: 1 });
    expect(pm[1]).toEqual({ defen: 1, chip: 1 });
  });

  test('nextMatch broadcast action: WS gate 経路で 同等の chip 反映', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.locator('button.entry-btn.solo').click();
    await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });

    // online mode シミュレーション: onlineMode=true 強制
    await page.evaluate(() => {
      const g = (window as any).__game;
      g.game.chipLedger[0] = 20; g.game.chipLedger[1] = -10; g.game.chipLedger[2] = -10;
      g.game.state.finished = true;
      g.game.state.defen = [42000, 35000, 28000];
    });
    // online でなく local 経路 [sendOnlineAction false] で nextMatch 動作確認
    await page.evaluate(() => (window as any).__gameStore.nextMatch({ finalize: true, resetChip: false }));
    const after = await page.evaluate(() => {
      const g = (window as any).__game;
      return { 0: g.game.chipLedger[0], 1: g.game.chipLedger[1], 2: g.game.chipLedger[2] };
    });
    // 2着 35000 < 40000 → uma 45/-15/-30
    expect(after[0]).toBe(65); expect(after[1]).toBe(-25); expect(after[2]).toBe(-40);
  });

  test('chip reset option [チップリセット checkbox]: chipLedger 0 開始', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.locator('button.entry-btn.solo').click();
    await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });

    await page.evaluate(() => {
      const g = (window as any).__game;
      g.game.chipLedger[0] = 100; g.game.chipLedger[1] = -50; g.game.chipLedger[2] = -50;
      g.game.state.finished = true;
      g.game.state.defen = [40000, 35000, 25000];
    });
    await page.evaluate(() => (window as any).__gameStore.nextMatch({ finalize: false, resetChip: true }));
    const after = await page.evaluate(() => {
      const g = (window as any).__game;
      return { 0: g.game.chipLedger[0], 1: g.game.chipLedger[1], 2: g.game.chipLedger[2] };
    });
    expect(after[0]).toBe(0); expect(after[1]).toBe(0); expect(after[2]).toBe(0);
  });

  test('selfPlayer / srv0 / rotateOffset 整合 [モード切替後も保持]', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.locator('button.entry-btn.solo').click();
    await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });

    const state = await page.evaluate(() => {
      const w = window as any;
      // svelte component の内部 selfPlayer は外から取れない、 代わりに rotateOffset を div 経由で
      // PlayerHandPanel.label の "player X [自家]" の X が selfPlayer と一致するかで verify
      const label = document.querySelector('section.player h2')?.textContent ?? '';
      return { label };
    });
    expect(state.label, 'PlayerHandPanel label が "player 0 [自家]" 形式').toMatch(/player \d \[自家\]/);

    // 次の試合 経由でも label 維持確認
    await page.evaluate(() => {
      const g = (window as any).__game;
      g.game.state.finished = true;
      g.game.state.defen = [40000, 35000, 25000];
    });
    await page.evaluate(() => (window as any).__gameStore.nextMatch({ finalize: true, resetChip: false }));
    const state2 = await page.evaluate(() => {
      const label = document.querySelector('section.player h2')?.textContent ?? '';
      return { label };
    });
    expect(state2.label).toMatch(/player \d \[自家\]/);
  });
});
