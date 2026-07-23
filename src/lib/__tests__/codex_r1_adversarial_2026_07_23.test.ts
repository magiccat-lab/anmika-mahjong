import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { RoomPersistence } from "../../../server/persistence";
import {
  appendAcceptedCommand,
  createEmptyRoomSnapshot,
  type AcceptedRoomCommand,
  type CanonicalRoomSnapshot,
} from "../../../server/protocol";
import { computeRewindPlan, createWsRuntime } from "../../../server/ws_server";

const WS_SECRET = "codex-r1-secret";
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("waitUntil timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function token(
  roomId: string,
  instanceId: string,
  uid: string,
  seat: number,
): string {
  return jwt.sign(
    {
      uid,
      username: uid,
      seat,
      room_id: roomId,
      room_instance_id: instanceId,
      is_host: seat === 0,
      spectator: seat === -1,
    },
    WS_SECRET,
    { algorithm: "HS256", expiresIn: "5m" },
  );
}

async function connectRaw(
  port: number,
  roomId: string,
  instanceId: string,
  uid: string,
  seat: number,
): Promise<WebSocket> {
  const ws = new WebSocket(
    `ws://127.0.0.1:${port}/ws/room/${roomId}?token=${encodeURIComponent(
      token(roomId, instanceId, uid, seat),
    )}`,
  );
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        if (
          ws.readyState === WebSocket.CLOSED ||
          ws.readyState === WebSocket.CLOSING
        ) {
          resolve();
          return;
        }
        ws.once("close", () => resolve());
        ws.close();
      }),
  );
  return ws;
}

function closePromise(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once("close", resolve));
}

function ackFor(
  snapshot: CanonicalRoomSnapshot,
  command: AcceptedRoomCommand,
) {
  return {
    type: "ack" as const,
    commandId: command.commandId,
    accepted: true as const,
    duplicate: false,
    revision: snapshot.revision,
    matchId: snapshot.matchId,
    roundId: snapshot.roundId,
  };
}

