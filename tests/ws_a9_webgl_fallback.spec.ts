import { expect, test } from '@playwright/test';
import { defaultSanmaRule, generateTilePool } from '../src/lib/shan3';

const BASE = process.env.ANMIKA_BASE_URL ?? 'http://127.0.0.1:8790';

test.use({
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    args: [
      '--disable-3d-apis',
      '--disable-gpu',
      '--disable-webgl',
      '--disable-webgl2',
      '--disable-software-rasterizer',
      '--use-gl=disabled',
    ],
  },
});

function take(pool: string[], pai: string): string {
  const index = pool.indexOf(pai);
  if (index < 0) throw new Error(`fixed wall is missing ${pai}`);
  return pool.splice(index, 1)[0];
}

/**
 * P0 を大三元・ツモ和了にする正規116枚山。
 * Shan3 は末尾から引くので、実際の取得順を逆順で wall 末尾へ積む。
 */
function yakumanTsumoWall(): string[] {
  const pool = generateTilePool(defaultSanmaRule()).map(String);
  const p0Hand = [
    'z5b', 'z5r', 'z5g',
    'z6', 'z6', 'z6',
    'z7', 'z7', 'z7',
    'p1', 'p2', 'p3',
    'p4',
  ].map((pai) => take(pool, pai));
  const p0Draw = take(pool, 'p4');

  const fillers: string[] = [];
  for (let i = 0; i < 26; i += 1) {
    const index = pool.findIndex((pai) => !pai.startsWith('f'));
    if (index < 0) throw new Error('fixed wall has no non-flower filler');
    fillers.push(pool.splice(index, 1)[0]);
  }

  const drawOrder: string[] = [];
  for (let i = 0; i < 13; i += 1) {
    drawOrder.push(p0Hand[i], fillers[i * 2], fillers[i * 2 + 1]);
  }
  drawOrder.push(p0Draw);
  return [...pool, ...drawOrder.reverse()];
}

test('WSA-A9: WebGL無効でもサイコロチャンスを完走できる', async ({ page }) => {
  test.setTimeout(30_000);
  // WebGL 無効に加え、3D theme 読込も失敗させて init 失敗経路を確実に通す。
  await page.route('**/assets/dice-box/**', (route) => route.abort());
  await page.route('**/assets/dice-box.es-*.js', (route) => route.abort());
  await page.goto(`${BASE}/`);
  const hasWebGL = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl') || canvas.getContext('webgl2'));
  });
  expect(hasWebGL, 'WebGL無効ブラウザーで実行されていない').toBe(false);
  await page.locator('button.entry-btn.solo').click();
  await expect(page.locator('section.player').first()).toBeVisible({ timeout: 10_000 });

  const wall = yakumanTsumoWall();
  await page.evaluate((preShuffledPool) => {
    (window as any).__gameStore.reset({ preShuffledPool, qijia: 0, cpuSeats: [1, 2] });
  }, wall);
  const prepared = await page.evaluate(() => {
    const snapshot = (window as any).__game;
    return {
      canTsumo: snapshot?.game?.canTsumo?.(0) ?? false,
      hand: snapshot?.game?.shoupai?.get?.(0)?.toString?.() ?? null,
      flowers: snapshot?.game?.huapai?.[0] ?? null,
      lastZimo: snapshot?.lastZimo ?? null,
    };
  });
  expect(prepared.canTsumo, JSON.stringify(prepared)).toBe(true);

  await page.locator('button.tsumo-center').click();
  const modal = page.locator('.modal.sai');
  await expect(modal).toBeVisible({ timeout: 5_000 });
  const chanceCount = await page.evaluate(() => (window as any).__game?.pendingSaiKoro?.chances?.length ?? 0);
  expect(chanceCount).toBeGreaterThan(0);

  // ロジック側の出目を固定し、ゾロ目再投による確率的なテスト揺れをなくす。
  await page.evaluate(() => {
    let index = 0;
    const values = [0.05, 0.55]; // 1,4,1,4,...
    Math.random = () => values[index++ % values.length];
  });

  for (let chance = 0; chance < chanceCount; chance += 1) {
    await expect(modal.locator('button.combo').first()).toBeVisible({ timeout: 5_000 });
    await modal.locator('button.combo').first().click();

    // WebGL init が失敗しても watchdog 後は 2D 投了経路を操作できる。
    const rollButton = modal.locator('button.roll-btn');
    await expect(rollButton).toBeEnabled({ timeout: 7_000 });
    for (let roll = 0; roll < 4; roll += 1) {
      await expect(rollButton).toBeEnabled({ timeout: 5_000 });
      await rollButton.click();
    }

    await expect(modal).toContainText('確定', { timeout: 5_000 });
    const logicalRolls = await page.evaluate(() => (
      (window as any).__game?.pendingSaiKoro?.rolls?.map((roll: any) => roll.dice) ?? []
    ));
    expect(logicalRolls).toEqual([[1, 4], [1, 4], [1, 4], [1, 4]]);
    await modal.locator('button.roll-btn').click();
  }

  await expect(modal).toBeHidden({ timeout: 5_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__game?.pendingSaiKoro ?? null)).toBeNull();
});
