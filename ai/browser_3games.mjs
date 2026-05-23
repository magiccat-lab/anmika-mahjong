// 3 試合 [半荘] 通しで CPU 自走、 各局 finish まで進めて error 出ないか確認
import { chromium } from 'playwright';

const URL = 'http://localhost:5178/';
const GAMES = parseInt(process.env.GAMES || '3');
const MAX_STEPS_PER_GAME = parseInt(process.env.MAX_STEPS_PER_GAME || '20000');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const page = await ctx.newPage();

const errors = [];
const consoleErrors = [];
const dialogs = [];

page.on('pageerror', (err) => {
  errors.push(`pageerror: ${err.message}\n${(err.stack ?? '').slice(0, 600)}`);
});
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    consoleErrors.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`);
  }
});
page.on('dialog', async (dialog) => {
  dialogs.push(`dialog [${dialog.type()}]: ${dialog.message().slice(0, 200)}`);
  await dialog.dismiss();
});

console.log(`Loading ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

// dev モード
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  btns.find(b => b.textContent?.includes('dev モード'))?.click();
});
await page.waitForTimeout(400);

// 全 player CPU 化
async function makeAllCpu() {
  for (const pt of ['P0', 'P1', 'P2']) {
    await page.evaluate((p) => {
      const btns = Array.from(document.querySelectorAll('button'));
      btns.find(b => b.textContent?.trim() === p)?.click();
    }, pt);
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const cpu = btns.find(b => b.textContent?.includes('🤖 CPU'));
      if (cpu && !cpu.disabled) cpu.click();
    });
    await page.waitForTimeout(120);
  }
}

await makeAllCpu();

// 1 試合 = 半荘 [state.finished=true 検出 or 累計局数 > 12]
async function runOneGame(gameIdx) {
  const before = { e: errors.length, c: consoleErrors.length, d: dialogs.length };
  let steps = 0;
  let stuck = 0;
  let lastSnap = '';
  let gameDone = false;
  while (steps < MAX_STEPS_PER_GAME && !gameDone) {
    const r = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const cand = ['⏩ 自動', '次の局', '使わない', '使う', 'OK', 'パス', '確定', 'スキップ', '保留'];
      for (const t of cand) {
        const b = btns.find(x => x.textContent?.includes(t) && !x.disabled && x.offsetWidth > 0);
        if (b) { b.click(); return t; }
      }
      return null;
    });
    if (!r) await page.waitForTimeout(40);
    steps++;
    if (steps % 200 === 0) {
      const info = await page.evaluate(() => {
        const txt = document.body.innerText;
        const yama = txt.match(/山\s*(\d+)/)?.[1];
        const ba = txt.match(/(東|南|西)\s*(\d+)\s*局/)?.[0];
        const bb = txt.match(/(\d+)\s*本場/)?.[0];
        // 半荘終了 banner / 結果表示があるかチェック
        const finished = /半荘終了|ゲーム終了|最終結果|GameEndPanel/.test(txt) ||
          /ウマ.*?\+|ウマ.*?-/.test(txt);
        return { yama, ba, bb, finished };
      });
      const snap = `${info.ba}/${info.bb}/${info.yama}`;
      if (snap === lastSnap) stuck++; else { lastSnap = snap; stuck = 0; }
      if ((steps % 1000) === 0 || info.finished) {
        console.log(`  game ${gameIdx} step ${steps} ba=${info.ba} benbang=${info.bb} yama=${info.yama} finished=${info.finished} stuck=${stuck} err=${errors.length}`);
      }
      if (info.finished) {
        gameDone = true;
        break;
      }
      if (stuck >= 15) {
        console.log(`  game ${gameIdx} STUCK at step ${steps}, forcing 初期化`);
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          btns.find(b => b.textContent?.includes('初期化'))?.click();
        });
        await page.waitForTimeout(400);
        stuck = 0;
        // 初期化 後 CPU 再 setup
        await makeAllCpu();
      }
    }
  }
  const delta = { e: errors.length - before.e, c: consoleErrors.length - before.c, d: dialogs.length - before.d };
  console.log(`  game ${gameIdx} ended at step ${steps}, gameDone=${gameDone}, err+=${delta.e} console+=${delta.c} dialog+=${delta.d}`);
  return { steps, gameDone, delta };
}

const results = [];
for (let g = 1; g <= GAMES; g++) {
  console.log(`=== game ${g}/${GAMES} ===`);
  if (g > 1) {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      btns.find(b => b.textContent?.includes('初期化'))?.click();
    });
    await page.waitForTimeout(500);
    await makeAllCpu();
  }
  const r = await runOneGame(g);
  results.push(r);
}

console.log('---');
console.log('GAMES:', GAMES);
results.forEach((r, i) => console.log(` game ${i + 1}: steps=${r.steps} done=${r.gameDone} err+=${r.delta.e}`));
console.log('TOTAL errors:', errors.length);
console.log('TOTAL console:', consoleErrors.length);
console.log('TOTAL dialogs:', dialogs.length);
if (errors.length) {
  console.log('--- pageerror (10) ---');
  console.log(errors.slice(0, 10).join('\n\n'));
}
if (consoleErrors.length) {
  console.log('--- console (20) ---');
  console.log(consoleErrors.slice(0, 20).join('\n'));
}
if (dialogs.length) {
  console.log('--- dialogs (10) ---');
  console.log(dialogs.slice(0, 10).join('\n'));
}
await page.screenshot({ path: '/tmp/anmika_3games_end.png', fullPage: true });
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
