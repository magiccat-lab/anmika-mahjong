import { serializeCanonical } from '../src/lib/canonicalJson.ts';

export { serializeCanonical };

export const ROOM_SNAPSHOT_SCHEMA_VERSION = 2 as const;

export type RoomMemberSnapshot = {
  seat: number;
  user_id: string;
  username: string;
  is_cpu: boolean;
};

export type RoomStartSnapshot = {
  preShuffledPool: string[];
  qijia: number;
  members: RoomMemberSnapshot[];
  chipLedger?: Record<string, number>;
};

export type AcceptedRoomCommand = {
  commandId: string;
  revision: number;
  matchId: number;
  roundId: number;
  actorSeat: number;
  fromUserId: string;
  action: Record<string, unknown>;
  acceptedAt: string;
};

export type CanonicalRoomSnapshot = {
  schemaVersion: typeof ROOM_SNAPSHOT_SCHEMA_VERSION;
  roomId: string;
  roomInstanceId: string;
  matchId: number;
  roundId: number;
  revision: number;
  started: boolean;
  start: RoomStartSnapshot | null;
  commands: AcceptedRoomCommand[];
  updatedAt: string;
};

export type ActionCommandEnvelope = {
  type: 'action';
  commandId: string;
  expectedVersion: number;
  matchId: number;
  roundId: number;
  action: Record<string, unknown>;
};

export type CommandAck = {
  type: 'ack';
  commandId: string;
  accepted: true;
  duplicate: boolean;
  revision: number;
  matchId: number;
  roundId: number;
};

export function createEmptyRoomSnapshot(roomId: string, roomInstanceId = ''): CanonicalRoomSnapshot {
  return {
    schemaVersion: ROOM_SNAPSHOT_SCHEMA_VERSION,
    roomId,
    roomInstanceId,
    matchId: 1,
    roundId: 1,
    revision: 0,
    started: false,
    start: null,
    commands: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function parseCanonicalRoomSnapshot(value: string): CanonicalRoomSnapshot {
  const parsed = JSON.parse(value) as Partial<CanonicalRoomSnapshot>;
  const schemaVersion = (parsed as { schemaVersion?: number }).schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== ROOM_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`unsupported room snapshot schema ${String(schemaVersion)}`);
  }
  if (typeof parsed.roomId !== 'string' || !parsed.roomId) throw new Error('snapshot roomId missing');
  if (!Number.isInteger(parsed.revision) || (parsed.revision ?? -1) < 0) throw new Error('snapshot revision invalid');
  if (!Number.isInteger(parsed.matchId) || (parsed.matchId ?? 0) < 1) throw new Error('snapshot matchId invalid');
  if (!Number.isInteger(parsed.roundId) || (parsed.roundId ?? 0) < 1) throw new Error('snapshot roundId invalid');
  if (!Array.isArray(parsed.commands)) throw new Error('snapshot commands invalid');
  return {
    ...(parsed as CanonicalRoomSnapshot),
    schemaVersion: ROOM_SNAPSHOT_SCHEMA_VERSION,
    roomInstanceId: typeof parsed.roomInstanceId === 'string' ? parsed.roomInstanceId : '',
  };
}

export function validateCommandEnvelope(value: unknown): { envelope: ActionCommandEnvelope | null; reason: string | null } {
  if (!value || typeof value !== 'object') return { envelope: null, reason: 'missing command envelope' };
  const msg = value as Record<string, unknown>;
  if (msg.type !== 'action') return { envelope: null, reason: 'command type must be action' };
  if (typeof msg.commandId !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/.test(msg.commandId)) {
    return { envelope: null, reason: 'invalid commandId' };
  }
  if (!Number.isInteger(msg.expectedVersion) || (msg.expectedVersion as number) < 0) {
    return { envelope: null, reason: 'invalid expectedVersion' };
  }
  if (!Number.isInteger(msg.matchId) || (msg.matchId as number) < 1) {
    return { envelope: null, reason: 'invalid matchId' };
  }
  if (!Number.isInteger(msg.roundId) || (msg.roundId as number) < 1) {
    return { envelope: null, reason: 'invalid roundId' };
  }
  if (!msg.action || typeof msg.action !== 'object' || Array.isArray(msg.action)) {
    return { envelope: null, reason: 'invalid action' };
  }
  return { envelope: msg as ActionCommandEnvelope, reason: null };
}

export function appendAcceptedCommand(
  snapshot: CanonicalRoomSnapshot,
  command: Omit<AcceptedRoomCommand, 'revision' | 'matchId' | 'roundId' | 'acceptedAt'>,
  now = new Date(),
): { snapshot: CanonicalRoomSnapshot; command: AcceptedRoomCommand } {
  const accepted: AcceptedRoomCommand = {
    ...command,
    revision: snapshot.revision + 1,
    matchId: snapshot.matchId,
    roundId: snapshot.roundId,
    acceptedAt: now.toISOString(),
  };
  const actionType = accepted.action.type;
  const nextMatchId = actionType === 'nextMatch' ? snapshot.matchId + 1 : snapshot.matchId;
  const nextRoundId = actionType === 'nextMatch'
    ? 1
    : actionType === 'nextRound' ? snapshot.roundId + 1 : snapshot.roundId;
  return {
    command: accepted,
    snapshot: {
      ...snapshot,
      matchId: nextMatchId,
      roundId: nextRoundId,
      revision: accepted.revision,
      commands: [...snapshot.commands, accepted],
      updatedAt: now.toISOString(),
    },
  };
}
