// 使い方: PLAYWRIGHT_BROWSERS_PATH=<ms-playwright> CPU_RATE=4 SECONDS=60 node tools/perf_probe_solo.mjs  [ANMIKA_BASE_URL で対象を変える]
// 2026-09-20 監査の計器。solo を CPU 3 人で 60 秒回し、長タスク (50ms 超) を局面 (cutin / nextRound / step) に紐付ける
// anmika 処理落ち計測 v2: solo を cpuStep で 1 手ずつ進め (演出を描かせる)、長タスク / FPS / style recalc を取る
import { chromium } from 'playwright';
const BASE = process.env.ANMIKA_BASE_URL ?? 'https://anmika.magiccatlab.com';
const RATE = Number(process.env.CPU_RATE ?? 4);
const SECONDS = Number(process.env.SECONDS ?? 60);
const STEP_MS = Number(process.env.STEP_MS ?? 300);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36' });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__lt = []; window.__fpsSamples = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  let last = performance.now(), n = 0;
  const tick = (t) => { n++; if (t - last >= 1000) { window.__fpsSamples.push(n); n = 0; last = t; } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
if (RATE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
await page.goto(BASE, { waitUntil: 'load' });
await page.locator('button.entry-btn.solo').click();
await page.locator('section.player').first().waitFor({ state: 'visible', timeout: 20000 });
await page.evaluate(() => { window.__gameStore.setCpuSeats([0, 1, 2]); });
await page.waitForTimeout(500);
await page.evaluate(() => { window.__lt.length = 0; window.__fpsSamples.length = 0; });
const metrics = async () => (await cdp.send('Performance.getMetrics')).metrics.reduce((a, m) => (a[m.name] = m.value, a), {});
const m0 = await metrics();
const timeline = []; let steps = 0, rounds = 0, stuckPolls = 0, autoAdv = 0, saiKoro = 0; const t0 = Date.now(); let lastSig = '';
while (Date.now() - t0 < SECONDS * 1000) {
  await page.waitForTimeout(STEP_MS);
  const st = await page.evaluate(() => { const g = window.__game; const s = window.__gameStore; const ps = g.pendingSaiKoro;
    const sig = JSON.stringify([g.game?.state?.lunban, g.game?.shan?._pai?.length, !!g.roundEnded, !!g.pendingPingju, !!ps, !!g.cutin, g.lastWinner]);
    if (ps) { if (!ps.selectedCombo) s.selectSaiKoroCombo?.(1, 6); else if (!ps.finalized) s.rollSaiKoroDice?.([2, 3]); else s.advanceSaiKoro?.(); return { sig, did: 'saikoro' }; }
    if (g.cutin) return { sig, did: 'cutin' };
    if (g.game?.state?.finished) { s.nextMatch?.({ finalize: true, resetChip: false }); return { sig, did: 'nextMatch' }; }
    if (g.roundEnded || g.pendingPingju || g.lastWinner !== null) { s.nextRound?.(); return { sig, did: 'nextRound' }; }
    s.cpuStep?.(); return { sig, did: 'step' }; });
  timeline.push([Date.now() - t0 + 0, st.did, st.sig]); if (st.did === "step") steps++; if (st.did === 'nextRound') rounds++; if (st.did === 'saikoro') saiKoro++;
  if (st.sig === lastSig) { stuckPolls++; if (stuckPolls >= 8) { await page.evaluate(() => window.__gameStore.autoAdvance?.()); autoAdv++; stuckPolls = 0; } } else stuckPolls = 0;
  lastSig = st.sig;
}
const elapsed = (Date.now() - t0) / 1000;
const m1 = await metrics();
const ltRaw = await page.evaluate(() => window.__lt.slice()); const pageT0 = await page.evaluate(() => performance.now()) - (Date.now() - t0);
const attr = {}; for (const [st, du] of ltRaw) { const rel = st - pageT0; let did = 'before'; let sig=''; for (const [t, d, g] of timeline) { if (t <= rel) { did = d; sig = g; } else break; } (attr[did] ||= []).push(du); }
const lt = ltRaw.map(x => x[1]).sort((a, b) => a - b);
const fps = (await page.evaluate(() => window.__fpsSamples.slice()));
const nodes = await page.evaluate(() => document.getElementsByTagName('*').length);
const q = (arr, f) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] : 0;
const d = (k) => Math.round((m1[k] - m0[k]) * 1000) / 1000;
const fpsS = [...fps].sort((a, b) => a - b);
console.log(JSON.stringify({ attribution: Object.fromEntries(Object.entries(attr).map(([k, v]) => [k, { n: v.length, total_ms: v.reduce((a, b) => a + b, 0), max: Math.max(...v) }])), cpu_rate: RATE, seconds: elapsed, steps, rounds, saikoro_polls: saiKoro, auto_advance_rescues: autoAdv,
  long_tasks: { n: lt.length, p50: q(lt, .5), p90: q(lt, .9), max: lt[lt.length - 1] ?? 0, per_step: steps ? +(lt.length / steps).toFixed(2) : null, total_ms: lt.reduce((a, b) => a + b, 0) },
  fps: { samples: fps.length, min: fpsS[0] ?? null, p10: q(fpsS, .1), p50: q(fpsS, .5), avg: fps.length ? +(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1) : null },
  dom_nodes: nodes, script_s: d('ScriptDuration'), task_s: d('TaskDuration'), layout_count: d('LayoutCount'), recalc_style_count: d('RecalcStyleCount'), layout_s: d('LayoutDuration'), recalc_s: d('RecalcStyleDuration'), heap_mb: Math.round((m1.JSHeapUsedSize || 0) / 1e6) }));
await browser.close();
