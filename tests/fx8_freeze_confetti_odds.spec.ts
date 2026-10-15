import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

// [2026-10-15 fx7 の答え] 紙吹雪 (左右から噴き上げ) ・ 白ぽっちのフリーズ (暗転 ・ 止め絵) と、入口の演出一覧
const output = process.env.SHOT_DIR;
async function shot(page: Page, name: string) {
  if (!output) return;
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: `${output}/${name}.png` });
}
async function solo(page: Page) {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('/');
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible();
  await page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
}
async function pochi(page: Page, color = 'blue') {
  await page.evaluate((color) => {
    const s = (window as any).__game;
    s.game.lizhi.add(0);
    s.game.feverActive = [false, false, false];
    const pai = ({ blue: 'z5b', red: 'z5r', green: 'z5g', yellow: 'z5y' } as any)[color];
    s.game.events.push({ type: 'zimo', player: 0, pai });
    (window as any).__gameStore.setCpuSeats([]);
  }, color);
  await expect(page.locator('.sq-tile')).toBeVisible();
}

test('FX8: 入口の演出一覧に割合と当たりが出る (無演出の行も)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('button.entry-btn.fxodds').click();
  const dlg = page.locator('[role=dialog][aria-label="演出一覧"]');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('フリーズ (暗転)');
  await expect(dlg).toContainText('白のまま (光りが上がらない)');
  // 無演出の札: 予告なし (10-15 fx9 B7) ・ 光りが白のまま ・ 予告の光りが白 ・ 玉が白 ・ リーチ無し
  await expect(dlg.locator('.tag')).toHaveCount(5);
  // [10-15 先輩「ラフで画像とか入れてあげよう」「出る割合は～の1行目消そう」] 白ぽっちの行は絵 (15 枚が読める)、サイコロは玉、頭の 1 行は無い
  // [10-15 fx10] 引いた後の告知ランプ (先 ・ 後) の絵 2 枚を足して 17 枚
  await expect(dlg.locator('td.pic img')).toHaveCount(17);
  await expect(dlg).toContainText('告知ランプ (先告知)');
  await expect(dlg).toContainText('遅れ (ピキーンが 0.3 秒遅れる)');
  // 絵は loading=lazy なので、画面の外の分は URL が読めるかで見る
  for (const src of await dlg.locator('td.pic img').evaluateAll((els) => els.map((e) => e.getAttribute('src')!))) {
    const res = await page.request.get(src);
    expect(res.status(), src).toBe(200);
    expect((await res.body()).length, src).toBeGreaterThan(100); // 暗転の絵は黒に線 1 本で 262 バイト
  }
  await expect(dlg.locator('td.pic .ball')).toHaveCount(4);
  await expect(dlg).not.toContainText('出る割合はその演出が出る割合');
  await expect(dlg).toContainText('夏夏金北');
  // 表もスマホの幅で横に収まる (「当たり」の列が隠れない)
  const wide = await dlg.locator('.table-wrap').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(wide).toBe(0);
  await expect(dlg.locator('.sure').first()).toHaveText('確定');
  // 横にはみ出さない (スマホ)
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
  await shot(page, 'fx8-odds');
  await dlg.getByRole('button', { name: '閉じる' }).click();
  await expect(dlg).toHaveCount(0);
});

for (const kind of ['black', 'still'] as const) {
  test(`FX8: 白ぽっちのフリーズ (${kind}) は予告の代わりに 1.3 秒止まり、明けは虹で絞れる`, async ({ page }) => {
    await solo(page);
    await page.evaluate((k) => { (window as any).__forceFreeze = k; }, kind);
    await pochi(page, 'blue');
    await expect(page.locator(`.fz.fz-${kind}`)).toBeVisible();
    await expect(page.locator('.sq-band.teaser, .sq-premium')).toHaveCount(0);
    if (kind === 'still') expect(await page.evaluate(() => document.body.classList.contains('fz-still-on'))).toBe(true);
    await shot(page, `fx8-freeze-${kind}`);
    await expect(page.locator('.fz')).toHaveCount(0, { timeout: 3000 });
    expect(await page.evaluate(() => document.body.classList.contains('fz-still-on'))).toBe(false);
    await expect(page.locator('.sq-tile')).toHaveClass(/glow-rainbow/);
    const box = (await page.locator('.sq-tile').boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height - 4;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x, y - box.height * 1.2, { steps: 10 }); await page.mouse.up();
    await expect(page.locator('.sq-word')).toHaveText('青ぽっち');
  });
}

test('FX8: フリーズを決め打ちしない時は予告が出る (外れの色でフリーズは出ない)', async ({ page }) => {
  await solo(page);
  // [10-15 fx9 B7] 外れの 38% は無演出 (予告なし) になったので、予告は決め打ちして見る
  await page.evaluate(() => { (window as any).__forceTeaser = 'bolt'; });
  await pochi(page, 'red');
  await expect(page.locator('.sq-band.teaser, .sq-premium')).toHaveCount(1);
  await expect(page.locator('.fz')).toHaveCount(0);
});

test('FX10: 無演出の引きは予告もフリーズも出さずに絞りに入る', async ({ page }) => {
  await solo(page);
  await page.evaluate(() => { (window as any).__forceTeaser = 'none'; });
  await pochi(page, 'red');
  await expect(page.locator('.sq-hint')).toBeVisible();
  await expect(page.locator('.sq-band.teaser, .sq-premium, .sq-ci, .sq-bolt, .fz')).toHaveCount(0);
});

test('FX8: フィーバーの帯で紙吹雪が噴き上がり、3.4 秒で消える', async ({ page }) => {
  await solo(page);
  await page.evaluate(() => (window as any).__gameStore.enqueueCutin('fever', 0));
  await expect(page.locator('canvas.confetti')).toBeVisible();
  await page.waitForTimeout(900);
  await shot(page, 'fx8-confetti');
  await expect(page.locator('canvas.confetti')).toHaveCount(0, { timeout: 5000 });
  // 中 (ツモ) では出ない
  await page.evaluate(() => (window as any).__gameStore.enqueueCutin('tsumo', 0, { label: 'ツモ' }));
  await page.waitForTimeout(400);
  await expect(page.locator('canvas.confetti')).toHaveCount(0);
});

test('FX10: 夏夏金北が揃うとカットイン (字は演出の字体で出る)', async ({ page }) => {
  await solo(page);
  await page.evaluate(() => {
    const s = (window as any).__game;
    s.game.huapai[0] = ['f2', 'f2'];
    s.game.nukidoraGold[0] = 1;
    (window as any).__gameStore.setCpuSeats([]);
  });
  await expect(page.locator('.dr-word')).toHaveText('夏夏金北', { timeout: 4000 });
  await shot(page, 'fx10-kinpei');
  // 春 ・ 夏 ・ 秋 ・ 冬 ・ 金は足したサブセットから引く (読めないとシステムの字に落ちる)
  expect(await page.evaluate(async () => { await document.fonts.load("40px 'FX Kana'", '夏夏金北'); return document.fonts.check("40px 'FX Kana'", '春夏秋冬金北'); })).toBe(true);
  // 同じ局でもう一度揃えても出ない
  await expect(page.locator('.dr-word')).toHaveCount(0, { timeout: 4000 });
  await page.evaluate(() => (window as any).__gameStore.setCpuSeats([]));
  await page.waitForTimeout(600);
  await expect(page.locator('.dr-word')).toHaveCount(0);
});
