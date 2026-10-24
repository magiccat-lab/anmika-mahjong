// [2026-10-25] 白ぽっちは自動のムービー + PUSH に変わった。PUSH の前は DOM のどこにも色由来の物が無い事も見る
// [2026-10-14 リョー「アンミカの演出、裏に上がりが出てばれてることあるよ」]
// 白ぽっちの絞りの幕 (78%) の裏で、めくる前に和了か外れかが分からない事。
// 和了の時: ツモのボタン ・ 上の帯の「ツモ和了」が出ず、自動和了も絞りが閉じるまで待つ。
// 外れの時: リーチの自動ツモ切りが絞りの途中で牌を河へ捨てない
import { test, expect, type Page } from '@playwright/test';

async function solo(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible();
  await page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
  await page.waitForTimeout(300);
}
const QUIET_PLAN = { opening: 'none', glow: 'white', pulse: 'slow', particle: 'none', crack: 'none', push: 'normal', lamp: null, delay: false, premium: null };
async function pochi(page: Page, pai = 'z5b', plan: Record<string, unknown> = {}) {
  await page.evaluate(({ pai, plan }) => {
    const w = window as any;
    w.__forcePlan = plan;
    const s = w.__game;
    s.game.lizhi.add(0);
    s.game.feverActive = [false, false, false];
    s.game.events.push({ type: 'zimo', player: 0, pai });
    w.__gameStore.setCpuSeats([]);
  }, { pai, plan: { ...QUIET_PLAN, ...plan } });
  await expect(page.locator('.sq-tile')).toBeVisible();
}
async function squeezeOpenAndWaitClose(page: Page) {
  // 画面を触って PUSH まで飛ばし、押す
  await page.locator('[data-testid=pochi-skip]').click({ position: { x: 4, y: 4 } });
  await page.locator('[data-testid=pochi-push]').click();
  await expect(page.locator('.sq')).toHaveCount(0, { timeout: 8000 });
}
// 手を和了の形にする: 123456789p 11s 999s、ツモ 9s
async function winningHand(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const g = (window as any).__game;
    const sp = g.game.shoupai.get(0);
    if (!sp?._zimo) return false;
    for (const s of ['m', 'p', 's', 'z']) for (let n = 0; n < sp._bingpai[s].length; n++) sp._bingpai[s][n] = 0;
    for (let n = 1; n <= 9; n++) sp._bingpai.p[n] = 1;
    sp._bingpai.s[1] = 2; sp._bingpai.s[9] = 3;
    sp._zimo = 's9';
    return g.game.canTsumo(0);
  });
}

test('和了の時: 絞りの裏にツモのボタンと「ツモ和了」が出ず、自動和了は閉じてから', async ({ page }) => {
  await solo(page);
  await page.locator('.me-toggles .autowin-toggle input').check();
  // 自動和了が先に動かない様に、絞りを出してから和了の形にする
  await pochi(page);
  expect(await winningHand(page)).toBe(true);
  await page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
  await page.waitForTimeout(1500);
  expect(await page.locator('.agari-center-btn').count()).toBe(0);
  expect(await page.locator('.turn-status').textContent()).not.toContain('ツモ和了');
  expect(await page.evaluate(() => (window as any).__game.lastWinner)).toBeNull();
  await squeezeOpenAndWaitClose(page);
  await expect.poll(async () => page.evaluate(() => (window as any).__game.lastWinner), { timeout: 5000 }).toBe(0);
});

test('和了の時 (自動和了なし): 閉じた後にツモのボタンが出る', async ({ page }) => {
  await solo(page);
  await pochi(page);
  expect(await winningHand(page)).toBe(true);
  await page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
  await page.waitForTimeout(500);
  expect(await page.locator('.agari-center-btn').count()).toBe(0);
  await squeezeOpenAndWaitClose(page);
  await expect(page.locator('.agari-center-btn')).toBeVisible({ timeout: 3000 });
});

test('外れの時: リーチの自動ツモ切りは絞りが閉じるまで捨てない', async ({ page }) => {
  await solo(page);
  const before = await page.evaluate(() => (window as any).__game.game.he.get(0)._pai.length);
  await pochi(page);
  expect(await page.evaluate(() => (window as any).__game.game.canTsumo(0))).toBe(false);
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => (window as any).__game.game.he.get(0)._pai.length)).toBe(before);
  await squeezeOpenAndWaitClose(page);
  await expect.poll(async () => page.evaluate(() => (window as any).__game.game.he.get(0)._pai.length), { timeout: 5000 }).toBe(before + 1);
});

// PUSH の前は、overlay の DOM (class ・ style ・ 属性 ・ 文字) のどこにも色由来の物が出ない。ムービーを通しで 150ms ごとに見る
const POCHI_DOT_HEX = ['#133382', '#1e8a3c', '#c8102e', '#e8b400'];
for (const [name, pai] of [['青 (当たり)', 'z5b'], ['赤 (外れ)', 'z5r'], ['緑', 'z5g'], ['黄', 'z5y']] as const) {
  test(`色は PUSH の前に DOM へ出ない: ${name}`, async ({ page }) => {
    test.setTimeout(60_000);
    await solo(page);
    // 予告 (稲妻) ・ 虹まで光る ・ 発展 (粒子) ・ 溜め (ひび 全体) ・ キリン柄 ・ 金の PUSH を全部通す
    await pochi(page, pai, { opening: 'bolt', glow: 'rainbow', pulse: 'fast', particle: 'suck', crack: 'all', push: 'gold', premium: 'kirin' });
    const stages = new Set<string>();
    let samples = 0;
    for (let i = 0; i < 150; i += 1) {
      const html = await page.locator('[data-testid=pochi-skip]').evaluate((el) => ({ html: el.outerHTML, stage: el.getAttribute('data-stage') }));
      stages.add(html.stage ?? '');
      samples += 1;
      const low = html.html.toLowerCase();
      expect(low, 'z5').not.toContain('z5');
      expect(low, 'Haku-').not.toContain('haku-');
      for (const hex of POCHI_DOT_HEX) expect(low, hex).not.toContain(hex);
      expect(html.html, 'color word').not.toMatch(/\b(blue|red|green|yellow)\b/i);
      expect(html.html, '色の漢字').not.toMatch(/青|赤|緑|黄/);
      if (html.stage === 'push') break;
      await page.waitForTimeout(150);
    }
    expect(stages.has('push')).toBe(true);
    expect(samples).toBeGreaterThan(10);
    for (const st of ['opening', 'glow', 'develop', 'tame']) expect(stages.has(st), st).toBe(true);
    // PUSH を押した後で初めて色が出る
    await page.locator('[data-testid=pochi-push]').click();
    await expect(page.locator('.sq-band.reveal .sq-word')).toHaveText(({ z5b: '青ぽっち', z5r: '赤ぽっち', z5g: '緑ぽっち', z5y: '黄ぽっち' } as any)[pai]);
  });
}
