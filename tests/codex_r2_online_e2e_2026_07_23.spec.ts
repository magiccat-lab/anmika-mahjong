import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const BASE = process.env.ANMIKA_BASE_URL ?? "http://127.0.0.1:8790";

type Client = {
  ctx: BrowserContext;
  page: Page;
  uid: string;
  name: string;
};

async function login(ctx: BrowserContext, uid: string, username: string) {
  const response = await ctx.request.post(`${BASE}/auth/test/login`, {
    data: { user_id: uid, username },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function client(browser: Browser, uid: string, name: string): Promise<Client> {
  const ctx = await browser.newContext();
  await login(ctx, uid, name);
  const page = await ctx.newPage();
  page.on("console", (message) => console.log(`[${name}] ${message.text()}`));
  return { ctx, page, uid, name };
}

async function createRoom(host: Client, cpuCount = 0): Promise<string> {
  await host.page.goto(BASE);
  await host.page.locator("button.entry-btn.online").click();
  await host.page.locator("select.sel-cpu-count").selectOption(String(cpuCount));
  await host.page.locator("button.create").click();
  await expect
    .poll(async () => {
      const response = await host.ctx.request.get(`${BASE}/api/rooms`);
      const rooms = await response.json();
      return rooms.find(
        (room: any) =>
          room.host_user_id === host.uid && room.status !== "finished",
      )?.room_id;
    })
    .toBeTruthy();
  const response = await host.ctx.request.get(`${BASE}/api/rooms`);
  const rooms = await response.json();
  return rooms.find(
    (room: any) => room.host_user_id === host.uid && room.status !== "finished",
  ).room_id;
}

async function joinRoom(member: Client, roomId: string) {
  const response = await member.ctx.request.post(
    `${BASE}/api/rooms/${roomId}/join`,
  );
  expect(response.ok(), await response.text()).toBe(true);
  await member.page.goto(`${BASE}/?room=${roomId}`);
}

async function startThreeHuman(
  browser: Browser,
  prefix: string,
): Promise<{ roomId: string; players: Client[] }> {
  const players = await Promise.all([
    client(browser, `${prefix}A`, `${prefix}-A`),
    client(browser, `${prefix}B`, `${prefix}-B`),
    client(browser, `${prefix}C`, `${prefix}-C`),
  ]);
  const roomId = await createRoom(players[0], 0);
  await joinRoom(players[1], roomId);
  await joinRoom(players[2], roomId);
  const start = players[0].page.locator('button:has-text("開始")').first();
  await expect(start).toBeEnabled({ timeout: 20_000 });
  await start.click();
  await Promise.all(
    players.map(async ({ page }) => {
      await expect(page.locator("main.mode-single")).toBeVisible({
        timeout: 20_000,
      });
      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean((window as any).__game?.game?.state),
          ),
        )
        .toBe(true);
    }),
  );
  return { roomId, players };
}

async function publicState(page: Page) {
  return page.evaluate(() => {
    const state = (window as any).__game;
    const protocol = (window as any).__gameStore?.getOnlineProtocolState?.();
    return {
      protocol,
      qijia: state?.game?.state?.qijia,
      lunban: state?.game?.state?.lunban,
      paishu: state?.game?.state?.paishu,
      // [yuma修正] defen は {0,1,2} object で iterable じゃない
      defen: [0, 1, 2].map((seat) => state?.game?.state?.defen?.[seat] ?? 0),
      rivers: [0, 1, 2].map(
        (seat) => state?.game?.he?.get?.(seat)?._pai?.length ?? 0,
      ),
      roundEnded: Boolean(state?.roundEnded),
    };
  });
}

async function closeAll(clients: Client[]) {
  await Promise.allSettled(clients.map((entry) => entry.ctx.close()));
}

async function clickIfVisible(page: Page, pattern: RegExp): Promise<boolean> {
  const button = page.getByRole("button", { name: pattern }).first();
  if (!(await button.isVisible().catch(() => false))) return false;
  if (!(await button.isEnabled().catch(() => false))) return false;
  await button.click();
  return true;
}

/**
 * Deliberately decline optional calls/wins and discard the first legal tile.
 * This makes exhaustive draw the usual terminal path without test-only state mutation.
 */
async function driveOneStep(players: Client[]): Promise<boolean> {
  for (const { page } of players) {
    for (const pattern of [
      /見送/,
      /取らない/,
      /使わない/,
      /なし/,
      /北抜き/,
      /続行/,
    ]) {
      if (await clickIfVisible(page, pattern)) return true;
    }
  }
  for (const { page } of players) {
    const tile = page.locator("section.player button.tile-btn:not([disabled])").first();
    if (await tile.isVisible().catch(() => false)) {
      await tile.click();
      return true;
    }
  }
  return false;
}

async function driveToRoundEnd(players: Client[]) {
  for (let step = 0; step < 500; step += 1) {
    const states = await Promise.all(players.map(({ page }) => publicState(page)));
    if (states.every((state) => state.roundEnded)) return states;
    const progressed = await driveOneStep(players);
    await players[0].page.waitForTimeout(progressed ? 80 : 150);
  }
  throw new Error(
    `round did not end: ${JSON.stringify(
      await Promise.all(players.map(({ page }) => publicState(page))),
    )}`,
  );
}

test.describe.serial("Codex R2 online browser adversarial paths", () => {
  test("3 humans advance only after all three press 次局へ", async ({ browser }) => {
    test.setTimeout(180_000);
    const { players } = await startThreeHuman(browser, `R2READY${Date.now()}`);
    try {
      const ended = await driveToRoundEnd(players);
      expect(new Set(ended.map((state) => state.protocol.roundId)).size).toBe(1);
      const oldRoundId = ended[0].protocol.roundId;

      const ready = (page: Page) =>
        // [yuma修正] 押下後は「全員待ち [n/m]」表記に変わる。ready行はpanel裏にも
        // 二重描画されるため、ユーザーが実際に押す agari-unified-panel 内を狙う
        page.locator(".agari-unified-panel").getByRole("button", { name: /次局へ|全員待ち/ }).first();
      await expect(ready(players[0].page)).toBeEnabled();
      await ready(players[0].page).click();
      await expect(ready(players[0].page)).toContainText(/1\/3/);
      await ready(players[1].page).click();
      await expect(ready(players[1].page)).toContainText(/2\/3/);

      await players[0].page.waitForTimeout(500);
      expect((await publicState(players[0].page)).protocol.roundId).toBe(oldRoundId);
      expect((await publicState(players[1].page)).protocol.roundId).toBe(oldRoundId);

      await ready(players[2].page).click();
      await Promise.all(
        players.map(({ page }) =>
          expect
            .poll(async () => (await publicState(page)).protocol.roundId)
            .toBe(oldRoundId + 1),
        ),
      );
      const advanced = await Promise.all(
        players.map(({ page }) => publicState(page)),
      );
      expect(advanced.every((state) => !state.roundEnded)).toBe(true);
    } finally {
      await closeAll(players);
    }
  });

  test("spectator joining mid-round receives public state and no enabled hand action", async ({ browser }) => {
    test.setTimeout(90_000);
    const { roomId, players } = await startThreeHuman(
      browser,
      `R2SPEC${Date.now()}`,
    );
    const spectator = await client(
      browser,
      `R2SPECTATOR${Date.now()}`,
      "R2-spectator",
    );
    try {
      await driveOneStep(players);
      await expect
        .poll(async () => (await publicState(players[0].page)).protocol.revision)
        .toBeGreaterThan(0);
      const reference = await publicState(players[0].page);

      await spectator.page.goto(BASE);
      await spectator.page.locator("button.entry-btn.online").click();
      const row = spectator.page.locator("li.room", { hasText: roomId });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByRole("button", { name: /観戦/ }).click();

      await expect(spectator.page.getByText(/観戦中/).first()).toBeVisible({
        timeout: 20_000,
      });
      await expect(spectator.page.locator("main.mode-single")).toBeVisible();
      const observed = await publicState(spectator.page);
      expect(observed.protocol).toEqual(reference.protocol);
      expect(observed.lunban).toBe(reference.lunban);
      expect(observed.paishu).toBe(reference.paishu);
      expect(observed.defen).toEqual(reference.defen);
      expect(observed.rivers).toEqual(reference.rivers);
      await expect(
        spectator.page.locator("section.player button.tile-btn:not([disabled])"),
      ).toHaveCount(0);
      await expect(
        spectator.page.getByRole("button", { name: /次局へ/ }),
      ).toHaveCount(0);
    } finally {
      await spectator.ctx.close();
      await closeAll(players);
    }
  });

  test("mid-round reload restores the same revision and private hand projection", async ({ browser }) => {
    test.setTimeout(90_000);
    const { roomId, players } = await startThreeHuman(
      browser,
      `R2RELOAD${Date.now()}`,
    );
    try {
      await driveOneStep(players);
      await expect
        .poll(async () => (await publicState(players[0].page)).protocol.revision)
        .toBeGreaterThan(0);

      const reloading = players[1].page;
      const before = await reloading.evaluate(() => {
        const state = (window as any).__game;
        const protocol =
          (window as any).__gameStore?.getOnlineProtocolState?.();
        const hand = state?.game?.shoupai?.get?.(1);
        return {
          protocol,
          publicState: {
            lunban: state.game.state.lunban,
            paishu: state.game.state.paishu,
            defen: [0, 1, 2].map((seat) => state.game.state.defen?.[seat] ?? 0),
          },
          privateHand: JSON.stringify(hand),
        };
      });

      await reloading.reload();
      await expect(reloading.locator("main.mode-single")).toBeVisible({
        timeout: 20_000,
      });
      await expect
        .poll(async () => (await publicState(reloading)).protocol?.revision)
        .toBe(before.protocol.revision);
      const after = await reloading.evaluate(() => {
        const state = (window as any).__game;
        const protocol =
          (window as any).__gameStore?.getOnlineProtocolState?.();
        return {
          protocol,
          publicState: {
            lunban: state.game.state.lunban,
            paishu: state.game.state.paishu,
            defen: [0, 1, 2].map((seat) => state.game.state.defen?.[seat] ?? 0),
          },
          privateHand: JSON.stringify(state?.game?.shoupai?.get?.(1)),
        };
      });
      expect(after).toEqual(before);
      expect(reloading.url()).toContain(`room=${roomId}`);
    } finally {
      await closeAll(players);
    }
  });
});