describe("Codex R1 adversarial authority/protocol checks", () => {
  it("rewind persistence roundtrip preserves the boundary IDs used by the next append", () => {
    const persistence = new RoomPersistence(":memory:");
    cleanups.push(() => persistence.close());

    const roomId = "codex-r1-rewind";
    let snapshot = createEmptyRoomSnapshot(roomId);
    persistence.resetRoom(snapshot);

    const append = (type: "discard" | "nextRound" | "nextMatch") => {
      const result = appendAcceptedCommand(snapshot, {
        commandId: `cmd-${snapshot.revision + 1}`,
        actorSeat: 0,
        fromUserId: "u0",
        action: { type },
      });
      persistence.saveAcceptedCommand(
        result.snapshot,
        result.command,
        ackFor(result.snapshot, result.command),
      );
      snapshot = result.snapshot;
    };

    append("discard");   // rev 1, match 1 / round 1
    append("nextRound"); // rev 2, match 1 / round 2
    append("discard");   // rev 3, match 1 / round 2
    append("nextMatch"); // rev 4, match 2 / round 1
    append("discard");   // rev 5, match 2 / round 1

    const persisted = persistence.loadCommands(roomId);
    const plan = computeRewindPlan(persisted);
    expect(plan).toEqual({
      keepThrough: 4,
      matchId: 2,
      roundId: 1,
    });

    const loaded = persistence.loadSnapshot(roomId);
    expect(loaded).not.toBeNull();
    const rewound: CanonicalRoomSnapshot = {
      ...loaded!,
      revision: plan!.keepThrough,
      matchId: plan!.matchId,
      roundId: plan!.roundId,
      commands: persisted.filter(
        (command) => command.revision <= plan!.keepThrough,
      ),
    };
    persistence.rewindRoom(rewound, plan!.keepThrough);

    const restored = persistence.loadSnapshot(roomId);
    expect(restored).toMatchObject({
      revision: 4,
      matchId: 2,
      roundId: 1,
    });
    expect(
      persistence.loadCommands(roomId).map((command) => command.revision),
    ).toEqual([1, 2, 3, 4]);

    const postRewind = appendAcceptedCommand(restored!, {
      commandId: "cmd-post-rewind",
      actorSeat: 1,
      fromUserId: "u1",
      action: { type: "discard" },
    });
    expect(postRewind.snapshot).toMatchObject({
      revision: 5,
      matchId: 2,
      roundId: 1,
    });
  });

  it("two concurrent clients sharing a failed room.ready both close, then a retry creates a fresh room", async () => {
    let failRoomInfo = true;
    let roomInfoCalls = 0;
    const api = createServer((req, res) => {
      if (!req.url?.includes("/internal/rooms/")) {
        res.writeHead(404).end();
        return;
      }
      roomInfoCalls += 1;
      setTimeout(() => {
        if (failRoomInfo) {
          res.writeHead(503).end("injected room-info failure");
          return;
        }
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            match_mode: "hanchan",
            members: [
              { user_id: "u0", username: "u0", seat: 0, is_cpu: false },
              { user_id: "u1", username: "u1", seat: 1, is_cpu: false },
              { user_id: "u2", username: "u2", seat: 2, is_cpu: false },
            ],
          }),
        );
      }, 75);
    });
    await new Promise<void>((resolve) =>
      api.listen(0, "127.0.0.1", resolve),
    );
    cleanups.push(
      () => new Promise<void>((resolve) => api.close(() => resolve())),
    );
    const apiPort = (api.address() as AddressInfo).port;

    const runtime = createWsRuntime({
      port: 0,
      apiBase: `http://127.0.0.1:${apiPort}`,
      wsSecret: WS_SECRET,
      internalApiSecret: "internal-secret",
      persistence: new RoomPersistence(":memory:"),
      reactionTimeoutMs: 50,
      turnTimeoutMs: 50,
      disconnectGraceMs: 50,
      log: false,
    });
    cleanups.push(() => runtime.close());
    await new Promise<void>((resolve) => runtime.wss.once("listening", resolve));
    const wsPort = (runtime.wss.address() as AddressInfo).port;

    const roomId = "R1READY";
    const instanceId = "instance-ready";
    const [first, second] = await Promise.all([
      connectRaw(wsPort, roomId, instanceId, "u0", 0),
      connectRaw(wsPort, roomId, instanceId, "u1", 1),
    ]);
    const firstClosed = closePromise(first);
    const secondClosed = closePromise(second);

    await Promise.all([firstClosed, secondClosed]);
    await waitUntil(() => !runtime.rooms.has(roomId));
    expect(roomInfoCalls).toBe(1);

    failRoomInfo = false;
    const retry = await connectRaw(wsPort, roomId, instanceId, "u0", 0);
    await waitUntil(() => runtime.rooms.get(roomId)?.members.size === 3);

    const recovered = runtime.rooms.get(roomId);
    expect(recovered?.matchMode).toBe("hanchan");
    // [yuma修正] room.members は user_id key [seat key ではない]
    expect(recovered?.members.get("u0")?.seat).toBe(0);
    expect(retry.readyState).toBe(WebSocket.OPEN);
    expect(roomInfoCalls).toBeGreaterThanOrEqual(2);
  });

  it("a chip-reset vote cannot survive a true-frame immediately followed by disconnect", async () => {
    const runtime = createWsRuntime({
      port: 0,
      wsSecret: WS_SECRET,
      internalApiSecret: "",
      persistence: new RoomPersistence(":memory:"),
      reactionTimeoutMs: 50,
      turnTimeoutMs: 50,
      disconnectGraceMs: 50,
      log: false,
    });
    cleanups.push(() => runtime.close());
    await new Promise<void>((resolve) => runtime.wss.once("listening", resolve));
    const wsPort = (runtime.wss.address() as AddressInfo).port;

    const roomId = "R1VOTE";
    const instanceId = "instance-vote";
    const clients = await Promise.all([
      connectRaw(wsPort, roomId, instanceId, "u0", 0),
      connectRaw(wsPort, roomId, instanceId, "u1", 1),
      connectRaw(wsPort, roomId, instanceId, "u2", 2),
    ]);
    clients[0].send(JSON.stringify({ type: "start" }));
    await waitUntil(() => Boolean(runtime.rooms.get(roomId)?.authority));

    const room = runtime.rooms.get(roomId)!;
    const canonical = room.authority!.canonicalState();
    canonical.game.state.finished = true;
    canonical.roundEnded = true;

    clients[1].send(JSON.stringify({ type: "chipResetVote", value: true }));
    await waitUntil(() => room.chipResetVotes.has(1));
    clients[1].send(JSON.stringify({ type: "chipResetVote", value: false }));
    await waitUntil(() => !room.chipResetVotes.has(1));
    clients[1].send(JSON.stringify({ type: "chipResetVote", value: true }));
    clients[1].close();

    await waitUntil(() => room.members.get("u1")?.connected === false);
    await room.queue.catch(() => undefined);
    expect(room.chipResetVotes.has(1)).toBe(false);
  });
});
