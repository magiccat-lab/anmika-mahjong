import { serializeCanonical } from '../src/lib/canonicalJson.ts';

export { serializeCanonical };

export const ROOM_SNAPSHOT_SCHEMA_VERSION = 3 as const;

export type RoomMemberSnapshot = {
  seat: number;
  user_id: string;
  username: string;
  is_cpu: boolean;
};

/** [2026-07-23 4人回し Phase2] room seat ↔ game seat の対応。
 *  Game3/authority は純3席のまま、ws 層だけがこの写像を知る。
 *  3人部屋 [rotation 無効] は mapping 自体を持たない [null/undefined]。 */
export type RoomSeatMapping = {
  /** gameSeat (0..2) → roomSeat (0..3) */
  gameToRoom: [number, number, number];
  /** 抜け番の roomSeat */
  inactiveRoomSeat: number;
};

export type RoomStartSnapshot = {
  preShuffledPool: string[];
  qijia: number;
  /** active trio 専用 [game seat 契約]。4人目 [抜け番] は混ぜない */
  members: RoomMemberSnapshot[];
  chipLedger?: Record<string, number>;
  // [2026-07-23 changshu protocol] 東風=1 / 半荘=2 [部屋作成時の match_mode 由来]
  changshu?: number;
  // [2026-07-23 4人回し Phase2] rotation 部屋のみ。3人部屋は全て undefined のまま
  rotationEnabled?: boolean;
  /** room seat 契約の全員 [rotation 部屋は 4 entries]。members とは契約が違うので分離 */
  roomMembers?: RoomMemberSnapshot[];
  /** 試合1の mapping [rotation 決定則の初期値] */
  initialMapping?: RoomSeatMapping;
  /** room seat キーの初期 4-way ledger [通常は全 0] */
  roomChipLedger?: Record<string, number>;
};

export type SerializedOnlineHand = {
  bingpai: {
    _: number;
    m: number[];
    p: number[];
    s: number[];
    z: number[];
    anmika: Record<string, number> | null;
  };
  fulou: string[];
  zimo: string | null;
  anmikaZimo: string | null;
  anmikaFulou: unknown[];
  anmikaFulouPhysical: unknown[];
};

/** Seat-scoped authoritative wire state; hidden tiles exist only in privateHand. */
export type OnlineSeatProjection = {
  schemaVersion: 1;
  recipientSeat: number;
  // [2026-07-23 changshu protocol] 部屋の対局設定 [client hydrate の source of truth]
  gameConfig?: { changshu: number };
  gameState: Record<string, unknown>;
  shan: {
    paishu: number;
    baopai: string[];
    fubaopai: string[] | null;
    kanDoraCount: number;
    rinshanUsed: number;
    /** Whether the hidden reserve contains a non-flower replacement tile. */
    canDrawRinshan: boolean;
    fuyuRevealed: string[];
  };
  privateHand: SerializedOnlineHand | null;
  publicHands: Record<number, {
    concealedCount: number;
    /** True only for a real 2/3-character draw tile. */
    hasZimo: boolean;
    /** A post-call pseudo-zimo is a public meld string, never a concealed tile. */
    pseudoZimo: string | null;
    fulou: string[];
    anmikaFulou: unknown[];
    anmikaFulouPhysical: unknown[];
    revealedHand: SerializedOnlineHand | null;
    /** Physical matching tiles exposed by confirmed FEVER (duplicates retained). */
    revealedWaitTiles: string[];
  }>;
  rivers: Record<number, string[]>;
  publicEvents: Array<Record<string, unknown>>;
  fields: Record<string, unknown>;
  store: Record<string, unknown>;
};

export type AcceptedRoomCommand = {
  commandId: string;
  revision: number;
  matchId: number;
  roundId: number;
  /** canonical replay 用 game seat 契約 [restoreAuthority がこのまま validateAndApply に渡す] */
  actorSeat: number;
  /** [2026-07-23 4人回し Phase2] 発話者の room seat [表示/監査用。replay には使わない] */
  actorRoomSeat?: number;
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
  // [2026-07-23 4人回し Phase2] 現在の mapping / room ledger [appendAcceptedCommand が進める]
  activeMapping?: RoomSeatMapping | null;
  roomChipLedger?: Record<string, number>;
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
  // v1/v2 は rotation field 無しの旧 snapshot [全 field optional なのでそのまま読める]
  if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== ROOM_SNAPSHOT_SCHEMA_VERSION) {
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

/** [2026-07-23 4人回し Phase2] 1 command 分の room ledger / mapping 遷移。
 *  live accept [appendAcceptedCommand] と rewind/restore の再 fold が同じ規則を共有する。
 *  delta は accept 時点の mapping で room seat へ写像済みの値が action に焼かれている前提
 *  [mapping が後で回っても過去 command の再解釈が要らない]。 */
export function applyRoomChipCommand(
  ledger: Record<string, number> | undefined,
  mapping: RoomSeatMapping | null | undefined,
  action: Record<string, unknown>,
): { ledger: Record<string, number> | undefined; mapping: RoomSeatMapping | null | undefined } {
  let nextLedger = ledger;
  let nextMapping = mapping;
  const delta = (action as { _roomChipDelta?: Record<string, number> })._roomChipDelta;
  if (delta && typeof delta === 'object') {
    nextLedger = { ...(nextLedger ?? {}) };
    for (const [seat, value] of Object.entries(delta)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      nextLedger[seat] = (nextLedger[seat] ?? 0) + value;
    }
  }
  if (action.type === 'nextMatch') {
    // 全員同意チップリセットは game ledger と同じ境界で room ledger も 0 に戻す
    if (action.resetChip === true && nextLedger) {
      nextLedger = Object.fromEntries(Object.keys(nextLedger).map((seat) => [seat, 0]));
    }
    // rotation 決定則 [Phase4] が server 決定値を action に焼く。境界は matchId 増加 command のみ
    const burned = (action as { _nextMapping?: RoomSeatMapping })._nextMapping;
    if (burned && typeof burned === 'object') nextMapping = burned;
  }
  return { ledger: nextLedger, mapping: nextMapping };
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
  // [2026-07-23 4人回し Phase2] room ledger / mapping は command 適用と同一 snapshot 遷移で進める
  const folded = applyRoomChipCommand(snapshot.roomChipLedger, snapshot.activeMapping, accepted.action);
  return {
    command: accepted,
    snapshot: {
      ...snapshot,
      matchId: nextMatchId,
      roundId: nextRoundId,
      revision: accepted.revision,
      commands: [],
      updatedAt: now.toISOString(),
      ...(folded.ledger !== undefined ? { roomChipLedger: folded.ledger } : {}),
      ...(folded.mapping !== undefined ? { activeMapping: folded.mapping } : {}),
    },
  };
}
