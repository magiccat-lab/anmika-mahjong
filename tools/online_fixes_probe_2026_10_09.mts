// [2026-10-09 遊真] オンライン対戦の直し 15 個を、手元の隔離スタックで 3 人つないで通しで確かめる。
// 本番には何も打たない [API 19090 / ws 19092 / ws internal 19093、DB は .tmp の別ファイル 2 つ]。
//
//   npx vite build
//   PLAYWRIGHT_BROWSERS_PATH=<lane HOME>/.cache/ms-playwright node --import tsx tools/online_fixes_probe_2026_10_09.mts <shot dir>
//
// 見る物: 部屋コード [B3] → 3 人で開始 → 待ち時間の棒 [C1] → 1 人が抜けて「切断中」→ CPU 代打ち [A2]
// → 招待リンクで戻る [B2] → host が「CPU に替える」と本人の「自分で打つ」[A2] → 回線断で「つなぎ直し中」[C2]
// → 退出の確認 [C3] と 🐛 [C5] → host が抜けて試合が終わり、残りの人が「次の試合へ」→ server が戦績を記録 [A3]
// → ロビーの「戻る」[B2]。各所でスクショを撮る。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium, type BrowserContext, type Page } from 'playwright';

const ROOT = process.cwd();
const SHOTS = process.argv[2] || path.join(ROOT, '.tmp', 'online-fixes-shots');
const API_PORT = 19090;
const WS_PORT = 19092;
const WS_INTERNAL_PORT = 19093;
const BASE = `http://127.0.0.1:${API_PORT}`;
const SECRET = 'anmika-online-fixes-probe';
const API_DB = path.join(ROOT, '.tmp', 'online-fixes-api.sqlite3');
const WS_DB = path.join(ROOT, '.tmp', 'online-fixes-ws.sqlite3');
const VIEWPORT = { width: 915, height: 412 }; // スマホ横 [前回の見立てと同じ]

const env = {
  ...process.env,
  ANMIKA_TEST_AUTH: '1',
  ANMIKA_REQUIRE_SECRET: '0',
  ANMIKA_SESSION_SECRET: SECRET,
  ANMIKA_WS_SECRET: SECRET,
  ANMIKA_INTERNAL_SECRET: SECRET,
  ANMIKA_PUBLIC_BASE_URL: BASE,
  ANMIKA_WS_PUBLIC_URL: `ws://127.0.0.1:${WS_PORT}`,
  ANMIKA_API_BASE: BASE,
  ANMIKA_WS_PORT: String(WS_PORT),
  ANMIKA_WS_INTERNAL_PORT: String(WS_INTERNAL_PORT),
  ANMIKA_WS_INTERNAL_BASE: `http://127.0.0.1:${WS_INTERNAL_PORT}`,
  ANMIKA_WS_LOG: '0',
  // 待ちを短くして通しを速くする [代打ちまで 3 秒、手番 8 秒、鳴き 4 秒]
  ANMIKA_CPU_PROXY_GRACE_MS: '3000',
  ANMIKA_TURN_TIMEOUT_MS: '8000',
  ANMIKA_REACTION_TIMEOUT_MS: '4000',
};

const results: Array<{ item: string; ok: boolean; note: string }> = [];
function check(item: string, ok: boolean, note = ''): void {
  results.push({ item, ok, note });
  console.log(`${ok ? 'OK ' : 'NG '} ${item}${note ? ` — ${note}` : ''}`);
}

