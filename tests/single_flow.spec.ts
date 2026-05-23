// single mode フルフロー regression e2e [yuma test 改善 2026-05-13]
// 既存 online.spec.ts 4 件 + menu.spec.ts 1 件 に追加して、 single mode の hule までを通す
//
// シナリオ:
//  1. menu → 一人回しモード 起動
//  2. P0 自家手牌 出現確認 [13 枚]
//  3. ツモ切り auto 有効化、 自動進行で hule or 流局まで進む [安全上限 100 turn]
//  4. game.state.finished or roundEnded 到達確認
//  5. window.__game.game.lastWinner / pendingPingju 等の終局シグナル いずれか有り
import { test, expect } from '@playwright/test';

const BASE = process.env.ANMIKA_BASE_URL ?? 'https://anmika.magiccatlab.com';

test('single mode フルフロー: hule or 流局まで進行', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(BASE);
  page.on('console', (m) => {
    const t = m.text();
    // ノイズ抑制、 重要 event のみ
    if (/hule|pingju|finished|tsumo|ron|error/i.test(t)) console.log('[page]', t);
  });

  // menu
  const solo = page.locator('button.entry-btn.solo');
  await expect(solo).toBeVisible({ timeout: 10000 });
  await solo.click();

  // 自家手牌
  await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });
  const tilesCount = await page.locator('section.player button.tile-btn').count();
  expect(tilesCount, '自家手牌が出てない').toBeGreaterThan(10);

  // P0 を CPU 化 + auto-advance を window.__gameStore 経由で発火 [UI 介さず確実進行]
  await page.evaluate(() => {
    const g = (window as any).__gameStore;
    if (!g) return;
    if (g && typeof g.toggleCpu === 'function') g.toggleCpu(0);  // P0 → CPU
    if (typeof g.autoAdvance === 'function') g.autoAdvance();
  });

  // safety 100 turn 上限で 終局到達まで polling
  let endReached = false;
  let lastLunban = -1;
  let stuck = 0;
  for (let turn = 0; turn < 100; turn++) {
    await page.waitForTimeout(700);
    const status = await page.evaluate(() => {
      const g = (window as any).__game;
      if (!g) return null;
      return {
        finished: !!g.game?.state?.finished,
        roundEnded: !!g.roundEnded,
        lastWinner: g.lastWinner,
        pendingPingju: !!g.pendingPingju,
        lunban: g.game?.state?.lunban,
        paishu: (g.game?.shan as any)?._pai?.length ?? null,
      };
    });
    if (!status) continue;
    if (status.finished || status.roundEnded || status.pendingPingju || status.lastWinner !== null) {
      endReached = true;
      console.log('[single_flow] terminal status:', JSON.stringify(status));
      break;
    }
    // lunban が進んでない = stuck 検出
    if (status.lunban === lastLunban) {
      stuck += 1;
      if (stuck > 8) {
        // CPU step を手動 trigger [stuck 回復]、 visible でなければ window.__gameStore で直接 cpuStep
        const cpuBtn = page.locator('button:has-text("🤖 CPU")').first();
        if (await cpuBtn.isVisible().catch(() => false)) {
          await cpuBtn.click({ force: true }).catch(() => {});
        } else {
          await page.evaluate(() => (window as any).__gameStore?.cpuStep?.());
        }
      }
    } else {
      stuck = 0;
      lastLunban = status.lunban;
    }
  }

  expect(endReached, 'single mode フルフローで終局シグナルに到達せず').toBe(true);
});
