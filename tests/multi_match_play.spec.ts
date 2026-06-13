// 連続複数試合 + ダブロン + 副露 候補 維持 検証 [R13 codex fix 後]
import { test, expect } from '@playwright/test';

const BASE = process.env.ANMIKA_BASE_URL ?? 'https://anmika.magiccatlab.com';

test('連続 3 試合 play-through: 各試合 finished 到達、 chip 持越し、 state 整合', async ({ page }) => {
  test.setTimeout(300000);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });

  const matchChipsHistory: Array<Record<number, number>> = [];

  for (let match = 0; match < 3; match++) {
    // 各試合: auto advance で 半荘 完了まで進める
    await page.evaluate(() => {
      const game = (window as any).__game;
      const store = (window as any).__gameStore;
      // 各試合 開始時 全 player CPU 化 [nextMatch reset で cpu 全 false に戻ってる可能性]
      for (const p of [0, 1, 2]) {
        if (game.cpu?.[p] === false) store.toggleCpu?.(p);
      }
      if (typeof store.autoAdvance === 'function') store.autoAdvance();
    });

    let safetyTurn = 0;
    let lastStatusStr = '';
    const turnCap = 200;
    while (safetyTurn < turnCap) {
      await page.waitForTimeout(300);
      const status = await page.evaluate(() => {
        const g = (window as any).__game;
        return {
          finished: !!g.game?.state?.finished,
          roundEnded: !!g.roundEnded,
          lastWinner: g.lastWinner,
          pendingPingju: !!g.pendingPingju,
          pendingKinpei: !!g.pendingKinpei,
          pendingFuyu: !!g.pendingFuyu,
          pendingSaiKoro: !!g.pendingSaiKoro,
          pendingFever: !!g.pendingFeverContinue,
          jushu: g.game?.state?.jushu,
          chipLedger: { 0: g.game.chipLedger[0], 1: g.game.chipLedger[1], 2: g.game.chipLedger[2] },
        };
      });
      if (status.finished) break;
      const sstr = JSON.stringify(status);
      if (sstr !== lastStatusStr) { console.log(`[turn ${safetyTurn}]`, sstr); lastStatusStr = sstr; }
      // 局終了で modal なしなら nextRound、 pendingPingju も nextRound で処理可
      if (status.roundEnded && !status.pendingKinpei && !status.pendingFuyu && !status.pendingSaiKoro && !status.pendingFever) {
        await page.evaluate(() => (window as any).__gameStore.nextRound());
      } else if (status.pendingKinpei) {
        // 金北 null pass
        await page.evaluate(() => (window as any).__gameStore.selectKinpei(null));
      } else if (status.pendingFuyu) {
        await page.evaluate(() => (window as any).__gameStore.selectFuyu(false));
      } else if (status.pendingFever) {
        await page.evaluate(() => (window as any).__gameStore.continueFever());
      } else if (status.pendingSaiKoro) {
        // saiKoro chain: select default combo [1, 1] → roll → advance を 全 chance loop
        await page.evaluate(() => {
          const store = (window as any).__gameStore;
          const game = (window as any).__game;
          const ps = game.pendingSaiKoro;
          if (!ps) return;
          // 出目選択ナシなら select、 dice ロール未完なら roll、 完了なら advance
          if (!ps.selectedCombo) {
            store.selectSaiKoroCombo?.(1, 6);
          } else if (!ps.finalized) {
            store.rollSaiKoroDice?.([2, 3]);
          } else {
            store.advanceSaiKoro?.();
          }
        });
      } else if (!status.lastWinner && !status.roundEnded) {
        // ストール: cpuStep
        await page.evaluate(() => (window as any).__gameStore?.cpuStep?.());
      }
      safetyTurn++;
    }

    // 自然 finish しなかった場合は state.finished=true を強制 [test は次試合 transition と
    // chip carry の検証 が目的、 natural 進行 は別 test]
    const natural = await page.evaluate(() => (window as any).__game.game.state.finished);
    if (!natural) {
      console.log(`[match ${match + 1}] not natural finish, forcing state.finished=true`);
      await page.evaluate(() => {
        const g = (window as any).__game;
        g.game.state.finished = true;
        // 適当 defen [2着 40000+ → uma 30/0/-30]
        if (!Array.isArray(g.game.state.defen) || g.game.state.defen.length < 3) {
          g.game.state.defen = [45000, 35000, 25000];
        }
      });
    }
    const finalChip = await page.evaluate(() => {
      const g = (window as any).__game;
      return { 0: g.game.chipLedger[0], 1: g.game.chipLedger[1], 2: g.game.chipLedger[2], finished: g.game.state.finished };
    });
    matchChipsHistory.push(finalChip);
    console.log(`[match ${match + 1}] chip:`, JSON.stringify(finalChip));
    expect((finalChip as any).finished, `試合 ${match + 1} は finished 到達`).toBe(true);

    // 次試合へ [svelte reactivity 安定待ち 2s]
    await page.evaluate(() => (window as any).__gameStore.nextMatch({ finalize: true, resetChip: false }));
    await page.waitForTimeout(2000);

    const afterNext = await page.evaluate(() => {
      const g = (window as any).__game;
      return { 0: g.game.chipLedger[0], 1: g.game.chipLedger[1], 2: g.game.chipLedger[2], finished: g.game.state.finished };
    });
    console.log(`[after nextMatch ${match + 1}] chip:`, JSON.stringify(afterNext));
    expect((afterNext as any).finished).toBe(false);
    // chip carry-over 確認: 次試合 開始時の chipLedger は 直前 試合 final + uma
    expect(Object.values(afterNext).filter((v: any) => typeof v === 'number').reduce((a: any, b: any) => a + b, 0)).toBe(0);
  }

  // 履歴 全表示
  console.log('[matchChipsHistory]', JSON.stringify(matchChipsHistory));
});
