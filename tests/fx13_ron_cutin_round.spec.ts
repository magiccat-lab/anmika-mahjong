import { test, expect, type Page } from '@playwright/test';

// [2026-10-15 リョー「cpu対戦したけどロンのカットインが次局になってない？」]
// 2 シャンテン以上から振り込むと 煽り → ロン の帯が続けて流れる (中 1.7 秒 × 2)。和了の板は決まった 1.35 秒で出ていたので、
// 板の「次局へ」を押すとロンの帯が次の局の頭で出ていた。板は帯が全部終わってから出し、次局へ進んだら前の局の帯は捨てる
// ロンの前の帯は煽り (役満の放銃なら役満放銃)。どちらもロンの前に出る帯
const BEFORE_RON = ['aori', 'yakumanHoju'];
const YAKUHAI = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's2', 's3', 's4', 'z6', 'z6', 'z6', 'z7'];
const FAR = ['p1', 'p4', 'p7', 's2', 's5', 's8', 'p2', 'p5', 's3', 's6', 'z1', 'z2', 'z3'];
const THIRD = ['p2', 'p3', 'p5', 'p7', 'p8', 's2', 's4', 's6', 's7', 'm1', 'm9', 'p9', 's9'];

async function ronFromFar(page: Page) {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible();
  await page.evaluate(({ yakuhai, far, third }) => {
    const st = (window as any).__gameStore;
    st.setCpuSeats([]);
    const g = (window as any).__game.game;
    const d = g.lunbanToPlayerId(g.state.lunban);
    const w = (d + 1) % 3;
    const t = (d + 2) % 3;
    const hands: any = {};
    hands[d] = far; hands[w] = yakuhai; hands[t] = third;
    g.diyizimo = false;
    g.initFromDeal({ hands });
    // 配牌直後のロンは人和 (役満) で飛んで半荘が終わるので、最初の巡は済んだ事にする
    g.firstTurnState.callOccurred = true;
    for (const p of [0, 1, 2]) { g.nukidora[p] = 0; g.nukidoraGold[p] = 0; g.kinpeiTarget[p] = null; }
    g.shan._baopai = ['z2', 'z2'];
    g.shan._fubaopai = ['z2', 'z2'];
    g.shan.commitDoraReveal?.();
    g.lizhi.add(w);
    g.shoupai.get(d).zimo('z7');
    (window as any).__game.lastZimo = 'z7';
    (window as any).__ron = { d, w };
    // 出た帯を順に覚える
    const seen: string[] = [];
    (window as any).__seenCutins = seen;
    let last = 0;
    st.subscribe((s: any) => { if (s.cutin && s.cutin.ts !== last) { last = s.cutin.ts; seen.push(s.cutin.id); } });
    st.discard('z7');
    st.ron(w);
    for (let i = 0; i < 60; i += 1) {
      const p = (window as any).__game.pendingSaiKoro;
      if (!p) break;
      if (!p.selectedCombo) st.selectSaiKoroCombo(1, 4);
      else if (!p.finalized) st.rollSaiKoroDice([6, 3]);
      else st.advanceSaiKoro();
    }
  }, { yakuhai: YAKUHAI, far: FAR, third: THIRD });
}

test('FX13: 煽り (役満放銃) → ロンの帯が終わってから和了の板が出て、次局へ進んでもロンの帯は出ない', async ({ page }) => {
  await ronFromFar(page);
  const panel = page.locator('.agari-unified-panel');
  // ロンの前の帯が流れている間は板が隠れている
  await expect.poll(() => page.evaluate(() => (window as any).__game.cutin?.id)).toBeTruthy();
  expect(BEFORE_RON).toContain(await page.evaluate(() => (window as any).__game.cutin?.id));
  await expect(panel).toHaveClass(/wait-cutin/);
  await expect(panel).toBeHidden();
  // 帯が全部終わったら板が出る。その時にはロンの帯も流れ終わっている
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const done = await page.evaluate(() => ({
    seen: (window as any).__seenCutins.slice(),
    cutin: (window as any).__game.cutin,
    queue: (window as any).__game.cutinQueue.length,
  }));
  expect(done.seen).toContain('ron');
  expect(BEFORE_RON).toContain(done.seen[0]);
  expect(done.cutin).toBeNull();
  expect(done.queue).toBe(0);
  const before = await page.evaluate(() => (window as any).__seenCutins.length);
  await panel.getByRole('button', { name: '▶ 次局へ' }).click();
  await expect(panel).toBeHidden();
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => (window as any).__seenCutins.slice());
  expect(after.slice(before)).not.toContain('ron');
  for (const id of BEFORE_RON) expect(after.slice(before)).not.toContain(id);
});

test('FX13: 帯の途中で次局へ進んでも、残りの帯は次の局に持ち越さない', async ({ page }) => {
  await ronFromFar(page);
  await expect.poll(() => page.evaluate(() => (window as any).__game.cutin?.id)).toBeTruthy();
  expect(BEFORE_RON).toContain(await page.evaluate(() => (window as any).__game.cutin?.id));
  // 板は隠れているので、上の札の「次局へ」と同じ store の nextRound を直に呼ぶ
  await page.evaluate(() => (window as any).__gameStore.nextRound());
  const s = await page.evaluate(() => ({ cutin: (window as any).__game.cutin, queue: (window as any).__game.cutinQueue.length }));
  expect(s.cutin).toBeNull();
  expect(s.queue).toBe(0);
  const before = await page.evaluate(() => (window as any).__seenCutins.length);
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => (window as any).__seenCutins.slice());
  expect(after.slice(before)).not.toContain('ron');
});
