// [2026-10-15 リョー「何かツモボタン押してもつもれなくてリロードしたらつ漏れる感じだった」] 断られた手の後に画面が resync を送る事と、サーバに断った記録が残る事 (隔離スタック 18990、ANMIKA_STACK_WS_LOG に ws のログ)
import { test, expect, BrowserContext, Page } from '@playwright/test';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:18990';
async function fakeLogin(ctx: BrowserContext, user_id: string, username: string) {
  const r = await ctx.request.post(`${BASE}/auth/test/login`, { data: { user_id, username }, headers: { 'Content-Type': 'application/json' } });
  if (!r.ok()) throw new Error(`fakeLogin failed: ${r.status()}`);
}
test('reject → resync', async ({ browser }) => {
  test.setTimeout(120_000);
  const mk = async (uid: string, name: string) => { const ctx = await browser.newContext({ viewport: { width: 915, height: 412 } }); await fakeLogin(ctx, uid, name); return { ctx, page: await ctx.newPage(), uid }; };
  const A = await mk('ra', 'あきら'); const B = await mk('rb', 'ぶん');
  const sent: Record<string, string[]> = { A: [], B: [] };
  const recv: Record<string, string[]> = { A: [], B: [] };
  for (const [k, c] of [['A', A], ['B', B]] as const) {
    c.page.on('websocket', (ws) => {
      ws.on('framesent', (f) => { try { const m = JSON.parse(String(f.payload)); sent[k].push(m.type + (m.action ? ':' + m.action.type : '')); } catch {} });
      ws.on('framereceived', (f) => { try { const m = JSON.parse(String(f.payload)); recv[k].push(m.type + (m.reason ? ':' + m.reason : '')); } catch {} });
    });
  }
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
  await expect(A.page.locator('button:has-text("開始")').first()).toBeEnabled({ timeout: 15000 });
  await A.page.locator('button:has-text("開始")').first().click();
  for (const c of [A, B]) await expect(c.page.locator('section.player').first()).toBeVisible({ timeout: 20000 });
  await A.page.waitForTimeout(2500);
  // 手番の人の画面から、和了れないのにツモを送る (画面の検査は手番だけなので送られ、サーバが断る)
  let who = '';
  for (const [k, c] of [['A', A], ['B', B]] as const) {
    const mine = await c.page.evaluate(() => { const g = (window as any).__game; const cur = g.game.lunbanToPlayerId(g.game.state.lunban); const s = String(g.game.shoupai.get(cur)?.toString?.() ?? ''); return !!s && !s.includes('_') && !g.game.canTsumo(cur); });
    if (mine) { who = k; const before = recv[k].length; const sBefore = sent[k].length;
      await c.page.evaluate(() => (window as any).__gameStore.tsumo());
      await c.page.waitForTimeout(2500);
      console.log(k, 'sent after', sent[k].slice(sBefore), 'recv after', recv[k].slice(before).filter((t) => !t.startsWith('pochiFx')).slice(0, 8));
      expect(sent[k].slice(sBefore)).toContain('action:tsumo');
      expect(recv[k].slice(before).some((t) => t.startsWith('reject'))).toBe(true);
      expect(sent[k].slice(sBefore)).toContain('resync');
      break; }
  }
  expect(who).not.toBe('');
  const log = fs.readFileSync(process.env.ANMIKA_STACK_WS_LOG ?? 'stack/ws.log', 'utf-8');
  const line = log.split('\n').filter((l) => l.includes('[anmika-ws] reject')).pop();
  console.log('LOG', line);
  expect(line ?? '').toContain('action=tsumo');
});
