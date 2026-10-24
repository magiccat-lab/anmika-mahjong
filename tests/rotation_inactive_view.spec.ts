// [2026-10-24 リョー「抜け番は観戦と同じものが見れるように」「部屋チップって表示も消せるようにして」
//  「途中で誰か抜けて3人打ちもできるようにして」] 4 人とも人の 4 人回し部屋で
//  抜け番の盤面 [全員の手牌を表 ・ 卓の辺の手牌] ・ 部屋チップの × ・ 抜け番が抜けた後の部屋を見る
// 前提: server を ANMIKA_TEST_AUTH=1 で起動 [tools/run_online_e2e.mjs が担う]
import { test, expect, BrowserContext, Page } from '@playwright/test';

const BASE = process.env.ANMIKA_BASE_URL ?? 'http://127.0.0.1:18990';
const SHOTS = process.env.ANMIKA_E2E_SHOTS ?? '';

async function fakeLogin(ctx: BrowserContext, user_id: string, username: string): Promise<void> {
  const r = await ctx.request.post(`${BASE}/auth/test/login`, {
    data: { user_id, username },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!r.ok()) throw new Error(`fakeLogin failed: ${r.status()} ${await r.text()}`);
}

interface Client { ctx: BrowserContext; page: Page; uid: string; name: string }

async function spawnClient(browser: any, uid: string, name: string): Promise<Client> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakeLogin(ctx, uid, name);
  const page = await ctx.newPage();
  return { ctx, page, uid, name };
}

test('4人回し: 抜け番は観戦と同じ盤面、部屋チップは × で隠せる、抜け番が抜けても卓は続く', async ({ browser }) => {
  test.setTimeout(180_000);
  const host = await spawnClient(browser, 'inv-host', 'イナホスト');
  const p1 = await spawnClient(browser, 'inv-p1', 'イナ壱');
  const p2 = await spawnClient(browser, 'inv-p2', 'イナ弐');
  const bench = await spawnClient(browser, 'inv-p3', 'イナ参');

  await host.page.goto(BASE);
  await host.page.locator('button.entry-btn.online').click();
  await host.page.locator('select.sel-cpu-count').waitFor({ state: 'visible', timeout: 8000 });
  await host.page.locator('select.sel-cpu-count').selectOption('0');
  await host.page.locator('input.chk-rotation').check();
  await host.page.locator('button.create, button:has-text("新しい部屋")').first().click();
  await host.page.waitForTimeout(2000);
  const rooms = await (await host.ctx.request.get(`${BASE}/api/rooms`)).json();
  const arr = Array.isArray(rooms) ? rooms : (rooms?.rooms ?? []);
  const roomId = arr.find((r: any) => r.host_user_id === host.uid && r.status !== 'finished')?.room_id;
  expect(roomId, '部屋ができる').toBeTruthy();

  // 入った順に room seat 1,2,3。試合 1 の抜け番は 4 人目 [seat 3 = イナ参]
  for (const c of [p1, p2, bench]) {
    const r = await c.ctx.request.post(`${BASE}/api/rooms/${roomId}/join`, {});
    expect(r.ok(), `${c.name} が入れる`).toBeTruthy();
    await c.page.goto(`${BASE}/?room=${roomId}`);
  }
  await host.page.goto(`${BASE}/?room=${roomId}`);
  const startBtn = host.page.locator('button:has-text("開始")').first();
  await expect(startBtn).toBeEnabled({ timeout: 20000 });
  await startBtn.click();

  for (const c of [host, p1, p2, bench]) {
    await expect(c.page.locator('main.mode-single').first()).toBeVisible({ timeout: 20000 });
  }
  const bp = bench.page;
  await expect(bp.locator('.spectator-banner.rotation-inactive')).toBeVisible({ timeout: 15000 });
  // 観戦と同じ盤面: main.spectating と、卓の左右の辺に上家 ・ 下家の手牌
  await expect(bp.locator('main.spectating')).toHaveCount(1);
  await expect(host.page.locator('main.spectating')).toHaveCount(0);
  await bp.waitForTimeout(3000);
  const wallView = (page: Page) => page.evaluate(() => ({
    tiles: document.querySelectorAll('.wall-hand .wall-tile').length,
    backs: document.querySelectorAll('.wall-hand .wall-back').length,
  }));
  const benchView = await wallView(bp);
  if (SHOTS) await bp.screenshot({ path: `${SHOTS}/bench_view.png` });
  expect(benchView.tiles, '卓の左右の辺に手牌が出る').toBeGreaterThanOrEqual(26);
  expect(benchView.backs, '上家 ・ 下家の手牌は表').toBe(0);
  // 打ち手の画面には卓の辺の手牌が出ない [抜け番の変更が打ち手に漏れない]
  expect((await wallView(host.page)).tiles).toBe(0);
  if (SHOTS) await host.page.screenshot({ path: `${SHOTS}/host_view.png` });

  // 部屋チップの × で帯が消え、設定に残る
  const bar = bp.locator('.rotation-chip-bar');
  await expect(bar).toBeVisible({ timeout: 10000 });
  await bar.locator('.rc-hide').click();
  await expect(bp.locator('.rotation-chip-bar')).toHaveCount(0);
  const saved = await bp.evaluate(() => JSON.parse(localStorage.getItem('anmika.prefs.v1') ?? '{}').hideRoomChip);
  expect(saved).toBe(true);
  // 他の人の帯はそのまま
  await expect(host.page.locator('.rotation-chip-bar')).toBeVisible();

  // 抜け番が部屋を抜ける。打ち手 3 人の卓は止まらず、帯から抜けた人が消える
  const left = await bench.ctx.request.post(`${BASE}/api/rooms/${roomId}/leave`, {});
  expect(left.ok()).toBeTruthy();
  await host.page.waitForTimeout(3000);
  await expect(host.page.locator('.rotation-chip-bar .rc-entry')).toHaveCount(3, { timeout: 10000 });
  await expect(host.page.locator('section.player').first()).toBeVisible();

  for (const c of [host, p1, p2, bench]) await c.ctx.close();
});
