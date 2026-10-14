// [2026-10-15 リョー「勝負終了ボタンをハンチャン終了時に用意しないと終えられない」] 試合の終わりの「勝負終了」で部屋が閉じ、両方ロビーへ
import { test, expect, BrowserContext } from '@playwright/test';
const BASE = 'http://127.0.0.1:18990';
async function fakeLogin(ctx: BrowserContext, user_id: string, username: string) {
  const r = await ctx.request.post(`${BASE}/auth/test/login`, { data: { user_id, username }, headers: { 'Content-Type': 'application/json' } });
  if (!r.ok()) throw new Error(`fakeLogin failed: ${r.status()}`);
}
test('勝負終了: ホストでない人が押しても部屋が閉じ、両方ロビーへ', async ({ browser }) => {
  test.setTimeout(120_000);
  const mk = async (uid: string, name: string) => { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await fakeLogin(ctx, uid, name); return { ctx, page: await ctx.newPage(), uid }; };
  const A = await mk('fa', 'あきら'); const B = await mk('fb', 'ぶん');
  await A.page.goto(BASE);
  await A.page.locator('button.entry-btn.online').click();
  await A.page.locator('select.sel-cpu-count').waitFor({ state: 'visible', timeout: 8000 });
  await A.page.locator('select.sel-cpu-count').selectOption('1');
  await A.page.locator('button.create, button:has-text("新しい部屋")').first().click();
  await A.page.waitForTimeout(2000);
  const rooms = await (await A.ctx.request.get(`${BASE}/api/rooms`)).json();
  const arr = Array.isArray(rooms) ? rooms : (rooms?.rooms ?? []);
  const room = arr.find((r: any) => r.host_user_id === A.uid && r.status !== 'finished');
  expect((await B.ctx.request.post(`${BASE}/api/rooms/${room.room_id}/join`, {})).ok()).toBe(true);
  await B.page.goto(`${BASE}/?room=${room.room_id}`);
  await B.page.waitForTimeout(2000);
  await A.page.waitForTimeout(3000);
  await A.page.locator('button:has-text("開始")').first().click();
  for (const c of [A, B]) await expect(c.page.locator('section.player').first()).toBeVisible({ timeout: 20000 });
  await B.page.waitForTimeout(1500);
  // B の画面だけ試合の終わりの形にして (表示の確かめ)、ボタン → 確認 → 終える
  await B.page.evaluate(() => { const g = (window as any).__game; g.game.state.finished = true; g.roundEnded = true; (window as any).__gameStore.setCpuSeats(Object.entries(g.cpu ?? {}).filter(([, v]) => v).map(([k]) => Number(k))); });
  const btn = B.page.locator('.finish-room-btn:visible').first();
  await expect(btn).toBeVisible({ timeout: 5000 });
  await btn.click();
  await expect(B.page.locator('#finish-confirm-title')).toHaveText('勝負を終える？');
  await B.page.locator('.leave-confirm-yes').click();
  // 両方とも卓から外れる (B は押した側、A は 4404 で)
  await expect(B.page.locator('section.player')).toHaveCount(0, { timeout: 8000 });
  await expect(A.page.locator('section.player')).toHaveCount(0, { timeout: 8000 });
  const after = await (await A.ctx.request.get(`${BASE}/api/rooms`)).json();
  const list = Array.isArray(after) ? after : (after?.rooms ?? []);
  const r2 = list.find((r: any) => r.room_id === room.room_id);
  console.log('room after', JSON.stringify(r2 ?? null));
  expect(!r2 || r2.status === 'archived').toBe(true);
  await A.page.screenshot({ path: `${process.env.SHOT_DIR ?? '/tmp'}/finish_A.png` });
});
test('勝負終了: 席に居ない人は閉じられない', async ({ browser }) => {
  const ctx = await browser.newContext(); await fakeLogin(ctx, 'fx', 'よそ');
  const A = await browser.newContext(); await fakeLogin(A, 'fh', 'ほすと');
  const page = await A.newPage(); await page.goto(BASE);
  await page.locator('button.entry-btn.online').click();
  await page.locator('select.sel-cpu-count').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('button.create, button:has-text("新しい部屋")').first().click();
  await page.waitForTimeout(1500);
  const rooms = await (await A.request.get(`${BASE}/api/rooms`)).json();
  const arr = Array.isArray(rooms) ? rooms : (rooms?.rooms ?? []);
  const room = arr.find((r: any) => r.host_user_id === 'fh');
  const r = await ctx.request.post(`${BASE}/api/rooms/${room.room_id}/finish`, {});
  expect(r.status()).toBe(403);
});
