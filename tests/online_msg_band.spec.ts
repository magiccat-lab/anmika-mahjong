// [2026-10-15 リョー「北抜きボタンは同じでいい。上のログの北抜きを華の下に置けって」]
// オンラインのお知らせの帯 (北抜き ・ リーチなど) は「あなたの華」の欄の下に重ねて出す。卓の上の header には出さない。
// 出ても消えても卓が上下しない事は、帯が卓の流れの外 (position: absolute) にあり、header に帯が無く、
// 帯が出る直前と出た時で「あなたの華」の欄の位置が同じ事で見る (席の札は CPU の北抜きで華が増えると動くので比べない)。
// 隔離のスタック (tools/run_online_e2e.mjs と同じ 18990) で回す: ANMIKA_BASE_URL=http://127.0.0.1:18990 npx playwright test tests/online_msg_band.spec.ts
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const BASE = process.env.ANMIKA_BASE_URL ?? 'http://127.0.0.1:18990';

async function login(ctx: BrowserContext, user_id: string, username: string) {
  const r = await ctx.request.post(`${BASE}/auth/test/login`, { data: { user_id, username }, headers: { 'Content-Type': 'application/json' } });
  if (!r.ok()) throw new Error(`login ${r.status()}`);
}

async function startCpuRoom(page: Page, ctx: BrowserContext, uid: string) {
  await page.goto(BASE);
  await page.locator('button.entry-btn.online').click();
  await page.locator('select.sel-cpu-count').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('select.sel-cpu-count').selectOption('2');
  await page.locator('button.create, button:has-text("新しい部屋")').first().click();
  await page.waitForTimeout(3000);
  const start = page.locator('button:has-text("開始")').first();
  await expect(start).toBeEnabled({ timeout: 15000 });
  await start.click();
  await expect(page.locator('main.mode-single.online-game')).toBeVisible({ timeout: 20000 });
}

const layout = (page: Page) => page.evaluate(() => {
  const r = (sel: string) => { const el = document.querySelector(sel) as HTMLElement | null; if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
  const bandEl = document.querySelector('.msg-band') as HTMLElement | null;
  return { me: r('.hua-panel.hp-me'), band: r('.msg-band'), hand: r('.seat-bottom'), bandPos: bandEl ? getComputedStyle(bandEl).position : '', headerBand: document.querySelectorAll('header .msg-band').length,
    inMe: !!document.querySelector('.hua-panel.hp-me .msg-band'), vw: innerWidth, sw: document.documentElement.scrollWidth };
});

for (const [w, h, name] of [[1280, 800, 'pc'], [390, 844, 'port']] as Array<[number, number, string]>) {
  test(`お知らせの帯は「あなたの華」の下に重ね、卓は上下しない: ${name}`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const uid = `msgband-${name}-${Date.now()}`;
    await login(ctx, uid, `msgband${name}`);
    const page = await ctx.newPage();
    await startCpuRoom(page, ctx, uid);
    // 帯が無い時の位置を取ってから、CPU の北抜き ・ リーチ ・ 自分のツモなどで帯が出るのを待つ
    let without: any = null; let withBand: any = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 120_000 && !(without && withBand)) {
      const l = await layout(page);
      if (l.me && l.hand) { if (!l.band) without = l; else if (without) withBand = l; }
      // 自分の番はツモ切り ・ 鳴きなしで流す (局が変わると外れるので毎回見る)
      for (const sel of ['.me-toggles .tsumokiri-toggle:not(.nocall-toggle):not(.autowin-toggle) input', '.me-toggles .nocall-toggle input']) {
        const box = page.locator(sel).first();
        if (await box.count() && !(await box.isChecked())) await box.check({ force: true }).catch(() => {});
      }
      // 局の終わりの板は次へ
      const next = page.locator('button.next-btn, button:has-text("次の局")').first();
      if (await next.count() && await next.isVisible()) await next.click({ timeout: 500 }).catch(() => {});
      await page.waitForTimeout(400);
    }
    expect(withBand, '帯が 2 分で一度も出なかった').not.toBeNull();
    expect(without, '帯が出ていない時が無かった').not.toBeNull();
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/msgband_${name}.png` });
    expect(withBand.headerBand).toBe(0);
    expect(withBand.inMe).toBe(true);
    // 帯は欄のすぐ下 (欄の下端から 40px 以内に頭)
    expect(withBand.band.top).toBeGreaterThanOrEqual(withBand.me.bottom - 1);
    expect(withBand.band.top).toBeLessThan(withBand.me.bottom + 40);
    // 帯が出ても欄は動かない
    expect(Math.abs(withBand.me.top - without.me.top)).toBeLessThanOrEqual(1);
    expect(withBand.bandPos).toBe('absolute');
    expect(withBand.sw).toBeLessThanOrEqual(withBand.vw + 1);
    await ctx.close();
  });
}