async function waitHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch { /* 起動中 */ }
    if (Date.now() > until) throw new Error(`timed out waiting for ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

async function poll<T>(fn: () => Promise<T>, ok: (value: T) => boolean, timeoutMs: number, stepMs = 300): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last = await fn();
  while (!ok(last) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
    last = await fn();
  }
  return last;
}

type Client = { ctx: BrowserContext; page: Page; uid: string; name: string };

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function visible(page: Page, selectorOrText: string): Promise<boolean> {
  try { return await page.locator(selectorOrText).first().isVisible(); } catch { return false; }
}

async function engineRevision(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (window as any).__game;
    return (g?.game?.events?.length ?? 0) as number;
  }).catch(() => -1);
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
  for (const db of [API_DB, WS_DB]) for (const suffix of ['', '-wal', '-shm']) rmSync(db + suffix, { force: true });
  const procs: ChildProcess[] = [];
  procs.push(spawn(process.execPath, ['--import', 'tsx', 'server/ws_server_test_harness.ts'], {
    cwd: ROOT, env: { ...env, ANMIKA_DB_PATH: WS_DB }, stdio: 'ignore',
  }));
  procs.push(spawn(path.join(ROOT, '.venv', 'bin', 'python3'), ['-m', 'uvicorn', 'server.app:app', '--host', '127.0.0.1', '--port', String(API_PORT)], {
    cwd: ROOT, env: { ...env, ANMIKA_DB_PATH: API_DB }, stdio: 'ignore',
  }));
  const browser = await chromium.launch();
  try {
    await waitHttp(`${BASE}/api/me`);
    const clients: Client[] = [];
    for (const [uid, name] of [['p-host', 'ホスト'], ['p-two', 'ふたり'], ['p-three', 'さんにん']] as const) {
      const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
      // 回線断 [C2] を作るために socket を掴んでおく。setOffline だけでは開いている WebSocket が切れない
      await ctx.addInitScript(() => {
        const Original = window.WebSocket;
        (window as any).__probeSockets = [];
        (window as any).WebSocket = class extends Original {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            (window as any).__probeSockets.push(this);
          }
        };
      });
      ctx.on('page', (page) => page.on('websocket', (socket) => {
        socket.on('framesent', (frame) => {
          const text = String(frame.payload);
          if (text.includes('setCpuProxy')) console.log(`[frame ${name} →]`, text);
        });
        socket.on('framereceived', (frame) => {
          const text = String(frame.payload);
          if (text.startsWith('{"type":"lobby"')) console.log(`[frame ${name} ←]`, text.replace(/"user_id":"[^"]*",/g, '').slice(0, 300));
        });
      }));
      const login = await ctx.request.post(`${BASE}/auth/test/login`, { data: { user_id: uid, username: name } });
      if (!login.ok()) throw new Error(`login ${uid} ${login.status()}`);
      clients.push({ ctx, page: await ctx.newPage(), uid, name });
    }
    const [host, two, three] = clients;

    // 部屋を作る [CPU 0]、招待リンクで 2 人が入る
    const create = await host.ctx.request.post(`${BASE}/api/rooms`, { data: { cpu_count: 0, match_mode: 'tonpu' } });
    const { room_id: roomId } = await create.json() as { room_id: string };
    await host.page.goto(`${BASE}/?room=${roomId}`);
    await host.page.waitForTimeout(2500);
    check('B3 部屋コードが大きく出る', await visible(host.page, `text=${roomId}`), roomId);
    check('B2 部屋にいる間は URL に ?room=', host.page.url().includes(`room=${roomId}`), host.page.url());
    await shot(host.page, '01_部屋_コード');
    for (const c of [two, three]) {
      await c.ctx.request.post(`${BASE}/api/rooms/${roomId}/join`, { data: {} });
      await c.page.goto(`${BASE}/?room=${roomId}`);
    }
    await host.page.waitForTimeout(3000);
    await host.page.locator('button:has-text("開始")').first().click({ timeout: 15_000 });
    for (const c of clients) await c.page.locator('main.mode-single').first().waitFor({ state: 'visible', timeout: 20_000 });
    await host.page.waitForTimeout(1500);

    // C1: 待ち時間の棒
    const bar = await poll(() => visible(host.page, '.dl-bar'), (v) => v, 10_000);
    check('C1 誰待ちかの棒が席に出る', bar);
    await shot(host.page, '02_対局_待ち時間の棒');

    // A2 / C1: 1 人抜ける → 切断中 → CPU 代打ち
    await three.page.close();
    const off = await poll(() => visible(host.page, '.oss-off'), (v) => v, 8_000);
    check('C1 抜けた人の席に「切断中」', off);
    const proxy = await poll(() => visible(host.page, '.oss-proxy'), (v) => v, 12_000);
    check('A2 切断から数秒で「CPU 代打ち」', proxy);
    await shot(host.page, '03_切断中_CPU代打ち');
    const before = await engineRevision(host.page);
    await host.page.waitForTimeout(20_000);
    const after = await engineRevision(host.page);
    check('A2 抜けた人の番でも卓が進む', after > before + 3, `events ${before} → ${after} (20 秒)`);

    // B2: 招待リンクで戻る → 代打ちが外れる
    three.page = await three.ctx.newPage();
    await three.page.goto(`${BASE}/?room=${roomId}`);
    await three.page.locator('main.mode-single').first().waitFor({ state: 'visible', timeout: 20_000 });
    // poll は最後の値を返す。「消えた」を待つ所は false が成功
    const stillProxy = await poll(() => visible(host.page, '.oss-proxy'), (v) => !v, 10_000);
    check('B2/A2 戻ったら元の局面に戻り、代打ちが外れる', !stillProxy);
    await shot(three.page, '04_戻った人の画面');

    // A2: host が「CPU に替える」→ 本人に帯 → 「自分で打つ」
    const toggle = host.page.locator('.oss-toggle').first();
    const hasToggle = await toggle.isVisible().catch(() => false);
    check('A2 host に「CPU に替える」が出る', hasToggle);
    if (hasToggle) {
      await toggle.click();
      const anyBanner = await poll(
        async () => (await visible(two.page, '.notice-proxy')) || (await visible(three.page, '.notice-proxy')),
        (v) => v, 8_000,
      );
      check('A2 替えられた本人に「CPU が代わりに打ってる」', anyBanner);
      const target = (await visible(two.page, '.notice-proxy')) ? two : three;
      await shot(target.page, '05_CPUが代わりに打ってる');
      await target.page.locator('.notice-proxy button').click();
      const stillBanner = await poll(() => visible(target.page, '.notice-proxy'), (v) => !v, 8_000);
      check('A2 「自分で打つ」で戻る', !stillBanner);
    }

    // C2: 回線断 → つなぎ直し中
    await two.ctx.setOffline(true);
    await two.page.evaluate(() => { for (const socket of (window as any).__probeSockets ?? []) try { socket.close(); } catch { /* closed */ } });
    const reconnect = await poll(() => visible(two.page, '.notice-reconnect'), (v) => v, 15_000);
    check('C2 切れている間「つなぎ直し中…」', reconnect);
    await shot(two.page, '06_つなぎ直し中');
    await two.ctx.setOffline(false);
    const stillDown = await poll(() => visible(two.page, '.notice-reconnect'), (v) => !v, 20_000);
    check('C2 戻ったら帯が消える', !stillDown);

    // C3 / C5
    check('C5 対局中に 🐛 が出る', await visible(two.page, 'button[aria-label="バグ通報"]'));
    await two.page.locator('button[aria-label="対局から退出"]').click();
    const dialog = await poll(() => visible(two.page, '.leave-confirm'), (v) => v, 3_000);
    check('C3 退出の前に「本当に抜ける？」', dialog);
    await shot(two.page, '07_退出の確認');
    await two.page.locator('.leave-confirm-no').click();
    check('C3 「戻る」で対局に残る', await visible(two.page, 'main.mode-single'));

    // A3: host が抜ける → 試合が終わる → 残りの人が「次の試合へ」→ server が戦績を記録
    await host.page.locator('button[aria-label="対局から退出"]').click();
    await host.page.locator('.leave-confirm-yes').click();
    await host.page.waitForTimeout(1500);
    const ff = await fetch(`http://127.0.0.1:${WS_INTERNAL_PORT}/internal/test/force-finish-match`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-anmika-internal-secret': SECRET },
      body: JSON.stringify({ room_id: roomId }),
    });
    check('(準備) 試合を終わらせる', ff.ok);
    // 結果の板の中のボタン [上の帯にも同じ文言のボタンがあるが板の下になる]
    const nextBtn = two.page.locator('.agari-unified-panel button:has-text("次の試合へ")').first();
    const nextVisible = await poll(() => nextBtn.isVisible().catch(() => false), (v) => v, 15_000);
    check('A3 host がいなくても残りの人に「次の試合へ」', nextVisible);
    await shot(two.page, '08_次の試合へ_ホスト不在');
    if (nextVisible) {
      await nextBtn.click();
      const recorded = await poll(async () => {
        try {
          const db = new DatabaseSync(API_DB, { readOnly: true });
          const rows = db.prepare('SELECT match_uuid FROM matches WHERE room_id=?').all(roomId) as Array<{ match_uuid: string }>;
          db.close();
          return rows;
        } catch { return []; }
      }, (rows) => rows.length > 0, 15_000);
      check('A3 server が試合の結果を記録', recorded.length === 1 && recorded[0].match_uuid.startsWith('srv:'), JSON.stringify(recorded));
      const nextMatchStarted = await poll(async () => two.page.evaluate(() => (window as any).__game?.game?.state?.finished === false).catch(() => false), (v) => v, 15_000);
      check('A3 次の試合が始まる', nextMatchStarted);
    }

    // B2: 抜けた host のロビーに「戻る」
    const lobbyBack = await poll(() => visible(host.page, '.rejoin-btn'), (v) => v, 15_000);
    check('B2 ロビーの自分の部屋に「戻る」', lobbyBack);
    await shot(host.page, '09_ロビー_戻る');
    if (lobbyBack) {
      await host.page.locator('.rejoin-btn').first().click();
      const rejoined = await poll(() => visible(host.page, 'main.mode-single'), (v) => v, 20_000);
      check('B2 「戻る」で対局に戻る', rejoined);
      await host.page.waitForTimeout(1500);
      await shot(host.page, '10_戻ったホスト');
    }
  } finally {
    await browser.close().catch(() => {});
    for (const proc of procs) if (!proc.killed) proc.kill('SIGTERM');
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
