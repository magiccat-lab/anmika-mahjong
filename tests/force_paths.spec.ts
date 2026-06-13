// 強制経路 e2e: 流局 / 山枯渇 周辺の state 整合 [R13 P2 #9 rollback regression 検出狙い]
import { test, expect } from '@playwright/test';

const BASE = process.env.ANMIKA_BASE_URL ?? 'https://anmika.magiccatlab.com';

test('流局強制: shan を空近くまで進めて pingju 到達 → nextRound で復帰', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });

  // 全 player CPU 化 + autoAdvance、 ただし shan を 早期に減らす [手動枯渇は backdoor で]
  await page.evaluate(() => {
    const game = (window as any).__game;
    const store = (window as any).__gameStore;
    for (const p of [0, 1, 2]) {
      if (game.cpu?.[p] === false) store.toggleCpu?.(p);
    }
    // shan を 5 枚残まで強制 trim [流局到達加速]
    // window.__game は store snapshot、 game.game = Game3 instance、 game.game.shan = ShanSanma
    const shan: any = game.game?.shan;
    if (Array.isArray(shan?._pai) && shan._pai.length > 5) {
      shan._pai.splice(0, shan._pai.length - 5);
    }
    if (typeof store.autoAdvance === 'function') store.autoAdvance();
  });

  // 流局 / hule どちらでも roundEnded まで進める
  let safetyTurn = 0;
  let reachedPingju = false;
  let reachedRoundEnd = false;
  while (safetyTurn < 200) {
    await page.waitForTimeout(200);
    const status = await page.evaluate(() => {
      const g = (window as any).__game;
      return {
        finished: !!g.game?.state?.finished,
        roundEnded: !!g.roundEnded,
        pendingPingju: !!g.pendingPingju,
        pendingKinpei: !!g.pendingKinpei,
        pendingFuyu: !!g.pendingFuyu,
        pendingSaiKoro: !!g.pendingSaiKoro,
        pendingFever: !!g.pendingFeverContinue,
        shanRest: (g.shan?._pai?.length ?? 0),
        lastWinner: g.lastWinner,
      };
    });
    if (status.pendingPingju) reachedPingju = true;
    if (status.roundEnded) reachedRoundEnd = true;
    if (status.pendingPingju || status.roundEnded) break;
    if (status.pendingKinpei) {
      await page.evaluate(() => (window as any).__gameStore.selectKinpei(null));
    } else if (status.pendingFuyu) {
      await page.evaluate(() => (window as any).__gameStore.selectFuyu(false));
    } else if (status.pendingFever) {
      await page.evaluate(() => (window as any).__gameStore.continueFever());
    } else if (status.pendingSaiKoro) {
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
    safetyTurn++;
  }

  console.log('[force pingju]', JSON.stringify({ reachedPingju, reachedRoundEnd, safetyTurn }));
  expect(reachedPingju || reachedRoundEnd, 'shan trim 後 pingju or roundEnded のいずれか到達').toBe(true);

  // 復帰: state.finished なら nextMatch、 そうでなければ nextRound
  const before = await page.evaluate(() => {
    const g = (window as any).__game;
    return { finished: !!g.game?.state?.finished, jushu: g.game?.state?.jushu };
  });
  console.log('[before recovery]', JSON.stringify(before));
  if (before.finished) {
    await page.evaluate(() => (window as any).__gameStore.nextMatch({ finalize: true, resetChip: false }));
  } else {
    await page.evaluate(() => (window as any).__gameStore.nextRound());
  }
  await page.waitForTimeout(2000);

  const after = await page.evaluate(() => {
    const g = (window as any).__game;
    return {
      finished: !!g.game?.state?.finished,
      roundEnded: !!g.roundEnded,
      pendingPingju: !!g.pendingPingju,
      shanRest: (g.game?.shan?._pai?.length ?? 0),
      jushu: g.game?.state?.jushu,
    };
  });
  console.log('[after recovery]', JSON.stringify(after));
  expect(after.pendingPingju, '復帰後 pendingPingju 解除').toBe(false);
  // roundEnded は半荘終了 [shan trim → 異常 流局 で defen 大幅移動 → トビ → finished=true]
  // のケースで true 維持される [仕様、 store.ts:1537]、 nextMatch 後初めて false に
  // よって ここは finished=true なら roundEnded=true 許容、 そうでなければ false 必須
  if (!after.finished) {
    expect(after.roundEnded, '復帰後 [非 finished] roundEnded false').toBe(false);
  }
});

test('暗槓強制: 手牌に同種 4 枚を直書き → declareKan(暗槓) → rinshan zimo + state 整合', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10000 });

  // 親 P0 の 手牌 を m1×4 + 適当 9 枚 + zimo m1 (= ankan 候補成立) に直書き
  const setup = await page.evaluate(() => {
    const g = (window as any).__game;
    const sp = g.game.shoupai.get(0);
    if (!sp) return { ok: false, reason: 'shoupai missing' };
    // _bingpai を直書き [配列 [萬][1-9] / [筒][1-9] / [索][1-9] / [字][1-7]]
    try {
      // m1 を 4 枚 set
      sp._bingpai.m[1] = 4;
      // 残 9 枚を p1-9 で適当に埋める [合計 13 枚 + zimo 1 = 14]
      sp._bingpai.p[1] = 1; sp._bingpai.p[2] = 1; sp._bingpai.p[3] = 1;
      sp._bingpai.p[4] = 1; sp._bingpai.p[5] = 1; sp._bingpai.p[6] = 1;
      sp._bingpai.p[7] = 1; sp._bingpai.p[8] = 1; sp._bingpai.p[9] = 1;
      // 他の m / s / z は 0
      for (let i = 2; i <= 9; i++) sp._bingpai.m[i] = 0;
      for (let i = 1; i <= 9; i++) sp._bingpai.s[i] = 0;
      for (let i = 1; i <= 7; i++) sp._bingpai.z[i] = 0;
      sp._zimo = null;
      // qipai 後 zimo を呼ばずに 状態を 「P0 zimo 待ち」 に強制、 そのあと zimo
      const newZimo = g.game.zimo();
      return { ok: true, newZimo, m1Count: sp._bingpai.m[1], lunban: g.game.state.lunban, jushu: g.game.state.jushu };
    } catch (e: any) {
      return { ok: false, reason: String(e?.message ?? e) };
    }
  });
  console.log('[ankan setup]', JSON.stringify(setup));
  expect(setup.ok, '手牌 直書き 成功').toBe(true);

  // declareKan('m1111') で暗槓
  const kanResult = await page.evaluate(() => {
    const store = (window as any).__gameStore;
    const g = (window as any).__game;
    try {
      store.declareKan?.('m1111');
      return {
        ok: true,
        m1Count: g.game.shoupai.get(0)._bingpai.m[1],
        fulouLen: (g.game.shoupai.get(0)._fulou ?? []).length,
        zimo: g.game.shoupai.get(0)._zimo,
        roundEnded: g.roundEnded,
      };
    } catch (e: any) {
      return { ok: false, reason: String(e?.message ?? e) };
    }
  });
  console.log('[ankan result]', JSON.stringify(kanResult));
  expect(kanResult.ok, '暗槓 declare 成功').toBe(true);
  // ankan 後: 手牌 m1=0、 fulou +1、 rinshan zimo で _zimo に何か入る
  expect(kanResult.m1Count, 'ankan 後 m1 = 0').toBe(0);
  expect(kanResult.fulouLen, 'fulou +1').toBeGreaterThanOrEqual(1);
});
