import { test, expect, type Page } from '@playwright/test';

// [2026-10-15 リョー「冬冬金北の時だけ自分で1つづつ捲る演出とかつけられる？」→ ラフ anmika-fuyu1 の 3 に ○]
// 冬冬金北で和了ると、冬めくりの牌を伏せて並べ、自分で 1 枚ずつ押してめくる (FuyuFlip)。上段が外れたらラストチャンス。
// めくる牌と当たりは和了の時に決まった fuyuLog のまま。めくり終わって OK を押すまで和了の板は出ない
// 手牌は 一二三筒 四五六筒 二三四索 發發發 中 (中のツモで和了)。山の頭の 6 組で、2 ・ 3 ・ 5 組目は上段が外れて下段で当たり、6 組目で上下とも外れて終わる。合計 15 枚
const HAND = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's2', 's3', 's4', 'z6', 'z6', 'z6', 'z7'];
const WALL = ['p5', 's9', 'm9', 'z1', 'z2', 's3', 'f1', 'p9', 'm1', 'z5y', 's8', 'm7'];

async function winWithWinter(page: Page, fuyu: number, cpuWinner = false) {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible();
  await page.evaluate(({ hand, wall, fuyu, cpu }) => {
    const st = (window as any).__gameStore;
    st.setCpuSeats([]);
    const g = (window as any).__game.game;
    const d = g.lunbanToPlayerId(g.state.lunban);
    const hands: any = {};
    hands[d] = hand;
    hands[(d + 1) % 3] = ['p7', 'p8', 'p9', 's5', 's6', 's7', 'm1', 'm1', 'z1', 'z2', 'z3', 's8', 's9'];
    hands[(d + 2) % 3] = ['p1', 'p4', 'p7', 's2', 's5', 's8', 'p2', 'p5', 's3', 's6', 'z1', 'z2', 'z3'];
    g.diyizimo = false;
    g.initFromDeal({ hands });
    g.firstTurnState.callOccurred = true;
    for (const p of [0, 1, 2]) { g.nukidora[p] = 0; g.nukidoraGold[p] = 0; g.kinpeiTarget[p] = null; }
    g.huapai[d] = Array(fuyu).fill('f4');
    g.nukidoraGold[d] = 1;
    g.kinpeiTarget[d] = 'fuyu';
    g.shan._baopai = ['z2', 'z2'];
    g.shan._fubaopai = ['z2', 'z2'];
    g.shan.commitDoraReveal?.();
    g.shan._pai.unshift(...wall);
    g.lizhi.add(d);
    g.shoupai.get(d).zimo('z7');
    (window as any).__game.lastZimo = 'z7';
    (window as any).__winner = d;
    if (cpu) st.setCpuSeats([d]);
  }, { hand: HAND, wall: WALL, fuyu, cpu: cpuWinner });
  await page.evaluate(() => (window as any).__gameStore.tsumo());
}

test('FX14: 冬冬金北は自分で 1 枚ずつめくり、上段が外れたらラストチャンス、合計は和了の結果と同じ', async ({ page }) => {
  await winWithWinter(page, 2);
  const ff = page.locator('[data-testid=fuyu-flip]');
  await expect(ff).toBeVisible({ timeout: 15_000 });
  const panel = page.locator('.agari-unified-panel');
  await expect(panel).toBeHidden();
  const log = await page.evaluate(() => (window as any).__game.lastHuleResult.fuyuLog.map((e: any) => `${e.pai}:${e.hit}`));
  expect(log).toEqual(['p5:3', 's9:0', 'm9:0', 'z1:1', 'z2:0', 's3:3', 'f1:2', 'p9:1', 'm1:0', 'z5y:5', 's8:0', 'm7:0']);
  // 伏せてあるのは次の組だけ (何組続くかは見えない)
  await expect(page.locator('.ff-slot.down')).toHaveCount(2);
  const seen: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    await page.locator('.ff-slot.down.pulse').first().click({ force: true });
    await page.waitForTimeout(80);
    if (await page.locator('.ff-lc').count()) seen.push(`lc@${i + 1}`);
  }
  // ラストチャンスは上段が外れた所 (2 ・ 3 ・ 5 ・ 6 組目) の後だけ
  expect(seen).toEqual(['lc@3', 'lc@5', 'lc@9', 'lc@11']);
  await expect(ff).toHaveClass(/ended/);
  await expect(page.locator('.ff-sum b')).toHaveText('15');
  await expect(page.locator('.ff-slot.down')).toHaveCount(0);
  // 当たった牌から手牌が光る (中は白の隣)
  await expect(page.locator('.ff-h.lit')).not.toHaveCount(0);
  await page.locator('.ff-btn', { hasText: 'OK' }).click();
  await expect(ff).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(panel.locator('.fuyu-sum')).toContainText('15');
  // 閉じた後は出し直さない
  await page.waitForTimeout(800);
  await expect(ff).toHaveCount(0);
});

test('FX14: まとめてめくると残りを一度に返して合計を出す', async ({ page }) => {
  await winWithWinter(page, 2);
  const ff = page.locator('[data-testid=fuyu-flip]');
  await expect(ff).toBeVisible({ timeout: 15_000 });
  await page.locator('.ff-slot.down.pulse').first().click({ force: true });
  await page.getByRole('button', { name: 'まとめてめくる' }).click();
  await expect(ff).toHaveClass(/ended/);
  await expect(page.locator('.ff-sum b')).toHaveText('15');
});

test('FX14: 押さずに 10 秒たつと自動でめくり始める', async ({ page }) => {
  await winWithWinter(page, 2);
  const ff = page.locator('[data-testid=fuyu-flip]');
  await expect(ff).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(8_000);
  await expect(page.locator('.ff-slot.open')).toHaveCount(0);
  await expect(ff).toHaveClass(/ended/, { timeout: 15_000 });
  await expect(page.locator('.ff-sum b')).toHaveText('15');
});

test('FX14: 冬 1 枚の金北は今のまま (めくりの画面を出さず、和了の板に並べる)', async ({ page }) => {
  await winWithWinter(page, 1);
  const panel = page.locator('.agari-unified-panel');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('.fuyu-row')).toBeVisible();
  await expect(page.locator('[data-testid=fuyu-flip]')).toHaveCount(0);
});

test('FX14: CPU の冬冬金北は自動でめくり、合計を見せて自分で閉じる', async ({ page }) => {
  await winWithWinter(page, 2, true);
  const ff = page.locator('[data-testid=fuyu-flip]');
  await expect(ff).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.ff-slot.down.pulse')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'まとめてめくる' })).toHaveCount(1);
  await expect(ff).toHaveClass(/ended/, { timeout: 15_000 });
  await expect(page.locator('.ff-sum b')).toHaveText('15');
  await expect(ff).toHaveCount(0, { timeout: 5_000 });
});
