import { describe, expect, it } from "vitest";

import { createRoomAuthority, type RoomAuthority } from "../../../server/authority";
import {
  captureSeatProjection,
  reactionTimeoutAction,
  turnTimeoutAction,
} from "../../../server/ws_server";
import { defaultSanmaRule, generateTilePool } from "../shan3";

const MEMBERS = [
  { seat: 0, is_cpu: false },
  { seat: 1, is_cpu: false },
  { seat: 2, is_cpu: false },
];

/** Mulberry32: seed and failing step completely reproduce a run. */
function rng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function shuffledPool(random: () => number): string[] {
  const tiles = generateTilePool(defaultSanmaRule()).map(String);
  for (let index = tiles.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [tiles[index], tiles[other]] = [tiles[other], tiles[index]];
  }
  return tiles;
}

function choose<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)];
}

function owner(value: any): number {
  return value?.decisionOwners?.[value.decisionOwnerIndex ?? 0]
    ?? value?.winner
    ?? 0;
}

/**
 * Produce the same kind of safe progress command used by server deadlines.
 * The remaining iterations still inject arbitrary/stale/malformed commands.
 */
function progressAction(
  authority: RoomAuthority,
  random: () => number,
): { actor: number; action: Record<string, unknown> } | null {
  const state: any = authority.canonicalState();
  if (state.pendingFuyu) {
    return {
      actor: owner(state.pendingFuyu),
      action: { type: "selectFuyu", use: false },
    };
  }
  if (state.pendingKinpei) {
    const hua =
      state.pendingKinpei.availableHuapai
      ?? state.game.effectiveHuapaiAtHule(state.pendingKinpei.winner);
    const target = hua.includes("f4")
      ? "fuyu"
      : hua.includes("f3")
        ? "aki"
        : hua.includes("f2")
          ? "natsu"
          : hua.includes("f1")
            ? "haru"
            : null;
    return {
      actor: owner(state.pendingKinpei),
      action: { type: "selectKinpei", target },
    };
  }
  if (state.pendingKamiPochi) {
    return {
      actor: owner(state.pendingKamiPochi),
      action: {
        type: "selectKamiPochi",
        target: state.pendingKamiPochi.candidates?.[0],
        occurrenceKey: state.pendingKamiPochi.occurrenceKey,
      },
    };
  }
  if (state.pendingPochiSwap) {
    return {
      actor: owner(state.pendingPochiSwap),
      action: {
        type: "selectPochiSwap",
        target: state.pendingPochiSwap.candidates?.[0]?.target,
      },
    };
  }
  if (state.pendingSaiKoro) {
    const pending = state.pendingSaiKoro;
    const chance = pending.chances?.[pending.currentIdx ?? 0];
    const actor = chance?.winner ?? pending.winner;
    if (!pending.selectedCombo) {
      return {
        actor,
        action: { type: "selectSaiKoroCombo", small: 1, large: 6 },
      };
    }
    if (!pending.finalized) {
      return {
        actor,
        action: {
          type: "rollSaiKoroDice",
          override: [
            1 + Math.floor(random() * 6),
            1 + Math.floor(random() * 6),
          ],
        },
      };
    }
    return { actor, action: { type: "advanceSaiKoro" } };
  }
  if (state.pendingFeverContinue) {
    return {
      actor: state.pendingFeverContinue.winner,
      action: { type: "continueFever" },
    };
  }
  if (authority.awaitingRonDecision || authority.awaitingFulou) {
    const candidates = [
      ...authority.ronCandidates,
      ...authority.ponCandidates.map((entry) => entry.player),
      ...authority.kanCandidates.map((entry) => entry.player),
    ];
    const actor = candidates[0] ?? ((authority.currentPlayer() + 1) % 3);
    return { actor, action: reactionTimeoutAction(authority, actor) };
  }
  if (state.roundEnded || authority.roundEnded) {
    if (state.game.state.finished) {
      return {
        actor: authority.lastWinner ?? 0,
        action: {
          type: "nextMatch",
          preShuffledPool: shuffledPool(random),
          qijia: Math.floor(random() * 3),
          finalize: true,
          resetChip: false,
        },
      };
    }
    return {
      actor: authority.lastWinner ?? 0,
      action: {
        type: "nextRound",
        preShuffledPool: shuffledPool(random),
      },
    };
  }
  const action = turnTimeoutAction(authority, false);
  return action ? { actor: authority.currentPlayer(), action } : null;
}

