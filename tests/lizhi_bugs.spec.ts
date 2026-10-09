// lizhi 関連 bug 自走検査 [yuma 2026-05-14]
//   bug 1: リーチ button 非自家側で表示されない事 [toolbar self filter]
//   bug 2: 河で `_` 付き tile が 1 件のみ [複数 `_` でも UI 上 1 件しか rotate されない]
// [2026-10-09 R3] 上の 2 本は実際にはリーチを押さず [online 側は他家にボタンが無い事を見るだけ、
// 「厳密」側は solo で state を直接書き換える]、リーチが通らなくなっても落ちなかった。
// 最後の describe が online の実物で宣言する [固定の山 + 本人がリーチ → 宣言牌を切る → サーバー確定の確認]。
import { test, expect, BrowserContext, Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.ANMIKA_BASE_URL ?? 'http://127.0.0.1:18990';
const HAS_SERVER_AUTH = process.env.ANMIKA_E2E_SERVER_AUTH === '1';
const serverAuthTest = HAS_SERVER_AUTH ? test : test.skip;

async function fakeLogin(ctx: BrowserContext, user_id: string, username: string) {
  const r = await ctx.request.post(`${BASE}/auth/test/login`, {
    data: { user_id, username }, headers: { 'Content-Type': 'application/json' },
  });
  if (!r.ok()) throw new Error(`fakeLogin failed: ${r.status()} ${await r.text()}`);
}

serverAuthTest('bug 1 + 2 自走検査: lizhi button self filter + 河 lizhi-tile 1 件のみ', async ({ browser }) => {
  test.setTimeout(120000);
  const ts = Date.now();
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await fakeLogin(ctxA, `lzA_${ts}`, 'PA');
  await fakeLogin(ctxB, `lzB_${ts}`, 'PB');
  const pA = await ctxA.newPage();
  const pB = await ctxB.newPage();
  try {
    await pA.goto(BASE);
    await pB.goto(BASE);
    await pA.locator('button.entry-btn.online').click();
    await pB.locator('button.entry-btn.online').click();
    // [2026-07-23] 形式 select 追加で select が 2 個になった。CPU 数は class 指定
    await pA.locator('select.sel-cpu-count').waitFor({ state: 'visible', timeout: 8000 });
    await pA.locator('select.sel-cpu-count').selectOption('1');
    await pA.locator('button.create, button:has-text("新しい部屋")').first().click();
    await pA.waitForTimeout(2000);
    const rooms = await ctxA.request.get(`${BASE}/api/rooms`).then((r) => r.json());
    const arr = Array.isArray(rooms) ? rooms : (rooms?.rooms ?? []);
    const open = arr.find((r: any) => r.host_user_id === `lzA_${ts}`);
    expect(open).toBeTruthy();
    const roomId = open.room_id;
    await ctxB.request.post(`${BASE}/api/rooms/${roomId}/join`, {});
    await pB.goto(`${BASE}/?room=${roomId}`);
    await pB.waitForTimeout(4000);
    await pA.waitForTimeout(4000);
    await pA.locator('button:has-text("開始")').first().click();
    await Promise.all([pA.waitForTimeout(15000), pB.waitForTimeout(15000)]);
    await expect(pA.locator('section.player').first()).toBeVisible({ timeout: 20000 });
    await expect(pB.locator('section.player').first()).toBeVisible({ timeout: 20000 });

    // === bug 1 verify ===
    // pA は seat 0、 currentPlayer も初期 lunban=0 で 0
    // この時 pA から見て リーチ button は [canLizhi で出る条件があれば] 表示される
    // pB は seat 1 = selfPlayer=1、 currentPlayer=0 で 自分の手番じゃない → リーチ button 表示されない事
    // [canLizhi が true でも、 toolbar の currentPlayer===selfPlayer filter で 非表示]
    const aLizhiCount = await pA.locator('button.lizhi-choice').count();
    const bLizhiCount = await pB.locator('button.lizhi-choice').count();
    console.log(`[bug1] pA lizhi-btn count=${aLizhiCount}, pB count=${bLizhiCount}`);
    // pB は currentPlayer != selfPlayer なので リーチ button 出ない
    expect(bLizhiCount, 'bug1: pB [非自家] にリーチ button 出てる').toBe(0);

    // === bug 2 verify: 河の lizhi-tile class が 0-1 件のみ ===
    // 試合進行: 数回 dapai して、 lizhi-tile class が複数つかない事を確認
    // state inject で河に複数 `_` 付き tile を強制注入 [defensive fix 動作確認]
    await pA.evaluate(() => {
      const g = (window as any).__gameStore;
      if (!g) return;
      // 強制的に複数 `_` を he に注入
    });
    // 既存 he から count 取得
    const lizhiTileCountA = await pA.locator('.hez-tile.lizhi-tile, .he-tile.lizhi-tile').count();
    const lizhiTileCountB = await pB.locator('.hez-tile.lizhi-tile, .he-tile.lizhi-tile').count();
    console.log(`[bug2] pA lizhi-tile count=${lizhiTileCountA}, pB=${lizhiTileCountB}`);
    // 開始直後はリーチ宣言 0 件 → lizhi-tile も 0 件
    expect(lizhiTileCountA, 'bug2: pA 河に lizhi-tile 複数').toBeLessThanOrEqual(1);
    expect(lizhiTileCountB, 'bug2: pB 河に lizhi-tile 複数').toBeLessThanOrEqual(1);

    // 直接 he._pai を複数 `_` 付きに mutate して、 UI が 1 件のみ lizhi-tile で render する事 verify
    await pA.evaluate(() => {
      const g = (window as any).__game;
      if (!g) return;
      const he0 = g.game.he.get(0);
      if (!he0 || !he0._pai) return;
      // 既存 河 tile すべてに `_` を付ける [異常 state を強制]
      he0._pai = he0._pai.map((p: string) => p.endsWith('_') ? p : (p + '_'));
      // 強制 reactive trigger
      (window as any).__gameStore.toggleCpu(2);  // 適当な action で reactive 更新
      (window as any).__gameStore.toggleCpu(2);
    });
    await pA.waitForTimeout(1000);
    const lizhiTileAfter = await pA.locator('.hez-tile.lizhi-tile, .he-tile.lizhi-tile').count();
    console.log(`[bug2-defense] 全 _ 付与後 lizhi-tile count=${lizhiTileAfter}`);
    expect(lizhiTileAfter, 'bug2 defensive: 異常 state でも lizhi-tile は 1 件以下').toBeLessThanOrEqual(1);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('bug 2 厳密検証: lizhi 宣言→多回 dapai で 河 _ は 1 件のみ [リョー指示 自走 test]', async ({ browser }) => {
  test.setTimeout(120000);
  const ctxA = await browser.newContext();
  const pA = await ctxA.newPage();
  try {
    // single mode で localhost build を使う [online 不要、 単純検証]
    await pA.goto(BASE);
    page: {
      const m = pA.locator('button.entry-btn.solo');
      await m.waitFor({ state: 'visible', timeout: 10000 });
      await m.click();
    }
    await pA.waitForTimeout(2000);

    // P0 を強制テンパイ手にして lizhi → dapai 5 回 simulate
    // 直接 game.state を mutate + lizhiDeclareDapai flag を 1 回だけ立てて 5 回 dapai
    const result = await pA.evaluate(() => {
      const g = (window as any).__game;
      const store = (window as any).__gameStore;
      if (!g || !store) return { err: 'no game' };

      // P0 の他河 + bingpai 強制 set
      const sp0 = g.game.shoupai.get(0);
      if (!sp0) return { err: 'no sp0' };
      // 13 牌 構成 [m7m7m7m9m9m9 p1p2p3 p7p7p7 z1] = 13、 zimo 1 牌
      sp0._bingpai = {
        _: 0,
        m: [0, 0, 0, 0, 0, 0, 0, 3, 0, 3],
        p: [0, 1, 1, 1, 0, 0, 0, 3, 0, 0],
        s: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        z: [0, 1, 0, 0, 0, 0, 0, 0],
      };
      sp0._zimo = 'p4';
      // lizhi flag 立てて、 dapai
      g.game.lizhi.add(0);
      g.game.lizhiDeclareDapai[0] = true;
      g.game.state.lunban = 0;
      // ツモ切り: bingpai に zimo を 1 枚 加えてから dapai [Majiang Shoupai 仕様]
      sp0._bingpai.p[4] = (sp0._bingpai.p[4] ?? 0) + 1;
      try {
        g.game.dapai('p4_');
      } catch (e1) {
        try { g.game.dapai('p4'); } catch (e2) { return { err: 'dapai p4 fail: ' + String(e2) }; }
      }
      // 続けて dapai 5 回 [自家順だけに戻す + zimo + dapai]
      for (let i = 0; i < 5; i++) {
        g.game.state.lunban = 0;
        sp0._zimo = null;
        try {
          const z = g.game.zimo();
          if (!z) break;
          g.game.dapai(g.game.shoupai.get(0)?._zimo + '_');
        } catch (e) { /* zimo cant 等 break */ break; }
      }
      const he0 = g.game.he.get(0)._pai;
      // lizhi marker は `__` [2 連続]、 ツモ切り `_` は別 [bug 2 fix 2026-05-14]
      const lizhiCount = he0.filter((t: string) => t.endsWith('__')).length;
      return { he: he0, lizhiCount };
    });
    console.log('[bug2-strict]', JSON.stringify(result));
    expect(result.err, `simulate fail: ${result.err}`).toBeUndefined();
    expect(result.lizhiCount, `bug2: 多巡 dapai 後 河の \`_\` 数: ${result.lizhiCount}`).toBe(1);

    // UI rendering でも lizhi-tile 1 件のみか
    await pA.waitForTimeout(500);
    const uiCount = await pA.locator('.hez-tile.lizhi-tile, .he-tile.lizhi-tile').count();
    console.log(`[bug2-strict] UI lizhi-tile count=${uiCount}`);
    expect(uiCount, 'bug2: UI 上 lizhi-tile も 1 件').toBeLessThanOrEqual(1);
  } finally {
    await ctxA.close();
  }
});

// ---------------------------------------------------------------------------
// 実際にリーチを宣言する online e2e [2026-10-09 R3]
// 固定の山 [tests/fixtures/lizhi_pool.json: 親が配牌直後にリーチできる山。作り直しは
// tools/find_lizhi_pool.mts] を test-only の set-pool control seam で渡し、host 1 人 + CPU 2 で回す。
// control seam は testControlsEnabled の harness entry だけに生える [通常起動は 404]ので、
// runner の共通 stack ではなく専用の stack [api 18894 / ws 18895 / ws internal 18896] を自前で張る。
// ---------------------------------------------------------------------------
const ROOT = process.cwd();
const L_API_PORT = 18894;
const L_WS_PORT = 18895;
const L_WS_INTERNAL_PORT = 18896;
const L_BASE = `http://127.0.0.1:${L_API_PORT}`;
const L_SECRET = 'anmika-lizhi-online-secret';
const L_TMP = path.join(ROOT, '.tmp', 'lizhi-online');
const L_ENV = {
  ...process.env,
  ANMIKA_TEST_AUTH: '1',
  ANMIKA_REQUIRE_SECRET: '0',
  ANMIKA_SESSION_SECRET: L_SECRET,
  ANMIKA_WS_SECRET: L_SECRET,
  ANMIKA_INTERNAL_SECRET: L_SECRET,
  ANMIKA_PUBLIC_BASE_URL: L_BASE,
  ANMIKA_WS_PUBLIC_URL: `ws://127.0.0.1:${L_WS_PORT}`,
  ANMIKA_API_BASE: L_BASE,
  ANMIKA_WS_PORT: String(L_WS_PORT),
  ANMIKA_WS_INTERNAL_PORT: String(L_WS_INTERNAL_PORT),
  ANMIKA_WS_INTERNAL_BASE: `http://127.0.0.1:${L_WS_INTERNAL_PORT}`,
  ANMIKA_WS_LOG: '0',
};

async function waitHttp(url: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch { /* boot 中 */ }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

test.describe('リーチ宣言 [online 実物・固定の山]', () => {
  let apiProc: ChildProcess | null = null;
  let wsProc: ChildProcess | null = null;

  test.beforeAll(async () => {
    rmSync(L_TMP, { recursive: true, force: true });
    mkdirSync(L_TMP, { recursive: true });
    // api と ws は別々の sqlite を使う [同じファイルだと起動時に database is locked になる]
    wsProc = spawn(process.execPath, ['--import', 'tsx', 'server/ws_server_test_harness.ts'], {
      cwd: ROOT, env: { ...L_ENV, ANMIKA_DB_PATH: path.join(L_TMP, 'ws.sqlite3') }, stdio: 'ignore',
    });
    apiProc = spawn(
      process.env.PYTHON ?? path.join(ROOT, '.venv', 'bin', 'python3'),
      ['-m', 'uvicorn', 'server.app:app', '--host', '127.0.0.1', '--port', String(L_API_PORT)],
      { cwd: ROOT, env: { ...L_ENV, ANMIKA_DB_PATH: path.join(L_TMP, 'api.sqlite3') }, stdio: 'ignore' },
    );
    await waitHttp(`${L_BASE}/api/rooms`);
  });

  test.afterAll(async () => {
    // 停止は自前 child の PID 限定
    for (const proc of [apiProc, wsProc]) {
      if (proc && !proc.killed) proc.kill('SIGTERM');
    }
    rmSync(L_TMP, { recursive: true, force: true });
  });

  test('親が配牌直後に通常リーチ → 宣言牌を切ると、サーバー確定のリーチが画面に出る', async ({ browser }) => {
    test.setTimeout(120000);
    const pool = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'lizhi_pool.json'), 'utf8')) as string[];
    const ctx = await browser.newContext();
    try {
      const uid = `lzReal_${Date.now()}`;
      const login = await ctx.request.post(`${L_BASE}/auth/test/login`, { data: { user_id: uid, username: 'リーチ検証' } });
      expect(login.ok(), `login ${login.status()}`).toBeTruthy();
      const create = await ctx.request.post(`${L_BASE}/api/rooms`, { data: { cpu_count: 2, match_mode: 'tonpu' } });
      expect(create.ok(), `create room ${create.status()}`).toBeTruthy();
      const { room_id: roomId } = await create.json();
      expect((await ctx.request.post(`${L_BASE}/api/rooms/${roomId}/start`, { data: {} })).ok()).toBeTruthy();

      // 山を渡してから開く [host の接続が start を送る]
      const setPool = await fetch(`http://127.0.0.1:${L_WS_INTERNAL_PORT}/internal/test/set-pool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-anmika-internal-secret': L_SECRET },
        body: JSON.stringify({ room_id: roomId, pool }),
      });
      expect(((await setPool.json()) as { ok?: boolean }).ok, 'set-pool').toBe(true);

      const page = await ctx.newPage();
      await page.goto(`${L_BASE}/?room=${roomId}`);
      await expect(page.locator('section.player').first()).toBeVisible({ timeout: 30000 });

      // 配牌直後: 親はまだリーチしていない
      const lizhiSeats = () => page.evaluate(() => [...((window as any).__game?.game?.lizhi ?? [])] as number[]);
      await expect.poll(lizhiSeats, { timeout: 15000 }).toEqual([]);

      // リーチ種別 [通常] を押す → 宣言牌の選択に入る
      const normal = page.locator('button.lizhi-choice.normal:visible').first(); // [2026-10-09 shun2 R5] 見えるのは手牌の上の 1 か所だけ [header の行は卓では隠す]
      await expect(normal, '通常リーチのボタンが出ていない').toBeEnabled({ timeout: 30000 });
      await normal.click();
      await expect(page.locator('[data-testid="lizhi-selection-status"]:visible').first()).toBeVisible({ timeout: 10000 });

      // 宣言牌 [候補は 1 枚] を切る
      const candidate = page.locator('section.player button.tile-btn[data-lizhi-candidate="true"]');
      await expect(candidate).toHaveCount(1, { timeout: 10000 });
      await candidate.click();

      // サーバーが受理して投影が戻る: 自分のリーチが立ち、河のリーチ牌が 1 枚、宣言の途中状態が残らない
      await expect.poll(lizhiSeats, { timeout: 20000, message: 'リーチが確定しない' }).toEqual([0]);
      await expect(page.locator('.hez-tile.lizhi-tile:visible, .he-tile.lizhi-tile:visible').first()).toBeVisible({ timeout: 10000 }); // 盤面は幅違いで 2 か所に描かれる
      const river = await page.evaluate(() => (window as any).__game.game.he.get(0)._pai as string[]);
      expect(river.filter((t) => t.endsWith('*') || t.endsWith('__')).length, `河: ${river.join(',')}`).toBe(1);
      const pending = await page.evaluate(() => (window as any).__game.lizhiPending);
      expect(pending, 'リーチ宣言の途中状態が残っている').toBeNull();
    } finally {
      await ctx.close();
    }
  });
});

