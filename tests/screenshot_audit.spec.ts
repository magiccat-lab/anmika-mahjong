// 見た目 audit 用: 主要画面 [menu / 卓 / カットイン / 和了 / 流局] のスクショを撮る。
// 通常の e2e run では skip。演出をいじる時に
//   SHOT_DIR=/path/to/out npx playwright test tests/screenshot_audit.spec.ts
// で before/after を撮って目視比較する [2026-07-20 演出改善で導入]
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const OUT = process.env.SHOT_DIR ?? '';

test('screenshot audit: menu / table / cutin / round end', async ({ page }) => {
  test.skip(!OUT, 'SHOT_DIR 指定時のみ実行する視覚 audit');
  test.setTimeout(240_000);
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/01_menu.png` });

  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/02_table_start.png` });

  await page.evaluate(() => {
    const store = (window as any).__gameStore;
    store.setCpuSeats([0, 1, 2]);
    store.autoAdvance?.();
  });

  let gotCutin = false;
  let gotHule = false;
  let gotPingju = false;
  for (let i = 0; i < 2400 && !gotHule; i++) {
    await page.waitForTimeout(120);
    if (!gotCutin && (await page.locator('.cutin-overlay').count()) > 0) {
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${OUT}/03_cutin.png` });
      gotCutin = true;
    }
    const st = await page.evaluate(() => {
      const g = (window as any).__game;
      return {
        roundEnded: !!g.roundEnded,
        lastWinner: g.lastWinner,
        finished: !!g.game?.state?.finished,
        pendingKinpei: !!g.pendingKinpei,
        pendingFuyu: !!g.pendingFuyu,
        pendingSaiKoro: !!g.pendingSaiKoro,
        pendingFever: !!g.pendingFeverContinue,
        pendingPingju: !!g.pendingPingju,
      };
    });
    if (st.roundEnded) {
      await page.waitForTimeout(2400);
      if (st.lastWinner !== null && st.lastWinner !== undefined) {
        await page.screenshot({ path: `${OUT}/04_round_end_hule.png` });
        const panel = page.locator('.hule-panel');
        if ((await panel.count()) > 0) {
          await panel.first().screenshot({ path: `${OUT}/04b_hule_panel.png` });
        }
        gotHule = true;
        break;
      }
      if (!gotPingju) {
        await page.screenshot({ path: `${OUT}/04_round_end_pingju.png` });
        gotPingju = true;
      }
      if (st.finished) break;
      await page.evaluate(() => (window as any).__gameStore.nextRound());
      continue;
    }
    if (st.pendingKinpei) {
      await page.screenshot({ path: `${OUT}/05_kinpei_modal.png` });
      await page.evaluate(() => (window as any).__gameStore.selectKinpei(null));
    } else if (st.pendingFuyu) {
      await page.screenshot({ path: `${OUT}/06_fuyu_modal.png` });
      await page.evaluate(() => (window as any).__gameStore.selectFuyu(false));
    } else if (st.pendingFever) {
      await page.evaluate(() => (window as any).__gameStore.continueFever());
    } else if (st.pendingSaiKoro) {
      await page.screenshot({ path: `${OUT}/07_saikoro_modal.png` });
      await page.evaluate(() => {
        const store = (window as any).__gameStore;
        const g = (window as any).__game;
        const ps = g.pendingSaiKoro;
        if (!ps) return;
        if (!ps.selectedCombo) store.selectSaiKoroCombo?.(1, 6);
        else if (!ps.finalized) store.rollSaiKoroDice?.([2, 3]);
        else store.advanceSaiKoro?.();
      });
    } else {
      await page.evaluate(() => (window as any).__gameStore?.cpuStep?.());
    }
  }
  console.log('[shots]', JSON.stringify({ gotCutin, gotHule, gotPingju }));
});
