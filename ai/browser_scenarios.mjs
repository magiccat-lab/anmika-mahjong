// scenario button preset 全部 click して error 出ないか check
import { chromium } from 'playwright';
const URL = 'http://localhost:5178/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
const errs = [], ces = [], dialogs = [];
page.on('pageerror', e => errs.push('PE: ' + e.message));
page.on('console', m => { if (['error', 'warning'].includes(m.type())) ces.push('[' + m.type() + ']' + m.text().slice(0, 300)); });
page.on('dialog', async d => { dialogs.push(d.type() + ':' + d.message().slice(0, 200)); await d.dismiss(); });
await page.goto(URL, { waitUntil: 'networkidle' });
// dev モード
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  btns.find(b => b.textContent?.includes('dev モード'))?.click();
});
await page.waitForTimeout(400);
const scenarios = [
  'ぽっち+夏秋', 'フィバ春冬金北', '間8m', '米七対子', 'ピンフ+冬冬金北',
  'V1 流し役満', 'V2 フィバ三色', 'V4 役満13翻超過', 'V6 国士13面',
  'V15 倍率連鎖', '🎲 ぽっち一発ツモ', 'V18 シュバ見逃し', 'V20 冬金北自動',
  '🧪 フィバ+カン',
];
for (const name of scenarios) {
  const before = errs.length;
  await page.evaluate((nm) => {
    const btns = Array.from(document.querySelectorAll('button'));
    btns.find(b => b.textContent?.includes(nm))?.click();
  }, name);
  await page.waitForTimeout(800);
  // 自動 / OK / 確定 を数回 押し
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const cand = ['⏩ 自動', '次の局', '使わない', '使う', 'OK', 'パス', '確定'];
      for (const t of cand) {
        const b = btns.find(x => x.textContent?.includes(t) && !x.disabled && x.offsetWidth > 0);
        if (b) { b.click(); return; }
      }
    });
    await page.waitForTimeout(80);
  }
  const delta = errs.length - before;
  console.log(`[${name}] err+=${delta}`);
  // 初期化
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    btns.find(b => b.textContent?.includes('初期化'))?.click();
  });
  await page.waitForTimeout(400);
}
console.log('---');
console.log('errors:', errs.length, 'console:', ces.length, 'dialogs:', dialogs.length);
if (errs.length) console.log('ERR:', errs.slice(0, 10).join('\n'));
if (ces.length) console.log('CON:', ces.slice(0, 15).join('\n'));
if (dialogs.length) console.log('DLG:', dialogs.slice(0, 10).join('\n'));
await browser.close();
