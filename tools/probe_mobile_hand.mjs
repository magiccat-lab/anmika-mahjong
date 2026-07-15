// スマホ横画面で自家手牌が見えない件の再現プローブ [yuma 2026-07-15]
// usage: node tools/probe_mobile_hand.mjs [url]
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:8080/';

const viewports = [
  { name: 'iphone-13-landscape', width: 844, height: 390 },
  { name: 'iphone-se-landscape', width: 667, height: 375 },
  { name: 'pixel-7-landscape', width: 915, height: 412 },
];

const browser = await chromium.launch();
try {
  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto(url);
    await page.locator('button.entry-btn.solo').click();
    await page.waitForSelector('main.mode-single', { timeout: 8000 });
    await page.waitForTimeout(800);

    const info = await page.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          x: Math.round(r.x), y: Math.round(r.y),
          w: Math.round(r.width), h: Math.round(r.height),
          display: cs.display, visibility: cs.visibility,
          overflow: cs.overflow, inViewport: r.bottom > 0 && r.top < innerHeight && r.width > 0 && r.height > 0,
        };
      };
      const tiles = document.querySelectorAll('.seat-bottom .shoupai .pai, .seat-bottom [class*=tile], .seat-bottom img');
      return {
        innerH: innerHeight, innerW: innerWidth,
        docScrollH: document.documentElement.scrollHeight,
        main: pick('main.mode-single'),
        scoreBox: pick('.score-box'),
        seatBottom: pick('.seat-bottom'),
        shoupai: pick('.seat-bottom .shoupai'),
        tileCount: tiles.length,
        firstTile: tiles.length ? (() => { const r = tiles[0].getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height) }; })() : null,
        orientationNotice: pick('.orientation-notice'),
      };
    });
    console.log('=== ' + vp.name + ' (' + vp.width + 'x' + vp.height + ')');
    console.log(JSON.stringify(info, null, 1));
    await page.screenshot({ path: `/tmp/claude-1000/-home-m-catlab-secretary-v2-prod/263ef0fd-4ce5-407d-8576-885ff6fff3e5/scratchpad/hand_${vp.name}.png` });
    await page.close();
  }
} finally {
  await browser.close();
}
