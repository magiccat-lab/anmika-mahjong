// Authoritative WebSocket endpoint. FastAPI issues short-lived JWTs and owns
// lobby/auth HTTP APIs; every gameplay command is accepted only here.

import { randomInt as cryptoRandomInt, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import jwt from 'jsonwebtoken';
import { defaultSanmaRule, generateTilePool } from '../src/lib/shan3';
import { toCorePai } from '../src/lib/helpers';
import { createRoomAuthority, type AuthorityMember, type RoomAuthority } from './authority';
import { RoomPersistence } from './persistence';
import {
  appendAcceptedCommand,
  createEmptyRoomSnapshot,
  validateCommandEnvelope,
  type AcceptedRoomCommand,
  type CanonicalRoomSnapshot,
  type CommandAck,
  type RoomMemberSnapshot,
} from './protocol';

const DEFAULT_PORT = 8791;
const DEFAULT_REACTION_TIMEOUT_MS = 15_000;
const DEFAULT_TURN_TIMEOUT_MS = 60_000;
const DEFAULT_DISCONNECT_GRACE_MS = 30_000;
const DEFAULT_NEXT_ROUND_TIMEOUT_MS = 30_000;

const STAMP_IDS = new Set([
  'shunkashutou', 'kita4', 'konmika', 'shubapotsumo',
  'doko', 'gyakushubatsumo', 'plus', 'saikoro',
]);
const PLAYER_FIELD_ACTIONS = new Set(['ron', 'pass', 'pon', 'damingang']);

type WsTokenPayload = {
  uid: string;
  username?: string;
  seat: number;
  room_id: string;
  room_instance_id: string;
  is_host: boolean;
  iat?: number;
  exp?: number;
};

type Member = RoomMemberSnapshot & {
  ws: WebSocket | null;
  generation: number;
  connected: boolean;
};

type Room = {
  roomId: string;
  hostUserId: string;
  members: Map<string, Member>;
  authority: RoomAuthority | null;
  snapshot: CanonicalRoomSnapshot;
  pendingStart: { qijia: number } | null;
  generation: number;
  queue: Promise<void>;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  nextRoundTimer: ReturnType<typeof setTimeout> | null;
  nextRoundReadyRevision: number | null;
};

export type WsRuntimeOptions = {
  port?: number;
  apiBase?: string;
  wsSecret?: string;
  internalApiSecret?: string;
  persistence?: RoomPersistence;
  reactionTimeoutMs?: number;
  turnTimeoutMs?: number;
  disconnectGraceMs?: number;
  nextRoundTimeoutMs?: number;
  log?: boolean;
};

function normalizeQijia(value: unknown): number {
  return value === 0 || value === 1 || value === 2 ? value : 0;
}

function serverShuffledPool(): string[] {
  const pool = generateTilePool(defaultSanmaRule()).map(String);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = cryptoRandomInt(0, i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function membersForAuthority(room: Room): AuthorityMember[] {
  return Array.from(room.members.values()).map((member) => ({
    seat: member.seat,
    is_cpu: member.is_cpu,
  }));
}

export function restoreAuthority(snapshot: CanonicalRoomSnapshot): RoomAuthority | null {
  if (!snapshot.started || !snapshot.start) return null;
  const authority = createRoomAuthority({
    preShuffledPool: snapshot.start.preShuffledPool,
    qijia: snapshot.start.qijia,
  });
  const members = snapshot.start.members.map((member) => ({ seat: member.seat, is_cpu: member.is_cpu }));
  for (const command of snapshot.commands) {
    if (command.action.type === 'stamp') continue;
    const reason = authority.validateAndApply(command.actorSeat, command.action, members);
    if (reason) {
      throw new Error(`cannot restore room ${snapshot.roomId} at revision ${command.revision}: ${reason}`);
    }
  }
  return authority;
}

function actionRelay(command: AcceptedRoomCommand, snapshot: CanonicalRoomSnapshot, duplicate = false) {
  return {
    type: 'action',
    commandId: command.commandId,
    revision: command.revision,
    matchId: snapshot.matchId,
    roundId: snapshot.roundId,
    from_seat: command.actorSeat,
    from_user_id: command.fromUserId,
    duplicate,
    action: command.action,
  };
}

function sendJson(ws: WebSocket | null, payload: unknown): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch { /* socket closed between check and send */ }
}

function broadcast(room: Room, payload: unknown): void {
  for (const member of room.members.values()) sendJson(member.ws, payload);
}

function sendSync(ws: WebSocket | null, snapshot: CanonicalRoomSnapshot): void {
  sendJson(ws, { type: 'sync', snapshot });
}

function lobbyPayload(room: Room) {
  return {
    type: 'lobby',
    members: Array.from(room.members.values())
      .sort((a, b) => a.seat - b.seat)
      .map(({ seat, user_id, username, is_cpu, connected }) => ({
        seat, user_id, username, is_cpu, connected,
      })),
  };
}

function resolveActorSeat(room: Room, uid: string, seat: number, action: Record<string, unknown>) {
  let actorSeat = seat;
  if (action.cpuRelay === true) {
    if (uid !== room.hostUserId) return { actorSeat, reason: 'cpuRelay requires host' };
    if (typeof action.cpuSeat !== 'number') return { actorSeat, reason: 'cpuRelay requires cpuSeat' };
    const cpu = Array.from(room.members.values()).find(
      (member) => member.seat === action.cpuSeat && member.is_cpu,
    );
    if (!cpu) return { actorSeat, reason: `cpuRelay seat ${String(action.cpuSeat)} is not a CPU member` };
    actorSeat = action.cpuSeat;
  }
  return { actorSeat, reason: null };
}

function validateAction(room: Room, uid: string, seat: number, action: Record<string, unknown>) {
  if (typeof action.type !== 'string') return { actorSeat: seat, reason: 'missing action.type' };
  const actor = resolveActorSeat(room, uid, seat, action);
  if (actor.reason) return actor;
  if (PLAYER_FIELD_ACTIONS.has(action.type)) {
    const target = action.player ?? actor.actorSeat;
    if (target !== actor.actorSeat) {
      return { actorSeat: actor.actorSeat, reason: `${action.type}: player ${String(target)} != actor ${actor.actorSeat}` };
    }
  }
  if (action.type === 'nextMatch' && uid !== room.hostUserId) {
    return { actorSeat: actor.actorSeat, reason: 'nextMatch requires host' };
  }
  if (action.type === 'nextRound'
    && uid !== room.hostUserId
    && actor.actorSeat !== room.authority?.lastWinner) {
    return { actorSeat: actor.actorSeat, reason: 'nextRound requires winner or host' };
  }
  return actor;
}

export function createWsRuntime(options: WsRuntimeOptions = {}) {
  const port = options.port ?? Number(process.env.ANMIKA_WS_PORT || DEFAULT_PORT);
  const apiBase = options.apiBase ?? process.env.ANMIKA_API_BASE ?? 'http://127.0.0.1:8790';
  const wsSecret = options.wsSecret
    ?? process.env.ANMIKA_WS_SECRET
    ?? process.env.ANMIKA_SESSION_SECRET
    ?? '';
  const internalApiSecret = options.internalApiSecret
    ?? process.env.ANMIKA_INTERNAL_SECRET
    ?? wsSecret;
  const persistence = options.persistence ?? new RoomPersistence();
  const reactionTimeoutMs = options.reactionTimeoutMs ?? Number(process.env.ANMIKA_REACTION_TIMEOUT_MS || DEFAULT_REACTION_TIMEOUT_MS);
  const turnTimeoutMs = options.turnTimeoutMs ?? Number(process.env.ANMIKA_TURN_TIMEOUT_MS || DEFAULT_TURN_TIMEOUT_MS);
  const disconnectGraceMs = options.disconnectGraceMs ?? Number(process.env.ANMIKA_DISCONNECT_GRACE_MS || DEFAULT_DISCONNECT_GRACE_MS);
  const nextRoundTimeoutMs = options.nextRoundTimeoutMs ?? Number(process.env.ANMIKA_NEXT_ROUND_TIMEOUT_MS || DEFAULT_NEXT_ROUND_TIMEOUT_MS);
  const logEnabled = options.log ?? process.env.ANMIKA_WS_LOG !== '0';
  const rooms = new Map<string, Room>();
  const log = (...args: unknown[]) => { if (logEnabled) console.log(...args); };
  const warn = (...args: unknown[]) => { if (logEnabled) console.warn(...args); };

  const verifyToken = (token: string): WsTokenPayload | null => {
    if (!wsSecret) return null;
    try {
      const decoded = jwt.verify(token, wsSecret, { algorithms: ['HS256'] });
      if (!decoded || typeof decoded !== 'object') return null;
      const value = decoded as Record<string, unknown>;
      const now = Math.floor(Date.now() / 1000);
      if (typeof value.uid !== 'string' || typeof value.room_id !== 'string'
        || typeof value.room_instance_id !== 'string' || !value.room_instance_id
        || typeof value.seat !== 'number') return null;
      if (typeof value.exp !== 'number' || value.exp <= now) return null;
      if (typeof value.iat !== 'number' || value.iat > now + 30) return null;
      return {
        uid: value.uid,
        username: typeof value.username === 'string' ? value.username : undefined,
        seat: value.seat,
        room_id: value.room_id,
        room_instance_id: value.room_instance_id,
        is_host: value.is_host === true,
        iat: value.iat,
        exp: value.exp,
      };
    } catch { return null; }
  };

  const fetchMembers = async (roomId: string): Promise<RoomMemberSnapshot[]> => {
    if (!internalApiSecret) return [];
    try {
      const response = await fetch(`${apiBase}/api/internal/rooms/${roomId}/members`, {
        headers: { 'X-Anmika-Internal-Secret': internalApiSecret },
      });
      if (!response.ok) return [];
      const data = await response.json() as { members?: Array<Record<string, unknown>> };
      return (data.members ?? [])
        .filter((member) => typeof member.user_id === 'string' && typeof member.seat === 'number')
        .map((member) => ({
          seat: member.seat as number,
          user_id: member.user_id as string,
          username: typeof member.username === 'string' ? member.username : String(member.user_id),
          is_cpu: member.is_cpu === true || String(member.user_id).startsWith('CPU_'),
        }));
    } catch { return []; }
  };

  const getRoom = async (roomId: string, roomInstanceId: string, hostUserId: string): Promise<Room> => {
    const cached = rooms.get(roomId);
    if (cached?.snapshot.roomInstanceId === roomInstanceId) return cached;
    if (cached) {
      if (cached.deadlineTimer) clearTimeout(cached.deadlineTimer);
      if (cached.cleanupTimer) clearTimeout(cached.cleanupTimer);
      if (cached.nextRoundTimer) clearTimeout(cached.nextRoundTimer);
      for (const member of cached.members.values()) member.ws?.close(4002, 'room session replaced');
      rooms.delete(roomId);
    }
    let snapshot = persistence.loadSnapshot(roomId);
    if (!snapshot || snapshot.roomInstanceId !== roomInstanceId) {
      snapshot = createEmptyRoomSnapshot(roomId, roomInstanceId);
      persistence.resetRoom(snapshot);
    }
    const room: Room = {
      roomId,
      hostUserId,
      members: new Map(),
      authority: restoreAuthority(snapshot),
      snapshot,
      pendingStart: null,
      generation: 0,
      queue: Promise.resolve(),
      deadlineTimer: null,
      cleanupTimer: null,
      nextRoundTimer: null,
      nextRoundReadyRevision: null,
    };
    for (const member of snapshot.start?.members ?? []) {
      room.members.set(member.user_id, { ...member, ws: null, generation: 0, connected: false });
    }
    // Publish before the HTTP member lookup so simultaneous sockets share one
    // room object and therefore one command queue.
    rooms.set(roomId, room);
    for (const member of await fetchMembers(roomId)) {
      const previous = room.members.get(member.user_id);
      room.members.set(member.user_id, {
        ...member,
        ws: previous?.ws ?? null,
        generation: previous?.generation ?? 0,
        connected: previous?.connected ?? false,
      });
    }
    return room;
  };

  const reject = (ws: WebSocket | null, room: Room, commandId: string | null, reason: string) => {
    sendJson(ws, {
      type: 'reject',
      commandId,
      reason,
      revision: room.snapshot.revision,
      matchId: room.snapshot.matchId,
      roundId: room.snapshot.roundId,
    });
  };

  const acceptAction = (
    room: Room,
    actorSeat: number,
    fromUserId: string,
    actionInput: Record<string, unknown>,
    commandId: string,
  ): { reason: string | null; command?: AcceptedRoomCommand; ack?: CommandAck } => {
    const previous = room.snapshot;
    const action = { ...actionInput };
    // actorSeat は envelope 検証時に確定済み。中継後は CPU 代理という transport
    // detail を残さず、その席が発した正規 command として全 client に適用させる。
    delete action.cpuRelay;
    delete action.cpuSeat;
    if (action.type === 'stamp') {
      if (!room.snapshot.started) return { reason: 'room is not started' };
      if (typeof action.stampId !== 'string' || !STAMP_IDS.has(action.stampId)) {
        return { reason: 'invalid stampId' };
      }
    } else {
      if (!room.authority) return { reason: 'authority not initialized' };
      if (action.type === 'rollSaiKoroDice') {
        action.override = [cryptoRandomInt(1, 7), cryptoRandomInt(1, 7)];
      }
      if (action.type === 'nextRound' || action.type === 'nextMatch') {
        action.preShuffledPool = serverShuffledPool();
      }
      const reason = room.authority.validateAndApply(actorSeat, action, membersForAuthority(room));
      if (reason) {
        // Validation should be side-effect free on rejection, but rebuilding
        // from the accepted log also contains unexpected reducer exceptions.
        room.authority = restoreAuthority(previous);
        return { reason };
      }
    }

    const appended = appendAcceptedCommand(previous, {
      commandId,
      actorSeat,
      fromUserId,
      action,
    });
    const ack: CommandAck = {
      type: 'ack',
      commandId,
      accepted: true,
      duplicate: false,
      revision: appended.snapshot.revision,
      matchId: appended.snapshot.matchId,
      roundId: appended.snapshot.roundId,
    };
    try {
      persistence.saveAcceptedCommand(appended.snapshot, appended.command, ack);
      room.snapshot = appended.snapshot;
      if (action.type === 'nextRound' || action.type === 'nextMatch') {
        if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
        room.nextRoundTimer = null;
        room.nextRoundReadyRevision = null;
      }
    } catch (error) {
      room.authority = restoreAuthority(previous);
      warn(`[anmika-ws] persistence rollback room=${room.roomId}`, error);
      return { reason: 'persistence failure' };
    }
    return { reason: null, command: appended.command, ack };
  };

  const markReadyForNextRound = (room: Room, actorSeat: number, revision: number): string | null => {
    if (!room.authority?.isPostWinResolved()) return 'round is not safely resolved';
    if (revision !== room.snapshot.revision) return 'version conflict';
    const hostSeat = room.members.get(room.hostUserId)?.seat;
    if (actorSeat !== room.authority.lastWinner && actorSeat !== hostSeat) {
      return 'only winner or host can ready next round';
    }
    if (room.nextRoundReadyRevision === revision && room.nextRoundTimer) return null;
    if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
    room.nextRoundReadyRevision = revision;
    room.nextRoundTimer = setTimeout(() => {
      room.queue = room.queue.then(async () => {
        if (room.snapshot.revision !== revision || !room.authority?.isPostWinResolved()) return;
        const action = { type: 'nextRound', from_role: actorSeat === hostSeat ? 'host' : 'winner' };
        const accepted = acceptAction(
          room,
          actorSeat,
          '__server_next_round__',
          action,
          `srv:${room.roomId}:${room.snapshot.revision + 1}:${randomUUID()}`,
        );
        if (accepted.command) {
          broadcast(room, actionRelay(accepted.command, room.snapshot));
          scheduleRoomDeadline(room);
        }
      }).catch((error) => warn('[anmika-ws] next-round deadline failed', error));
    }, nextRoundTimeoutMs);
    return null;
  };

  const scheduleRoomDeadline = (room: Room): void => {
    if (room.deadlineTimer) clearTimeout(room.deadlineTimer);
    room.deadlineTimer = null;
    const authority = room.authority;
    if (!authority) return;

    const canonical = authority.canonicalState();
    let postWinOwner: number | null = null;
    let postWinAction: Record<string, unknown> | null = null;
    if (canonical.pendingFuyu) {
      postWinOwner = canonical.pendingFuyu.winner;
      postWinAction = { type: 'selectFuyu', use: true };
    } else if (canonical.pendingKinpei) {
      postWinOwner = canonical.pendingKinpei.winner;
      const hua = canonical.pendingKinpei.availableHuapai
        ?? canonical.game.effectiveHuapaiAtHule(postWinOwner as 0 | 1 | 2);
      const target = hua.includes('f4') ? 'fuyu'
        : hua.includes('f3') ? 'aki'
        : hua.includes('f2') ? 'natsu'
        : hua.includes('f1') ? 'haru'
        : null;
      postWinAction = { type: 'selectKinpei', target };
    } else if (canonical.pendingSaiKoro) {
      const pending = canonical.pendingSaiKoro;
      const chance = pending.chances[pending.currentIdx] as any;
      postWinOwner = chance?.winner ?? pending.winner;
      postWinAction = !pending.selectedCombo
        ? { type: 'selectSaiKoroCombo', small: 1, large: 6 }
        : !pending.finalized
          ? { type: 'rollSaiKoroDice' }
          : { type: 'advanceSaiKoro' };
    } else if (canonical.pendingFeverContinue) {
      postWinOwner = canonical.pendingFeverContinue.winner;
      postWinAction = { type: 'continueFever' };
    }
    if (postWinOwner !== null && postWinAction) {
      const owner = Array.from(room.members.values()).find((item) => item.seat === postWinOwner);
      const delay = owner?.is_cpu ? 750 : nextRoundTimeoutMs;
      room.deadlineTimer = setTimeout(() => {
        room.queue = room.queue.then(async () => {
          const live = room.authority;
          if (!live) return;
          const result = acceptAction(
            room,
            postWinOwner!,
            owner?.user_id ?? `deadline-seat-${postWinOwner}`,
            postWinAction!,
            `srv:${room.roomId}:${room.snapshot.revision + 1}:${randomUUID()}`,
          );
          if (result.command) broadcast(room, actionRelay(result.command, room.snapshot));
          scheduleRoomDeadline(room);
        }).catch((error) => warn('[anmika-ws] post-win deadline failed', error));
      }, Math.max(0, delay));
      return;
    }

    if (canonical.roundEnded) return;

    const reactionSeats = new Set<number>();
    for (const player of authority.ronCandidates) reactionSeats.add(player);
    for (const candidate of authority.ponCandidates) reactionSeats.add(candidate.player);
    for (const candidate of authority.kanCandidates) reactionSeats.add(candidate.player);
    if (reactionSeats.size > 0) {
      room.deadlineTimer = setTimeout(() => {
        room.queue = room.queue.then(async () => {
          for (const seat of reactionSeats) {
            const member = Array.from(room.members.values()).find((item) => item.seat === seat);
            if (member?.is_cpu) continue;
            const result = acceptAction(
              room,
              seat,
              member?.user_id ?? `deadline-seat-${seat}`,
              { type: 'pass', player: seat },
              `srv:${room.roomId}:${room.snapshot.revision + 1}:${randomUUID()}`,
            );
            if (result.command) broadcast(room, actionRelay(result.command, room.snapshot));
          }
          scheduleRoomDeadline(room);
        }).catch((error) => warn('[anmika-ws] reaction deadline failed', error));
      }, reactionTimeoutMs);
      return;
    }

    const current = authority.currentPlayer();
    const member = Array.from(room.members.values()).find((item) => item.seat === current);
    const delay = member?.is_cpu ? 750 : member?.connected ? turnTimeoutMs : disconnectGraceMs;
    room.deadlineTimer = setTimeout(() => {
      room.queue = room.queue.then(async () => {
        const live = room.authority;
        if (!live || live.roundEnded || live.currentPlayer() !== current) return;
        let action: Record<string, unknown>;
        if (live.game.canTsumo(current)) action = { type: 'tsumo' };
        else if (live.game.getForcedLizhiKanCandidates(current).length > 0) {
          action = { type: 'declareKan', mianzi: live.game.getForcedLizhiKanCandidates(current)[0] };
        }
        else if (live.lastZimo && toCorePai(live.lastZimo) === 'z4' && live.game.canNukiBei(current)) action = { type: 'nukiBei' };
        else {
          const sp = live.game.shoupai.get(current);
          const pai = live.game.pickBestDiscard(current)
            ?? (typeof sp?._zimo === 'string' && sp._zimo.length <= 2 ? sp._zimo : null)
            ?? ((sp?.get_dapai?.(false) ?? []) as string[]).find((candidate) => toCorePai(candidate.replace(/_$/, '')) !== 'z4')?.replace(/_$/, '');
          if (!pai) return;
          action = { type: 'discard', pai };
        }
        const result = acceptAction(
          room,
          current,
          member?.user_id ?? `deadline-seat-${current}`,
          action,
          `srv:${room.roomId}:${room.snapshot.revision + 1}:${randomUUID()}`,
        );
        if (result.command) broadcast(room, actionRelay(result.command, room.snapshot));
        scheduleRoomDeadline(room);
      }).catch((error) => warn('[anmika-ws] turn deadline failed', error));
    }, Math.max(0, delay));
  };

  const startRoom = (room: Room, qijia: number): void => {
    if (room.snapshot.started) return;
    const members = Array.from(room.members.values())
      .sort((a, b) => a.seat - b.seat)
      .map(({ seat, user_id, username, is_cpu }) => ({ seat, user_id, username, is_cpu }));
    if (members.length < 3) {
      room.pendingStart = { qijia };
      return;
    }
    const now = new Date().toISOString();
    const start = { preShuffledPool: serverShuffledPool(), qijia, members };
    room.authority = createRoomAuthority(start);
    room.snapshot = {
      ...room.snapshot,
      started: true,
      start,
      commands: [],
      revision: 0,
      updatedAt: now,
    };
    persistence.resetRoom(room.snapshot);
    room.pendingStart = null;
    broadcast(room, {
      type: 'start',
      ...start,
      revision: room.snapshot.revision,
      matchId: room.snapshot.matchId,
      roundId: room.snapshot.roundId,
    });
    scheduleRoomDeadline(room);
  };

  const wss = new WebSocketServer({ port });
  log(`[anmika-ws] authoritative endpoint listening on :${port}`);

  wss.on('connection', async (ws, request) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname.match(/^\/ws\/room\/([A-Z0-9]+)$/);
    if (!path) { ws.close(4404, 'invalid path'); return; }
    const roomId = path[1];
    const payload = verifyToken(url.searchParams.get('token') ?? '');
    if (!payload) { ws.close(4401, 'invalid or missing ws token'); return; }
    if (payload.room_id !== roomId) { ws.close(4403, 'token room mismatch'); return; }

    // The WebSocket is already open while the room/member lookup below is
    // awaiting HTTP. Buffer frames immediately so an eager client's first
    // `start` or command cannot disappear before the real handler is attached.
    const earlyMessages: RawData[] = [];
    const bufferEarlyMessage = (data: RawData) => earlyMessages.push(data);
    ws.on('message', bufferEarlyMessage);

    let room: Room;
    try {
      room = await getRoom(roomId, payload.room_instance_id, payload.is_host ? payload.uid : '');
    } catch (error) {
      warn(`[anmika-ws] failed to restore room=${roomId}`, error);
      ws.close(1011, 'room restore failed');
      return;
    }
    if (rooms.get(roomId) !== room || room.snapshot.roomInstanceId !== payload.room_instance_id) {
      ws.close(4002, 'room session replaced');
      return;
    }
    if (!room.hostUserId && payload.is_host) room.hostUserId = payload.uid;
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
    const generation = ++room.generation;
    const previous = room.members.get(payload.uid);
    const member: Member = {
      seat: payload.seat,
      user_id: payload.uid,
      username: payload.username ?? previous?.username ?? payload.uid,
      is_cpu: false,
      ws,
      generation,
      connected: true,
    };
    if (previous?.ws && previous.ws !== ws) previous.ws.close(4001, 'replaced by newer connection');
    room.members.set(payload.uid, member);

    const handleMessage = (data: RawData) => {
      room.queue = room.queue.then(async () => {
        let msg: unknown;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if ((msg as Record<string, unknown>)?.type === 'resync') {
          sendSync(ws, room.snapshot);
          return;
        }
        if ((msg as Record<string, unknown>)?.type === 'start') {
          if (payload.uid !== room.hostUserId) return;
          startRoom(room, normalizeQijia((msg as Record<string, unknown>).qijia));
          return;
        }
        if ((msg as Record<string, unknown>)?.type === 'readyNextRound') {
          const value = msg as Record<string, unknown>;
          const reason = markReadyForNextRound(room, payload.seat, Number(value.revision));
          if (reason) reject(ws, room, null, reason);
          else sendJson(ws, { type: 'readyNextRoundAck', revision: room.snapshot.revision });
          return;
        }

        const checked = validateCommandEnvelope(msg);
        if (!checked.envelope) {
          reject(ws, room, null, checked.reason ?? 'invalid command');
          return;
        }
        const envelope = checked.envelope;
        const priorAck = persistence.findAck(room.roomId, envelope.commandId);
        if (priorAck) {
          sendJson(ws, { ...priorAck, duplicate: true });
          // The retrying client may have missed commands accepted after its
          // original one. A full canonical sync is safe and avoids relaying an
          // old revision with today's match/round identifiers.
          sendSync(ws, room.snapshot);
          return;
        }
        if (envelope.expectedVersion !== room.snapshot.revision
          || envelope.matchId !== room.snapshot.matchId
          || envelope.roundId !== room.snapshot.roundId) {
          reject(ws, room, envelope.commandId, 'version conflict');
          sendSync(ws, room.snapshot);
          return;
        }
        const validated = validateAction(room, payload.uid, payload.seat, envelope.action);
        if (validated.reason) {
          reject(ws, room, envelope.commandId, validated.reason);
          return;
        }
        const accepted = acceptAction(
          room,
          validated.actorSeat,
          payload.uid,
          envelope.action,
          envelope.commandId,
        );
        if (!accepted.command || !accepted.ack) {
          reject(ws, room, envelope.commandId, accepted.reason ?? 'action rejected');
          return;
        }
        broadcast(room, actionRelay(accepted.command, room.snapshot));
        scheduleRoomDeadline(room);
      }).catch((error) => warn(`[anmika-ws] command queue room=${room.roomId}`, error));
    };
    ws.off('message', bufferEarlyMessage);
    ws.on('message', handleMessage);
    for (const data of earlyMessages) handleMessage(data);

    ws.on('close', () => {
      const current = room.members.get(payload.uid);
      if (!current || current.generation !== generation || current.ws !== ws) return;
      current.ws = null;
      current.connected = false;
      broadcast(room, lobbyPayload(room));
      if (Array.from(room.members.values()).every((item) => !item.connected && !item.is_cpu)) {
        room.cleanupTimer = setTimeout(() => {
          const latest = rooms.get(room.roomId);
          if (latest === room && Array.from(room.members.values()).every((item) => !item.connected && !item.is_cpu)) {
            if (room.deadlineTimer) clearTimeout(room.deadlineTimer);
            if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
            rooms.delete(room.roomId);
          }
        }, disconnectGraceMs);
      }
    });

    broadcast(room, lobbyPayload(room));
    if (room.snapshot.started) sendSync(ws, room.snapshot);
    if (!room.snapshot.started && room.pendingStart && room.members.size >= 3) {
      startRoom(room, room.pendingStart.qijia);
    }
  });

  return {
    wss,
    rooms,
    persistence,
    close: async () => {
      for (const room of rooms.values()) {
        if (room.deadlineTimer) clearTimeout(room.deadlineTimer);
        if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
        if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      persistence.close();
    },
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) createWsRuntime();
