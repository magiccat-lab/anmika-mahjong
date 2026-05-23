// オンライン対戦 自動テスト [拡張版]
// 前提: server を ANMIKA_TEST_AUTH=1 で起動 [POST /auth/test/login が有効]
// 使い方: npx playwright test tests/online.spec.ts
//   ANMIKA_BASE_URL=http://127.0.0.1:8080 npx playwright test tests/online.spec.ts --headed
//
// test 1: 2 client + CPU 1 [配牌同期 + 1 打牌反映]
// test 2: 2 client + CPU 1 [多巡 desync 検出 = 両 view の game.state を直接 diff]
// test 3: 3 human client [cpu_count=0、 実 gameplay 同等の構成]
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

async function createRoomAs(host: Client, cpu_count: number): Promise<string> {
  await host.page.goto(BASE);
  await host.page.locator('button.entry-btn.online').click();
  await host.page.locator('select').waitFor({ state: 'visible', timeout: 8000 });
  await host.page.locator('select').first().selectOption(String(cpu_count));
  await host.page.locator('button.create, button:has-text("新しい部屋")').first().click();
  await host.page.waitForTimeout(2000);

  const roomList = await host.ctx.request.get(`${BASE}/api/rooms`);
  const rooms = await roomList.json();
  const arr = Array.isArray(rooms) ? rooms : (rooms?.rooms ?? []);
  const open = arr.find((r: any) => r.host_user_id === host.uid && r.status !== 'finished');
  if (!open) throw new Error('部屋が作成されてない');
  return open.room_id;
}

async function joinRoomAs(client: Client, room_id: string): Promise<void> {
  // API join → ?room=ID URL で auto-rejoin [share link と同じ経路]
  const r = await client.ctx.request.post(`${BASE}/api/rooms/${room_id}/join`, {});
  if (!r.ok()) throw new Error(`join failed: ${r.status()}`);
  await client.page.goto(`${BASE}/?room=${room_id}`);
  await client.page.waitForTimeout(2000);
}

async function startGame(host: Client): Promise<void> {
  await host.page.waitForTimeout(4000);  // RoomPanel polling 待ち
  const startBtn = host.page.locator('button:has-text("開始")').first();
  await expect(startBtn).toBeEnabled({ timeout: 15000 });
  await startBtn.click();
}

async function waitForGameReady(clients: Client[]): Promise<void> {
  for (const c of clients) {
    // 段階的 wait + dump: viewMode 遷移と onlineGameStarted 状態を確認
    try {
      await expect(c.page.locator('main.mode-single').first()).toBeVisible({ timeout: 15000 });
    } catch (e) {
      const dump = await c.page.evaluate(() => {
        const g = (window as any).__game;
        return {
          hasGame: !!g,
          hasState: !!g?.game?.state,
          finished: g?.game?.state?.finished,
          paishu: g?.game?.state?.paishu,
          mainClass: document.querySelector('main')?.className ?? 'no-main',
          sectionPlayerCount: document.querySelectorAll('section.player').length,
          bodyHTML: document.body.innerHTML.slice(0, 500),
        };
      }).catch(() => ({ err: 'evaluate failed' }));
      console.log(`[${c.name}] waitForGameReady dump:`, JSON.stringify(dump));
      throw e;
    }
    await expect(c.page.locator('section.player').first()).toBeVisible({ timeout: 15000 });
  }
}

// 各 client の window.__game.game.state から「全 client で一致するべき値」を抜く
// selfPlayer rotate に左右されない 「engine 真の state」 を見る [score / he / paishu / lunban / qijia]
async function snapshotEngineState(page: Page): Promise<any> {
  return page.evaluate(() => {
    const g = (window as any).__game;
    if (!g?.game?.state) return null;
    const s = g.game.state;
    return {
      qijia: s.qijia,
      lunban: s.lunban,
      paishu: s.paishu,
      score: Array.isArray(s.defen) ? [...s.defen] : (Array.isArray(s.scores) ? [...s.scores] : null),
      heCounts: [0, 1, 2].map((seat) => {
        const he = g.game.he?.get?.(seat);
        if (Array.isArray(he)) return he.length;
        if (Array.isArray(s.he?.[seat])) return s.he[seat].length;
        const sh = s.shoupais?.[seat]?.he;
        return Array.isArray(sh) ? sh.length : 0;
      }),
      fulouCounts: [0, 1, 2].map((seat) => {
        const fl = s.shoupais?.[seat]?.fulou;
        return Array.isArray(fl) ? fl.length : 0;
      }),
      finished: g.game.state.finished ?? false,
    };
  });
}

