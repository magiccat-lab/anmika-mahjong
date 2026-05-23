// mode-single 3 試合 通し check
// window.__game 経由で state 見ながら P0 操作 [tile click] / CPU 進行を観測
import { chromium } from 'playwright';
const URL = 'http://localhost:5178/';
const GAMES = parseInt(process.env.GAMES || '3');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

const errors = [], consoleErrors = [], dialogs = [];
page.on('pageerror', e => errors.push('PE: ' + e.message + '\n' + (e.stack ?? '').slice(0, 600)));
page.on('console', m => {
  if (['error', 'warning'].includes(m.type())) consoleErrors.push('[' + m.type() + '] ' + m.text().slice(0, 300));
});
page.on('dialog', async d => { dialogs.push(d.type() + ':' + d.message().slice(0, 200)); await d.dismiss(); });

console.log(`Loading ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(800);

// CPU delay を 0 化 [click 「即打モード」 等]、 mode-single でも 早く 進行させる
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button, label, input'));
  // 「即打」 or 「CPU ラグ」 toggle off
  const cpu = btns.find(b => b.textContent?.includes('CPU ラグ'));
  if (cpu && cpu.tagName === 'INPUT' && cpu.checked) cpu.click();
});

async function getState() {
  return await page.evaluate(() => {
    const g = window.__game?.game;
    if (!g) return null;
    return {
      jushu: g.state.jushu, changbang: g.state.changbang, benbang: g.state.benbang,
      finished: g.state.finished, lunban: g.state.lunban, paishu: g.shan?.paishu ?? -1,
      defen: { 0: g.state.defen[0], 1: g.state.defen[1], 2: g.state.defen[2] },
      curPlayer: ((g.state.qijia ?? 0) + (g.state.lunban ?? 0)) % 3,
      p0Zimo: g.shoupai?.get(0)?._zimo ?? null,
    };
  });
}

async function playOneGame(idx) {
  const before = { e: errors.length, c: consoleErrors.length, d: dialogs.length };
  let stepCount = 0;
  let stuckCount = 0;
  let lastStateKey = '';
  let finished = false;
  const startMs = Date.now();
  while (Date.now() - startMs < 600000) {
    const st = await getState();
    if (!st) { await page.waitForTimeout(80); continue; }
    if (st.finished) { finished = true; break; }
    // popup priority
    const handled = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const enabled = (b) => b && !b.disabled && b.offsetWidth > 0;
      // 半荘 done 後の「もう一度」「次の試合」「新しい」 系
      const replay = btns.find(x => /もう一度|もう一回|次の試合|新しい|再戦/.test(x.textContent ?? '') && enabled(x));
      if (replay) { replay.click(); return 'replay'; }
      // ツモ / ロン 取れるなら積極的に取る [試合 進行 早める]
      const tsumo = btns.find(x => x.textContent?.trim() === 'ツモ' && enabled(x));
      if (tsumo) { tsumo.click(); return 'ツモ'; }
      const ron = btns.find(x => x.textContent?.trim() === 'ロン' && enabled(x));
      if (ron) { ron.click(); return 'ロン'; }
      // 立直 [50% で 受ける、 残り pass]
      const lizhi = btns.find(x => x.textContent?.trim() === '立直' && enabled(x));
      if (lizhi && Math.random() < 0.5) { lizhi.click(); return '立直'; }
      const cand = ['次の局', '使わない', '使う', '保留', 'OK', '確定', '閉じる', 'パス', '鳴かない', 'スキップ', '続行', '続ける', '冬使う', '冬保留'];
      for (const t of cand) {
        const b = btns.find(x => x.textContent?.trim() === t && enabled(x))
                 || btns.find(x => x.textContent?.includes(t) && enabled(x));
        if (b) { b.click(); return t; }
      }
      return null;
    });
    if (handled) {
      stepCount++;
      await page.waitForTimeout(60);
      continue;
    }
    // P0 番 + ツモ済 → 手牌 click [ツモ切り]
    if (st.curPlayer === 0 && st.p0Zimo) {
      const clicked = await page.evaluate(() => {
        const tiles = Array.from(document.querySelectorAll('button.tile-btn')).filter(b => !b.disabled && b.offsetWidth > 0);
        if (tiles.length === 0) return false;
        const idx = Math.floor(Math.random() * tiles.length);
        tiles[idx].click();
        return true;
      });
      if (clicked) { stepCount++; await page.waitForTimeout(80); continue; }
    }
    // P1/P2 番 → cpuStep 手動発火 [auto delay 待たない、 即進行]
    if (st.curPlayer !== 0) {
      await page.evaluate(() => { try { window.__game?.cpuStep?.(); } catch (e) {} });
      stepCount++;
      await page.waitForTimeout(60);
      continue;
    }
    // stuck check
    const key = `${st.jushu}/${st.benbang}/${st.paishu}/${st.curPlayer}`;
    if (key === lastStateKey) stuckCount++; else { lastStateKey = key; stuckCount = 0; }
    if (stuckCount > 30) {
      console.log(`  g${idx} STUCK at step ${stepCount}, state=${key}`);
      break;
    }
    await page.waitForTimeout(60);
    stepCount++;
    if (stepCount % 200 === 0) {
      console.log(`  g${idx} step ${stepCount} state=${key} defen=${JSON.stringify(st.defen)} err=${errors.length}`);
    }
  }
  const delta = { e: errors.length - before.e, c: consoleErrors.length - before.c, d: dialogs.length - before.d };
  const stFinal = await getState();
  console.log(`  game ${idx} ended: steps=${stepCount} finished=${finished} jushu=${stFinal?.jushu} changbang=${stFinal?.changbang} defen=${JSON.stringify(stFinal?.defen)} err+=${delta.e}`);
  return { stepCount, finished, delta, stFinal };
}

const results = [];
for (let g = 1; g <= GAMES; g++) {
  console.log(`=== game ${g}/${GAMES} ===`);
  if (g > 1) {
    // 「もう一度」 or 「次の試合へ」 / 「初期化」
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const next = btns.find(b => /もう一度|次の試合|新しい|初期化/.test(b.textContent ?? '') && !b.disabled && b.offsetWidth > 0);
      if (next) { next.click(); return next.textContent; }
      return null;
    });
    await page.waitForTimeout(600);
  }
  const r = await playOneGame(g);
  results.push(r);
}

console.log('---');
console.log('GAMES:', GAMES);
results.forEach((r, i) => console.log(` g${i + 1}: steps=${r.stepCount} finished=${r.finished} err+=${r.delta.e}`));
console.log('TOTAL errors:', errors.length, 'console:', consoleErrors.length, 'dialogs:', dialogs.length);
if (errors.length) console.log('--- pageerror ---\n' + errors.slice(0, 10).join('\n\n'));
if (consoleErrors.length) console.log('--- console ---\n' + consoleErrors.slice(0, 20).join('\n'));
if (dialogs.length) console.log('--- dialogs ---\n' + dialogs.slice(0, 10).join('\n'));
await page.screenshot({ path: '/tmp/anmika_ms_end.png', fullPage: true });
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
