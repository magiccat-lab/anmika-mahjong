// [2026-10-15 リョー] 4 つの追い指示の確かめ
// 1「フィーバーの時にツモギリの速度をちょっと遅くしたい」→ 強制ツモ切りは 1 秒 (旧 0.6 秒)
// 2「演出の速度もうちょい落として楽しめるようにして」→ カットインは 軽 1.0 / 中 1.7 / 重 2.4 秒
// 3「フィーバー中で他の人が一発でぽっちとかつもると関係ないのに演出は言ってるよ」→ フィーバーでない人のでかぽっちは絞りを出さない
// 4「北抜きとかのUI、華の下に出すようにすれば画面上下しなくていい」→ 同じ日に「北抜きボタンは同じでいい。上のログの北抜きを華の下に置けって」
//   → 北抜きのボタンは手牌の上の帯のまま。華の下へ動かすのはお知らせの帯 (オンライン、tests/online_msg_band.spec.ts)
import { test, expect, type Page } from '@playwright/test';

async function solo(page: Page, w = 1280, h = 800) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible();
  await page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
  await page.waitForTimeout(300);
}
const nudge = (page: Page) => page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
const heLen = (page: Page) => page.evaluate(() => (window as any).__game.game.he.get(0)._pai.length);

test('1. フィーバーの強制ツモ切りは 1 秒 (0.7 秒ではまだ切らない)', async ({ page }) => {
  await solo(page);
  const before = await heLen(page);
  await page.evaluate(() => { const g = (window as any).__game; g.game.feverActive = [false, true, false]; });
  await nudge(page);
  const t0 = Date.now();
  await page.waitForTimeout(700);
  expect(await heLen(page)).toBe(before);
  await expect.poll(() => heLen(page), { timeout: 3000 }).toBe(before + 1);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(950);
});

test('2. 中のカットイン (ツモ) は 1.4 秒の時点でまだ出ている', async ({ page }) => {
  await solo(page);
  await page.evaluate(() => (window as any).__gameStore.enqueueCutin('tsumo', 0));
  await expect(page.locator('.dr.fx-tsumo')).toBeVisible();
  await page.waitForTimeout(1400);
  expect(await page.locator('.dr.fx-tsumo').count()).toBe(1);
  await expect(page.locator('.dr')).toHaveCount(0, { timeout: 1500 });
});

test('3. フィーバー中、フィーバーでない人の一発のでかぽっちは絞りを出さない', async ({ page }) => {
  await solo(page);
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.game.feverActive = [false, true, false];
    g.game.lizhi.add(0);
    g.game.lastZimoInfo = { player: 0, pai: 'p1', pochi: 'green' };
    g.game.events.push({ type: 'zimo', player: 0, pai: 'p1' });
  });
  await nudge(page);
  await page.waitForTimeout(800);
  expect(await page.locator('.sq').count()).toBe(0);
});

test('3b. フィーバーでない時は、でかぽっちの絞りが出る (見張りが効いている事の確かめ)', async ({ page }) => {
  await solo(page);
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.game.lizhi.add(0);
    g.game.lastZimoInfo = { player: 0, pai: 'p1', pochi: 'green' };
    g.game.events.push({ type: 'zimo', player: 0, pai: 'p1' });
  });
  await nudge(page);
  await expect(page.locator('.sq')).toHaveCount(1, { timeout: 3000 });
});

for (const [w, h, name] of [[1280, 800, 'pc'], [844, 390, 'land'], [390, 844, 'port']] as Array<[number, number, string]>) {
  test(`4. 北抜きのボタンは手牌の上の帯のまま (「あなたの華」の欄には出さない): ${name}`, async ({ page }) => {
    await solo(page, w, h);
    await page.evaluate(() => {
      const g = (window as any).__game; const sp = g.game.shoupai.get(0);
      for (const s of ['m', 'p', 's']) for (let n = 1; n < sp._bingpai[s].length; n++) if (sp._bingpai[s][n] > 0) { sp._bingpai[s][n]--; sp._bingpai.z[4]++; return; }
    });
    await nudge(page);
    const btn = page.locator('.toolbar-red .nuki-btn');
    await expect(btn).toBeVisible();
    expect(await page.locator('.hua-panel .nuki-btn').count()).toBe(0);
    const r = await page.evaluate(() => {
      const b = (document.querySelector('.toolbar-red .nuki-btn') as HTMLElement).getBoundingClientRect();
      const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { hit: !!e && !!e.closest('.nuki-btn'), vw: innerWidth, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, vh: innerHeight };
    });
    expect(r.hit, JSON.stringify(r)).toBe(true);
    expect(r.sw).toBeLessThanOrEqual(r.vw + 1);
    expect(r.sh).toBeLessThanOrEqual(r.vh + 1);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/nuki_${name}.png` });
    const n0 = await page.evaluate(() => (window as any).__game.game.nukidora[0]);
    await btn.click();
    await expect.poll(() => page.evaluate(() => (window as any).__game.game.nukidora[0])).toBe(n0 + 1);
  });
}
