// 使い方: PLAYWRIGHT_BROWSERS_PATH=<ms-playwright> CPU_RATE=4 node tools/engine_cost_solo.mjs
// 2026-09-20 監査の計器。autoAdvance (同期で 1 局) の所要 ÷ 打牌数 = エンジン単体の 1 手コスト
// エンジン単体の 1 手あたりコスト: autoAdvance (同期で 1 局を回す) の所要 ÷ 打牌数
import { chromium } from 'playwright';
const RATE = Number(process.env.CPU_RATE ?? 4);
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 915, height: 412 } }); const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page); if (RATE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
await page.goto('https://anmika.magiccatlab.com', { waitUntil: 'load' });
await page.locator('button.entry-btn.solo').click(); await page.locator('section.player').first().waitFor({ state: 'visible', timeout: 20000 });
const rows = [];
for (let r = 0; r < 6; r++) {
  const res = await page.evaluate(() => { const s = window.__gameStore; const g = () => window.__game; s.setCpuSeats([0, 1, 2]);
    const before = [0, 1, 2].reduce((a, i) => a + (g().game?.he?.get?.(i)?._pai?.length ?? 0), 0);
    const t0 = performance.now(); s.autoAdvance(); const t1 = performance.now();
    const after = [0, 1, 2].reduce((a, i) => a + (g().game?.he?.get?.(i)?._pai?.length ?? 0), 0);
    const ended = !!g().roundEnded || !!g().pendingPingju || g().lastWinner !== null;
    const t2 = performance.now(); if (ended) s.nextRound?.(); const t3 = performance.now();
    return { ms: Math.round(t1 - t0), discards: after - before, ended, nextRound_ms: Math.round(t3 - t2) }; });
  rows.push(res); await page.waitForTimeout(300);
}
const tot = rows.reduce((a, r) => a + r.ms, 0), dis = rows.reduce((a, r) => a + r.discards, 0);
console.log(JSON.stringify({ cpu_rate: RATE, rounds: rows, per_discard_ms: dis ? +(tot / dis).toFixed(1) : null, nextRound_avg_ms: Math.round(rows.reduce((a, r) => a + r.nextRound_ms, 0) / rows.length) }));
await browser.close();
