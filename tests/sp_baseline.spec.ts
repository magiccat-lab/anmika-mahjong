// SP横持ち UI 再設計 [docs/sp-ui-redesign.md] 手順A: スクショ基線 + bbox assert。
// 3つの SP 横 viewport で「壊れてない」の機械判定を常時走らせる:
//   1. 自家手牌の牌ボタンが 13 枚以上、全て viewport 内に完全に見える
//   2. score-box と 抜き box の bbox が交差しない [2026-07-22 リョー報告の再発防止]
//   3. 手牌行が横にはみ出さない
// SHOT_DIR 指定時は各 viewport のスクショと bbox JSON も基線として残す。
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const OUT = process.env.SHOT_DIR ?? '';

const VIEWPORTS = [
  { name: 'iphone12_landscape', width: 844, height: 390 },
  { name: 's24_landscape', width: 915, height: 412 },
  // S24 横でブラウザ chrome に食われた後の実効高相当 [2026-07-15 実機報告]
  { name: 'low340', width: 915, height: 340 },
];

type Box = { left: number; top: number; right: number; bottom: number; w: number; h: number } | null;

function intersects(a: Box, b: Box): boolean {
  if (!a || !b) return false;
  return !(a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left);
}

for (const vp of VIEWPORTS) {
  test(`sp baseline ${vp.name} [${vp.width}x${vp.height}]`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('button.entry-btn.solo').click();
    await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);

    const m = await page.evaluate(() => {
      const bb = (el: Element | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
      };
      const root = document.querySelector('main.mode-single');
      const hand = root?.querySelector('.seat-bottom') ?? null;
      const tiles = [...(hand?.querySelectorAll('.tile-btn') ?? [])].map(bb);
      return {
        hand: bb(hand),
        tiles,
        score: bb(root?.querySelector('.score-box') ?? null),
        nuki: [...(root?.querySelectorAll('.nuki') ?? [])].map(bb),
      };
    });

    // 1. 自家手牌: 13枚以上 [親は14]、全ボタンが viewport 内
    expect(m.tiles.length).toBeGreaterThanOrEqual(13);
    for (const t of m.tiles) {
      expect(t!.top).toBeGreaterThanOrEqual(-0.5);
      expect(t!.bottom).toBeLessThanOrEqual(vp.height + 0.5);
      expect(t!.left).toBeGreaterThanOrEqual(-0.5);
      expect(t!.right).toBeLessThanOrEqual(vp.width + 0.5);
    }
    // 2. score-box × 抜き box 非交差
    expect(m.score).not.toBeNull();
    expect(m.nuki.length).toBe(3);
    for (const n of m.nuki) {
      expect(intersects(m.score, n), `score-box が抜き box と交差 [${vp.name}]`).toBe(false);
    }
    // 3. 手牌行がはみ出さない
    expect(m.hand!.right).toBeLessThanOrEqual(vp.width + 0.5);
    expect(m.hand!.left).toBeGreaterThanOrEqual(-0.5);

    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: `${OUT}/sp_${vp.name}.png` });
      fs.writeFileSync(`${OUT}/sp_${vp.name}.json`, JSON.stringify(m, null, 2));
    }
  });
}

// v2 目標 [ui-board-v2 で有効化予定]: 全操作 hitbox >= 44px。
// 現行レイアウトは牌 40px 固定のため必ず落ちる。v2 の hit 拡張導入後に skip を外す。
test.skip('sp v2 target: 全操作 hitbox >= 44px [--tap-min]', async () => {
  // docs/sp-ui-redesign.md の「スケールトークン」参照
});
