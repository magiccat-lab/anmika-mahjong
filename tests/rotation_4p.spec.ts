// [2026-07-24 4人回し Phase6] 4人回し部屋の e2e [2 human + 2 CPU]
// 前提: server を ANMIKA_TEST_AUTH=1 で起動 [tools/run_online_e2e.mjs が担う]
// 検証: 部屋作成 [rotation flag] → 定員4 gate → 4人で自動開始 →
//       抜け番表示 [試合1は4人目=CPU3] + 部屋チップバー → 満室 join 拒否 → 盤面同期
import { test, expect, BrowserContext, Page } from '@playwright/test';

const BASE = process.env.ANMIKA_BASE_URL ?? 'https://anmika.magiccatlab.com';

async function fakeLogin(ctx: BrowserContext, user_id: string, username: string): Promise<void> {
  const r = await ctx.request.post(`${BASE}/auth/test/login`, {
    data: { user_id, username },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!r.ok()) throw new Error(`fakeLogin failed: ${r.status()} ${await r.text()}`);
}

interface Client {
  ctx: BrowserContext;
  page: Page;
  uid: string;
  name: string;
}

async function spawnClient(browser: any, uid: string, name: string): Promise<Client> {
  const ctx = await browser.newContext();
  await fakeLogin(ctx, uid, name);
  const page = await ctx.newPage();
  page.on('console', (m) => console.log(`[${name}]`, m.text()));
  return { ctx, page, uid, name };
}

async function createRotationRoom(host: Client, cpu_count: number): Promise<string> {
  await host.page.goto(BASE);
  await host.page.locator('button.entry-btn.online').click();
  await host.page.locator('select.sel-cpu-count').waitFor({ state: 'visible', timeout: 8000 });
  await host.page.locator('select.sel-cpu-count').selectOption(String(cpu_count));
  await host.page.locator('input.chk-rotation').check();
  await host.page.locator('button.create, button:has-text("新しい部屋")').first().click();
  await host.page.waitForTimeout(2000);
  const roomList = await host.ctx.request.get(`${BASE}/api/rooms`);
  const rooms = await roomList.json();
  const arr = Array.isArray(rooms) ? rooms : (rooms?.rooms ?? []);
  const open = arr.find((r: any) => r.host_user_id === host.uid && r.status !== 'finished');
  if (!open) throw new Error('部屋が作成されてない');
  expect(open.rotation_enabled, 'rooms 一覧に rotation flag が出る').toBeTruthy();
  return open.room_id;
}

async function joinRoomAs(client: Client, room_id: string): Promise<void> {
  const r = await client.ctx.request.post(`${BASE}/api/rooms/${room_id}/join`, {});
  if (!r.ok()) throw new Error(`join failed: ${r.status()}`);
  await client.page.goto(`${BASE}/?room=${room_id}`);
  await client.page.waitForTimeout(2000);
}

test.describe('4人回し部屋', () => {
  test('作成→4人自動開始→抜け番/部屋チップ表示→満室拒否→盤面同期', async ({ browser }) => {
    test.setTimeout(180_000);
    const host = await spawnClient(browser, 'rot-host', 'ロテホスト');
    const friend = await spawnClient(browser, 'rot-friend', 'ロテフレンド');
    const third = await spawnClient(browser, 'rot-third', 'ロテ余り');

    // host + CPU2 [CPU は seat 3,2 に入る] = 3人。rotation 部屋は 4 人揃うまで開始しない
    const roomId = await createRotationRoom(host, 2);

    // friend join [seat 1] → 4 人で host が開始
    await joinRoomAs(friend, roomId);
    await host.page.goto(`${BASE}/?room=${roomId}`);
    await host.page.waitForTimeout(4000);
    const startBtn = host.page.locator('button:has-text("開始")').first();
    await expect(startBtn).toBeEnabled({ timeout: 15000 });

    // 満室: 5人目 [3人目の human] は 400 room full
    const fifth = await third.ctx.request.post(`${BASE}/api/rooms/${roomId}/join`, {});
    expect(fifth.status(), '定員4の rotation 部屋は5人目を拒否').toBe(400);

    await startBtn.click();

    // 両 human が対局画面へ [試合1の active は room 0/1/2 = host/friend/CPU2]
    for (const c of [host, friend]) {
      await expect(c.page.locator('main.mode-single').first()).toBeVisible({ timeout: 20000 });
      await expect(c.page.locator('section.player').first()).toBeVisible({ timeout: 15000 });
      // 人間2人はどちらも active [抜け番バナーが出ない]
      await expect(c.page.locator('.spectator-banner.rotation-inactive')).toHaveCount(0);
      // 部屋チップバー: 4 entry、抜け番 [試合1 = 4人目 = CPU3] に 😴
      const bar = c.page.locator('.rotation-chip-bar');
      await expect(bar).toBeVisible({ timeout: 15000 });
      await expect(bar.locator('.rc-entry')).toHaveCount(4);
      const inactive = bar.locator('.rc-entry.rc-inactive');
      await expect(inactive).toHaveCount(1);
      await expect(inactive).toContainText('CPU3');
    }

    // 盤面同期 smoke: 両 client の engine state が一致 [selfPlayer 回転に依らない値]
    const snap = async (page: Page) => page.evaluate(() => {
      const g = (window as any).__game;
      if (!g?.game?.state) return null;
      return { qijia: g.game.state.qijia, paishu: g.game.state.paishu, lunban: g.game.state.lunban };
    });
    await host.page.waitForTimeout(3000);
    const [hs, fs] = [await snap(host.page), await snap(friend.page)];
    expect(hs, 'host に engine state がある').not.toBeNull();
    expect(JSON.stringify(hs)).toBe(JSON.stringify(fs));

    await host.ctx.close();
    await friend.ctx.close();
    await third.ctx.close();
  });

  test('test control seam は通常起動の ws では 404 [Sol指定 negative]', async () => {
    const internalBase = process.env.ANMIKA_E2E_WS_INTERNAL;
    const internalSecret = process.env.ANMIKA_E2E_INTERNAL_SECRET;
    test.skip(!internalBase || !internalSecret, 'runner 経由でのみ検証 [internal 情報が無い]');
    // 正しい secret を添えても、testControlsEnabled でない本番相当起動では endpoint 自体が無い
    const r = await fetch(`${internalBase}/internal/test/force-finish-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-anmika-internal-secret': internalSecret! },
      body: JSON.stringify({ room_id: 'NOPE' }),
    });
    expect(r.status).toBe(404);
  });

  test('通常3人部屋は rotation flag 無しで従来どおり [後方互換]', async ({ browser }) => {
    test.setTimeout(120_000);
    const host = await spawnClient(browser, 'rot-plain', 'ロテ無し');
    await host.page.goto(BASE);
    await host.page.locator('button.entry-btn.online').click();
    await host.page.locator('select.sel-cpu-count').waitFor({ state: 'visible', timeout: 8000 });
    await host.page.locator('select.sel-cpu-count').selectOption('2');
    // checkbox は触らない
    await host.page.locator('button.create, button:has-text("新しい部屋")').first().click();
    await host.page.waitForTimeout(2000);
    const roomList = await host.ctx.request.get(`${BASE}/api/rooms`);
    const arr = await roomList.json();
    const rooms = Array.isArray(arr) ? arr : (arr?.rooms ?? []);
    const open = rooms.find((r: any) => r.host_user_id === 'rot-plain' && r.status !== 'finished');
    expect(open).toBeTruthy();
    expect(open.rotation_enabled, '3人部屋は rotation off').toBeFalsy();
    // 3人 [host+CPU2] で即開始できる
    await host.page.goto(`${BASE}/?room=${open.room_id}`);
    await host.page.waitForTimeout(4000);
    const startBtn = host.page.locator('button:has-text("開始")').first();
    await expect(startBtn).toBeEnabled({ timeout: 15000 });
    await startBtn.click();
    await expect(host.page.locator('main.mode-single').first()).toBeVisible({ timeout: 20000 });
    // rotation UI は出ない
    await expect(host.page.locator('.rotation-chip-bar')).toHaveCount(0);
    await host.ctx.close();
  });
});
