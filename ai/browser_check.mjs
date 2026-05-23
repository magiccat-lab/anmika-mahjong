// anmika-mahjong ブラウザ動作 check (v3)
// dev モード切替 → P0/P1/P2 ループで CPU 化 → 自動連打、 局進行 metric 監視
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5178/';
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '120000');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const page = await ctx.newPage();

const errors = [];
const consoleErrors = [];
const dialogs = [];

page.on('pageerror', (err) => {
  errors.push(`pageerror: ${err.message}\n${(err.stack ?? '').slice(0, 800)}`);
});
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    consoleErrors.push(`[${msg.type()}] ${msg.text().slice(0, 400)}`);
  }
});
page.on('dialog', async (dialog) => {
  dialogs.push(`dialog [${dialog.type()}]: ${dialog.message().slice(0, 200)}`);
  await dialog.dismiss();
});

console.log(`Loading ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
console.log('Page loaded');

// dev モード切替
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  btns.find(b => b.textContent?.includes('dev モード'))?.click();
});
await page.waitForTimeout(400);

// 全 player CPU 化
for (const pt of ['P0', 'P1', 'P2']) {
  await page.evaluate((p) => {
    const btns = Array.from(document.querySelectorAll('button'));
    btns.find(b => b.textContent?.trim() === p)?.click();
  }, pt);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const cpu = btns.find(b => b.textContent?.includes('🤖 CPU'));
    if (cpu && !cpu.disabled) cpu.click();
  });
  await page.waitForTimeout(150);
}

// progress metric: 山残り / changbang
const startMs = Date.now();
let steps = 0;
let lastSnap = '';
let stuck = 0;
while (Date.now() - startMs < TIMEOUT_MS) {
  const r = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const cand = ['⏩ 自動', '次の局', '使わない', '使う', 'OK', 'パス', '確定', 'スキップ', '保留'];
    for (const t of cand) {
      const b = btns.find(x => x.textContent?.includes(t) && !x.disabled && x.offsetWidth > 0);
      if (b) { b.click(); return t; }
    }
    return null;
  });
  if (!r) await page.waitForTimeout(60);
  steps++;
  if (steps % 200 === 0) {
    const snap = await page.evaluate(() => {
      const txt = document.body.innerText;
      const yama = txt.match(/山\s*(\d+)/)?.[1];
      const bukyoku = txt.match(/(東|南|西)\s*(\d+)\s*局/)?.[0];
      const benbang = txt.match(/(\d+)\s*本場/)?.[0];
      return `yama=${yama} kyoku=${bukyoku} benbang=${benbang}`;
    });
    if (snap === lastSnap) stuck++; else { lastSnap = snap; stuck = 0; }
    console.log(`step ${steps} clicked=${r ?? 'none'} ${snap} err=${errors.length} console=${consoleErrors.length} dialog=${dialogs.length} stuck=${stuck}`);
    if (stuck >= 5) {
      console.log('STUCK detected, attempting 初期化');
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        btns.find(b => b.textContent?.includes('初期化'))?.click();
      });
      stuck = 0;
    }
  }
  if (steps > 10000) break;
}

console.log(`---`);
console.log(`steps: ${steps}`);
console.log(`errors: ${errors.length}`);
console.log(`console_errors: ${consoleErrors.length}`);
console.log(`dialogs: ${dialogs.length}`);
if (errors.length) console.log('--- pageerror (5) ---\n' + errors.slice(0, 5).join('\n\n'));
if (consoleErrors.length) console.log('--- console (20) ---\n' + consoleErrors.slice(0, 20).join('\n'));
if (dialogs.length) console.log('--- dialogs (20) ---\n' + dialogs.slice(0, 20).join('\n'));
await page.screenshot({ path: '/tmp/anmika_after.png', fullPage: true });

await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