function garbageAction(random: () => number): {
  actor: number;
  action: any;
} {
  const actor = Math.floor(random() * 6) - 1;
  const tile = choose(random, [
    "",
    "m1",
    "p0",
    "gp",
    "np3",
    "z4",
    "z9",
    "__proto__",
  ]);
  const action = choose<any>(random, [
    null,
    {},
    { type: "" },
    { type: "unknown", payload: { nested: [1, null, "__proto__"] } },
    { type: "discard", pai: tile },
    { type: "tsumokiri" },
    { type: "drawNext", player: actor },
    { type: "tsumo", player: actor },
    { type: "ron", player: actor },
    { type: "pass", player: actor },
    { type: "pon", player: actor, mianzi: choose(random, ["", "p111+", "z444="]) },
    { type: "damingang", player: actor, mianzi: "p1111+" },
    { type: "declareKan", mianzi: choose(random, ["", "m1111", "z4444"]) },
    { type: "nukiBei", meta: { gold: random() < 0.5 } },
    {
      type: "lizhi",
      opts: {
        open: random() < 0.5,
        shuvari: random() < 0.5,
        fever: random() < 0.5,
      },
    },
    { type: "shuvari", player: actor },
    { type: "selectFuyu", use: choose(random, [true, false, "yes"]) },
    { type: "selectKinpei", target: choose(random, [null, "f1", "__bad__"]) },
    { type: "selectKamiPochi", pai: tile, occurrenceKey: "stale" },
    { type: "selectPochiSwap", target: tile },
    {
      type: "selectSaiKoroCombo",
      small: Math.floor(random() * 10) - 2,
      large: Math.floor(random() * 10) - 2,
    },
    { type: "rollSaiKoroDice", dice: [0, 99] },
    { type: "advanceSaiKoro" },
    { type: "continueFever" },
    { type: "agariyame", accept: random() < 0.5 },
    { type: "nextRound", preShuffledPool: [tile] },
    {
      type: "nextMatch",
      preShuffledPool: [tile],
      qijia: actor,
      finalize: random() < 0.5,
      resetChip: random() < 0.5,
    },
  ]);
  return { actor, action };
}

function fingerprint(authority: RoomAuthority): string {
  return JSON.stringify({
    mirror: {
      current: authority.currentPlayer(),
      lastZimo: authority.lastZimo,
      lastDapai: authority.lastDapai,
      awaitingRonDecision: authority.awaitingRonDecision,
      awaitingFulou: authority.awaitingFulou,
      ronCandidates: authority.ronCandidates,
      ronPassedPlayers: authority.ronPassedPlayers,
      ronDeclaredPlayers: authority.ronDeclaredPlayers,
      ponCandidates: authority.ponCandidates,
      kanCandidates: authority.kanCandidates,
      pendingQianggang: authority.pendingQianggang,
      roundEnded: authority.roundEnded,
      lastWinner: authority.lastWinner,
      lunban: authority.game.state.lunban,
      paishu: authority.game.shan.paishu,
      events: authority.game.events,
    },
    projections: [-1, 0, 1, 2].map((seat) =>
      captureSeatProjection(authority, seat),
    ),
  });
}

function assertFinite(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value), `${path} must be finite`).toBe(true);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assertFinite(child, `${path}.${key}`);
  }
}

function assertInvariants(authority: RoomAuthority, seed: number, step: number) {
  const canonical: any = authority.canonicalState();
  expect(
    canonical.game.state.lunban,
    `seed=${seed} step=${step}: mirror/canonical lunban`,
  ).toBe(authority.game.state.lunban);
  expect(
    canonical.game.shan.paishu,
    `seed=${seed} step=${step}: mirror/canonical paishu`,
  ).toBe(authority.game.shan.paishu);
  expect([0, 1, 2]).toContain(authority.currentPlayer());
  expect(canonical.game.state.defen).toBeTruthy();

  for (const seat of [0, 1, 2]) {
    const projection: any = captureSeatProjection(authority, seat);
    expect(projection.privateHand).not.toBeNull();
    assertFinite(projection);
  }
  const spectator: any = captureSeatProjection(authority, -1);
  expect(spectator.privateHand).toBeNull();
  expect(spectator.store?.lastZimo ?? null).toBeNull();
  expect(spectator.goldHand ?? null).not.toBeTruthy();
  assertFinite(spectator);
}

// [yuma] 8 seed x 500 step は projection bitwise 比較込みで default 5s を超える
describe("Codex R3 seeded RoomAuthority fuzz", { timeout: 300_000 }, () => {
  for (const seed of [
    0x00000001,
    0x0000c0de,
    0x00c0ffee,
    0x12345678,
    0x5eed5eed,
    0x7fffffff,
    0x80000000,
    0xdeadbeef,
  ]) {
    it(`seed 0x${seed.toString(16).padStart(8, "0")}`, () => {
      const random = rng(seed);
      const authority = createRoomAuthority({
        preShuffledPool: shuffledPool(random),
        qijia: Math.floor(random() * 3),
        changshu: random() < 0.5 ? 1 : 2,
      });

      // Stabilize cpuSeats before rejected-state fingerprints begin.
      authority.validateAndApply(-1, { type: "unknown" }, MEMBERS);

      let accepted = 0;
      let rejected = 0;
      for (let step = 0; step < 500; step += 1) {
        const generated =
          random() < 0.48
            ? progressAction(authority, random) ?? garbageAction(random)
            : garbageAction(random);
        const before = fingerprint(authority);
        let reason: string | null | undefined;
        expect(
          () => {
            reason = authority.validateAndApply(
              generated.actor,
              generated.action,
              MEMBERS,
            );
          },
          `seed=${seed} step=${step} actor=${generated.actor} action=${JSON.stringify(generated.action)}`,
        ).not.toThrow();

        if (reason === null) {
          accepted += 1;
        } else {
          rejected += 1;
          expect(
            fingerprint(authority),
            `rejected command mutated state; seed=${seed} step=${step} reason=${reason} action=${JSON.stringify(generated.action)}`,
          ).toBe(before);
        }
        assertInvariants(authority, seed, step);
      }
      expect(accepted, `seed=${seed}: fuzz must exercise accepted path`).toBeGreaterThan(20);
      expect(rejected, `seed=${seed}: fuzz must exercise rejected path`).toBeGreaterThan(20);
    });
  }
});
