// 連続 10 試合 play-through [長時間 e2e、 chip drift / nextMatch transition / state corruption 洗い出し]
import { test, expect } from '@playwright/test';

const BASE = process.env.ANMIKA_BASE_URL ?? 'https://anmika.magiccatlab.com';
const N_MATCHES = Number(process.env.ANMIKA_N_MATCHES ?? 5);

test(`連続 ${N_MATCHES} 試合 play-through: 各試合 finished 到達 / chip 持越し / state 整合 / drift なし`, async ({ page }) => {
  test.setTimeout(60_000 * N_MATCHES);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });

  const matchChipsHistory: Array<Record<number, number>> = [];
  const chipLedgerSums: number[] = [];
  const naturalFinishCount = { ok: 0, forced: 0 };

  for (let match = 0; match < N_MATCHES; match++) {
    await page.evaluate(() => {
      const game = (window as any).__game;
      const store = (window as any).__gameStore;
      for (const p of [0, 1, 2]) {
        if (game.cpu?.[p] === false) store.toggleCpu?.(p);
      }
      if (typeof store.autoAdvance === 'function') store.autoAdvance();
    });

    let safetyTurn = 0;
    let lastStatusStr = '';
    let saiKoroStuckCount = 0;
    const turnCap = 1200;
    while (safetyTurn < turnCap) {
      await page.waitForTimeout(250);
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
        };
      });
      if (status.finished) break;
      const sstr = JSON.stringify(status);
      if (sstr !== lastStatusStr) lastStatusStr = sstr;
      if (status.roundEnded && !status.pendingKinpei && !status.pendingFuyu && !status.pendingSaiKoro && !status.pendingFever) {
        await page.evaluate(() => (window as any).__gameStore.nextRound());
      } else if (status.pendingKinpei) {
        await page.evaluate(() => (window as any).__gameStore.selectKinpei(null));
      } else if (status.pendingFuyu) {
        await page.evaluate(() => (window as any).__gameStore.selectFuyu(false));
      } else if (status.pendingFever) {
        await page.evaluate(() => (window as any).__gameStore.continueFever());
      } else if (status.pendingSaiKoro) {
        saiKoroStuckCount++;
        if (saiKoroStuckCount > 30) {
          // 30 turn 連続 saiKoro pending = stall 候補、 状態 dump
          const dump = await page.evaluate(() => {
            const g = (window as any).__game;
            const ps = g.pendingSaiKoro;
            return {
              pendingSaiKoro: ps ? {
                currentIdx: ps.currentIdx,
                chancesLen: ps.chances?.length,
                winner: ps.winner,
                selectedCombo: ps.selectedCombo,
                rolls: ps.rolls,
                finalized: ps.finalized,
                summary: ps.summary,
                chances: ps.chances?.map((c: any) => ({
                  name: c.name,
                  winner: c.winner,
                })),
              } : null,
              awaitingRonDecision: !!g.awaitingRonDecision,
              roundEnded: !!g.roundEnded,
              lastWinner: g.lastWinner,
            };
          });
          console.log(`[SAIKORO STALL match=${match + 1} turn=${safetyTurn}]`, JSON.stringify(dump));
          throw new Error(`saiKoro stall in match ${match + 1} at turn ${safetyTurn}`);
        }
        await page.evaluate(() => {
          const store = (window as any).__gameStore;
          const game = (window as any).__game;
          const ps = game.pendingSaiKoro;
          if (!ps) return;
          if (!ps.selectedCombo) {
            store.selectSaiKoroCombo?.(1, 6);  // ゾロ目以外 [store が same value reject]
          } else if (!ps.finalized) {
            store.rollSaiKoroDice?.([2, 3]);  // 非ゾロ [ゾロ目は finalize count 入らない]
          } else {
            store.advanceSaiKoro?.();
          }
        });
      } else if (!status.lastWinner && !status.roundEnded) {
        await page.evaluate(() => (window as any).__gameStore?.cpuStep?.());
      }
      if (!status.pendingSaiKoro) saiKoroStuckCount = 0;
      safetyTurn++;
    }

    const natural = await page.evaluate(() => (window as any).__game.game.state.finished);
    if (!natural) {
      naturalFinishCount.forced++;
      console.log(`[match ${match + 1}] not natural, skip forced [test gates only natural finish]`);
      // 強制 finish 経路は store の nextMatch guard [pending modal / awaitingRonDecision]
      // を通過できず この test の検証 [chip carry] に意味がないので skip。
      // 代わりに「natural finish 1200 turn 内に届かない」 を bug 報告として break。
      break;
    } else {
      naturalFinishCount.ok++;
    }

    const finalChip = await page.evaluate(() => {
      const g = (window as any).__game;
      return { 0: g.game.chipLedger[0], 1: g.game.chipLedger[1], 2: g.game.chipLedger[2], finished: g.game.state.finished };
    });
    matchChipsHistory.push(finalChip);
    expect((finalChip as any).finished, `試合 ${match + 1} は finished 到達`).toBe(true);

    await page.evaluate(() => (window as any).__gameStore.nextMatch({ finalize: true, resetChip: false }));
    await page.waitForTimeout(2000);

    const afterNext = await page.evaluate(() => {
      const g = (window as any).__game;
      return { 0: g.game.chipLedger[0], 1: g.game.chipLedger[1], 2: g.game.chipLedger[2], finished: g.game.state.finished };
    });
    console.log(`[match ${match + 1}] final=${JSON.stringify(finalChip)} after_next=${JSON.stringify(afterNext)}`);
    expect((afterNext as any).finished, `試合 ${match + 1} の次試合は finished=false`).toBe(false);

    const sum = Object.entries(afterNext).filter(([k]) => k !== 'finished').reduce((a, [, v]) => a + (v as number), 0);
    chipLedgerSums.push(sum);
    expect(sum, `試合 ${match + 1} 終了後 chip sum = 0`).toBe(0);
  }

  console.log('[long_match_play summary]', JSON.stringify({
    matches: N_MATCHES,
    natural: naturalFinishCount.ok,
    forced: naturalFinishCount.forced,
    chipSums: chipLedgerSums,
    history: matchChipsHistory,
  }));
  // 全試合 natural finish 必須 [強制経路は break するので forced > 0 = bug 候補]
  expect(naturalFinishCount.ok, `${N_MATCHES} 試合 全 natural finish に届いた`).toBe(N_MATCHES);
});