function diffSnapshots(snaps: Array<{ name: string; snap: any }>): string[] {
  const errs: string[] = [];
  if (snaps.length < 2) return errs;
  const ref = snaps[0];
  for (let i = 1; i < snaps.length; i++) {
    const cur = snaps[i];
    const fields = ['qijia', 'lunban', 'paishu', 'finished'];
    for (const f of fields) {
      if (JSON.stringify(ref.snap?.[f]) !== JSON.stringify(cur.snap?.[f])) {
        errs.push(`${f}: ${ref.name}=${JSON.stringify(ref.snap?.[f])} vs ${cur.name}=${JSON.stringify(cur.snap?.[f])}`);
      }
    }
    for (const f of ['score', 'heCounts', 'fulouCounts']) {
      if (JSON.stringify(ref.snap?.[f]) !== JSON.stringify(cur.snap?.[f])) {
        errs.push(`${f}: ${ref.name}=${JSON.stringify(ref.snap?.[f])} vs ${cur.name}=${JSON.stringify(cur.snap?.[f])}`);
      }
    }
  }
  return errs;
}

async function clickAnyTile(page: Page): Promise<boolean> {
  const tiles = page.locator('section.player button.tile-btn:not([disabled])');
  const n = await tiles.count();
  if (n === 0) return false;
  await tiles.first().click();
  await page.waitForTimeout(800);
  return true;
}

test.describe('online 対戦 e2e', () => {
  test.describe.configure({ mode: 'serial' });

  test('2 client + CPU1: 配牌同期 + 1 打牌が両 view に反映', async ({ browser }) => {
    test.setTimeout(120000);
    const ts = Date.now();
    const A = await spawnClient(browser, `t1A_${ts}`, 'PlayerA');
    const B = await spawnClient(browser, `t1B_${ts}`, 'PlayerB');
    try {
      const roomId = await createRoomAs(A, 1);
      await joinRoomAs(B, roomId);
      // B が入った後、 A 側 polling 反映待ち
      await A.page.waitForTimeout(4000);
      await startGame(A);
      await waitForGameReady([A, B]);

      const tilesA = await A.page.locator('section.player button.tile-btn').count();
      expect(tilesA).toBeGreaterThan(10);

      // 1 打牌、 turn が両 view で進んだか確認 [lunban が同じ値に進む]
      const before = await Promise.all([snapshotEngineState(A.page), snapshotEngineState(B.page)]);
      await clickAnyTile(A.page);
      await Promise.all([A.page.waitForTimeout(1500), B.page.waitForTimeout(1500)]);
      const after = await Promise.all([snapshotEngineState(A.page), snapshotEngineState(B.page)]);
      console.log('lunban before A=', before[0]?.lunban, 'B=', before[1]?.lunban, '→ after A=', after[0]?.lunban, 'B=', after[1]?.lunban);
      expect(after[0]?.lunban, 'A 視点で turn 進んでない').toBeGreaterThan(before[0]?.lunban ?? 0);
      expect(after[1]?.lunban, 'B 視点で turn 進んでない').toBeGreaterThan(before[1]?.lunban ?? 0);
      expect(after[0]?.lunban, 'A と B で lunban 不一致 [desync]').toBe(after[1]?.lunban);
    } finally {
      await A.ctx.close();
      await B.ctx.close();
    }
  });

  test('2 client + CPU1: 多巡 desync 検出 [両 view の game.state diff]', async ({ browser }) => {
    test.setTimeout(180000);
    const ts = Date.now();
    const A = await spawnClient(browser, `t2A_${ts}`, 'PA');
    const B = await spawnClient(browser, `t2B_${ts}`, 'PB');
    try {
      const roomId = await createRoomAs(A, 1);
      await joinRoomAs(B, roomId);
      await A.page.waitForTimeout(4000);
      await startGame(A);
      await waitForGameReady([A, B]);

      // 10 巡 ぐらい打って、 各 turn 後に snapshot diff
      const desyncs: string[] = [];
      for (let turn = 0; turn < 10; turn++) {
        // 自家牌 click できる方が click [どっちでも待つだけで CPU が進む]
        const aClicked = await clickAnyTile(A.page);
        if (!aClicked) await clickAnyTile(B.page);
        await Promise.all([A.page.waitForTimeout(1500), B.page.waitForTimeout(1500)]);

        const snapA = await snapshotEngineState(A.page);
        const snapB = await snapshotEngineState(B.page);
        const errs = diffSnapshots([
          { name: 'A', snap: snapA },
          { name: 'B', snap: snapB },
        ]);
        if (errs.length > 0) {
          desyncs.push(`turn ${turn}: ${errs.join(' | ')}`);
        }
        if (snapA?.finished || snapB?.finished) break;
      }
      console.log(`desync count: ${desyncs.length}`);
      desyncs.forEach((d) => console.log('  ', d));
      expect(desyncs, `desync 発生 ${desyncs.length} 件`).toEqual([]);
    } finally {
      await A.ctx.close();
      await B.ctx.close();
    }
  });

  test('dice-box visual sync: 非 winner 側で WS sync で物理動画発火', async ({ browser }) => {
    test.setTimeout(120000);
    const ts = Date.now();
    const A = await spawnClient(browser, `t4A_${ts}`, 'PA');
    const B = await spawnClient(browser, `t4B_${ts}`, 'PB');
    try {
      const roomId = await createRoomAs(A, 1);
      await joinRoomAs(B, roomId);
      await A.page.waitForTimeout(4000);
      await startGame(A);
      await waitForGameReady([A, B]);

      // 両 client に同じ pendingSaiKoro を inject [winner=0=A、 chances 1 件]
      // 実際の online flow では action sync で同期されるが、 ここでは modal 表示と sync 反応のみ test
      const inject = `
        window.__gameStore._testInjectSaiKoro({
          winner: 0,
          chances: [{ name: '三連刻', baseChip: 70, shuvariApplicable: true, count: 1, plusMinus: '+' }],
          rolls: [],
        });
      `;
      await A.page.evaluate(inject);
      await B.page.evaluate(inject);
      await Promise.all([A.page.waitForTimeout(800), B.page.waitForTimeout(800)]);

      // online モード viewMode='single' の時、 modal を開くには saiKoroOpened=true 必須
      // 通常は 「▶ サイコロへ」 button click 経由だが、 hule 経由でないと button のある panel が出ないので
      // test hook 経由で直接 saiKoroOpened を立てる
      await A.page.evaluate(() => (window as any).__setSaiKoroOpened(true));
      await B.page.evaluate(() => (window as any).__setSaiKoroOpened(true));
      await Promise.all([A.page.waitForTimeout(500), B.page.waitForTimeout(500)]);

      // 両 view で SaiKoroModal が render されてるか
      await expect(A.page.locator('.modal.sai').first()).toBeVisible({ timeout: 5000 });
      await expect(B.page.locator('.modal.sai').first()).toBeVisible({ timeout: 5000 });

      // dice-box init 待ち [babylon WebGL assets 読込で headless だと時間かかる、 button text が変わるまで polling]
      await expect(A.page.locator('.modal.sai button.roll-btn').first()).not.toHaveText(/準備中/, { timeout: 30000 });
      await expect(B.page.locator('.modal.sai button.roll-btn').first()).not.toHaveText(/準備中/, { timeout: 30000 });

      const aBtnText = await A.page.locator('.modal.sai button.roll-btn').first().textContent();
      const bBtnText = await B.page.locator('.modal.sai button.roll-btn').first().textContent();
      console.log('A roll-btn:', aBtnText, '/ B roll-btn:', bBtnText);
      expect(aBtnText, 'A 側 [winner] は 振る button').toMatch(/振る/);
      expect(bBtnText, 'B 側 [非 winner] は 振り待ち button').toMatch(/振り待ち/);

      // B 側で dice-box stage element が存在するか [dice-box が init されるための受け皿]
      await expect(B.page.locator('#dicebox-stage')).toHaveCount(1);

      // 両 client に同 roll を push [WS sync 模擬]、 B 側で displayD1/D2 が同値に反映されるか
      const pushRoll = `
        window.__gameStore._testPushSaiKoroRoll({ dice: [3, 5], hit: false, zoro: false });
      `;
      await A.page.evaluate(pushRoll);
      await B.page.evaluate(pushRoll);
      await Promise.all([A.page.waitForTimeout(1000), B.page.waitForTimeout(1000)]);

      // B 視点で 直近 roll の表示が [3, 5] になってるか
      const bRollText = await B.page.locator('.modal.sai .roll-result').first().textContent();
      console.log('B roll-result text:', bRollText);
      expect(bRollText, 'B 側 直近 roll text に [3, 5] 反映').toMatch(/3.*5|3,\s*5/);

      // --- 追加: REAL WS-sync flow [selectCombo + rollSaiKoroDice action] ---
      // A 側で selectSaiKoroCombo + rollSaiKoroDice を store 経由で呼ぶ。 WS で B に届いて
      // 両 client の pendingSaiKoro.rolls に同じ override 出目が積まれるはず
      await A.page.evaluate(() => {
        const s = (window as any).__gameStore;
        // chances[0] = 三連刻 [小=3, 大=5]、 selectSaiKoroCombo は (small, large)
        s.selectSaiKoroCombo(3, 5);
      });
      await Promise.all([A.page.waitForTimeout(800), B.page.waitForTimeout(800)]);
      await A.page.evaluate(() => {
        const s = (window as any).__gameStore;
        s.rollSaiKoroDice([2, 4]);  // override で hit=false 出目を強制
      });
      await Promise.all([A.page.waitForTimeout(1500), B.page.waitForTimeout(1500)]);

      const rollsA = await A.page.evaluate(() => (window as any).__game?.game ? (window as any).__game.game : null && undefined);
      const stateA = await A.page.evaluate(() => {
        const ps = (window as any).__gameStore;
        const sub: any = {};
        ps.subscribe((s: any) => Object.assign(sub, s))();
        return sub.pendingSaiKoro?.rolls ?? null;
      });
      const stateB = await B.page.evaluate(() => {
        const ps = (window as any).__gameStore;
        const sub: any = {};
        ps.subscribe((s: any) => Object.assign(sub, s))();
        return sub.pendingSaiKoro?.rolls ?? null;
      });
      console.log('WS-sync rolls: A=', JSON.stringify(stateA), 'B=', JSON.stringify(stateB));
      expect(stateA, 'A 側 rolls 配列存在').toBeTruthy();
      expect(stateB, 'B 側 rolls 配列存在').toBeTruthy();
      // 直前 _testPushSaiKoroRoll で 1 件積んでいるので、 real roll で 2 件目が両 side に乗る
      expect(stateA!.length, 'A rolls 件数 = 2').toBeGreaterThanOrEqual(2);
      expect(stateB!.length, 'B rolls 件数 = 2 [WS sync 成立]').toBeGreaterThanOrEqual(2);
      const lastA = stateA![stateA!.length - 1];
      const lastB = stateB![stateB!.length - 1];
      expect(lastA.dice, '直近 roll [A]').toEqual([2, 4]);
      expect(lastB.dice, '直近 roll [B、 WS sync で同値]').toEqual([2, 4]);
    } finally {
      await A.ctx.close();
      await B.ctx.close();
    }
  });

  test('3 human client [cpu_count=0]: start + 配牌同期', async ({ browser }) => {
    test.setTimeout(180000);
    const ts = Date.now();
    const A = await spawnClient(browser, `t3A_${ts}`, 'PA');
    const B = await spawnClient(browser, `t3B_${ts}`, 'PB');
    const C = await spawnClient(browser, `t3C_${ts}`, 'PC');
    try {
      const roomId = await createRoomAs(A, 0);
      await joinRoomAs(B, roomId);
      await joinRoomAs(C, roomId);
      await A.page.waitForTimeout(4000);
      await startGame(A);
      await waitForGameReady([A, B, C]);

      const snaps = await Promise.all([
        snapshotEngineState(A.page),
        snapshotEngineState(B.page),
        snapshotEngineState(C.page),
      ]);
      const errs = diffSnapshots([
        { name: 'A', snap: snaps[0] },
        { name: 'B', snap: snaps[1] },
        { name: 'C', snap: snaps[2] },
      ]);
      expect(errs, `初期 desync ${errs.length} 件`).toEqual([]);
    } finally {
      await A.ctx.close();
      await B.ctx.close();
      await C.ctx.close();
    }
  });
});
