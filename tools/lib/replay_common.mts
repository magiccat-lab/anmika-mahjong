// anmika-mahjong バグ再現ツール 共通部品 [2026-09-02 yuma]
//
// - websocket store [data/anmika.sqlite3] を read-only で開く。本番パスは --allow-live 無しでは拒否する
// - room_state_snapshots / room_accepted_commands の読み出し [server/persistence.ts loadCommands と同じ整形]
// - 権威 state の要約 [replay_room / scan_rooms / hydrate_check 共用]
//
// 使い方は docs/bug_replay_tools.md 参照。このモジュール自体は CLI ではない。
import { DatabaseSync } from 'node:sqlite';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCanonicalRoomSnapshot,
  type AcceptedRoomCommand,
  type CanonicalRoomSnapshot,
  type CommandAck,
} from '../../server/protocol.ts';
import type { RoomAuthority } from '../../server/authority.ts';
import type { StoreState } from '../../src/lib/store.ts';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 引数エラー等、stack trace 無しで usage を出して終わらせたい失敗 */
export class UsageError extends Error {}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** 本番 store 判定。repo の data/ と server/data/ 配下、および ANMIKA_DB_PATH を live 扱いにする */
export function isLiveDbPath(path: string): boolean {
  const abs = safeRealpath(resolve(path));
  const liveDirs = [resolve(REPO_ROOT, 'data'), resolve(REPO_ROOT, 'server', 'data')].map(safeRealpath);
  if (liveDirs.some((dir) => abs === dir || abs.startsWith(dir + sep))) return true;
  const envPath = process.env.ANMIKA_DB_PATH;
  return !!envPath && envPath !== ':memory:' && safeRealpath(resolve(envPath)) === abs;
}

export type OpenOptions = { allowLive?: boolean };

/** store を read-only で開く。WAL の -shm は SQLite が触るので、既定では本番ファイルを拒否する */
export function openStoreReadOnly(path: string | undefined, opts: OpenOptions = {}): DatabaseSync {
  if (!path) throw new UsageError('--db <path> is required');
  if (!existsSync(path)) throw new UsageError(`db not found: ${path}`);
  if (isLiveDbPath(path) && !opts.allowLive) {
    throw new UsageError(
      `refusing to open the live store: ${path}\n`
      + '  copy it first [cp data/anmika.sqlite3 data/anmika.sqlite3-wal data/anmika.sqlite3-shm <scratch>/]'
      + ' and point --db at the copy,\n'
      + '  or pass --allow-live to open the live file read-only',
    );
  }
  return new DatabaseSync(path, { readOnly: true });
}

export type SnapshotRow = {
  room_id: string;
  schema_version: number;
  revision: number;
  updated_at: string;
  snapshot_json: string;
};

export type CommandRow = {
  command_id: string;
  revision: number;
  actor_seat: number;
  action_json: string;
  ack_json: string;
  accepted_at: string;
};

export type LoadedRoom = {
  roomId: string;
  snapshot: CanonicalRoomSnapshot;
  snapshotRow: SnapshotRow;
  /** --upto 適用後の行 [revision 昇順] */
  rows: CommandRow[];
  /** store にある全行 [revision 昇順] */
  allRows: CommandRow[];
  /** rows を restoreAuthority に渡す形に整形したもの */
  commands: AcceptedRoomCommand[];
};

export function listRoomIds(db: DatabaseSync): string[] {
  const rows = db.prepare('SELECT room_id FROM room_state_snapshots ORDER BY updated_at ASC').all() as Array<{ room_id: string }>;
  return rows.map((row) => row.room_id);
}

export function loadSnapshotRow(db: DatabaseSync, roomId: string): SnapshotRow | null {
  const row = db.prepare(
    'SELECT room_id, schema_version, revision, updated_at, snapshot_json FROM room_state_snapshots WHERE room_id=?',
  ).get(roomId) as SnapshotRow | undefined;
  return row ?? null;
}

export function loadCommandRows(db: DatabaseSync, roomId: string): CommandRow[] {
  return db.prepare(
    'SELECT command_id, revision, actor_seat, action_json, ack_json, accepted_at FROM room_accepted_commands WHERE room_id=? ORDER BY revision ASC',
  ).all(roomId) as CommandRow[];
}

/** server/persistence.ts RoomPersistence.loadCommands と同じ整形 [matchId/roundId は replay に使わないので 0] */
export function rowToCommand(row: CommandRow): AcceptedRoomCommand {
  return {
    commandId: row.command_id,
    revision: row.revision,
    actorSeat: row.actor_seat,
    fromUserId: '',
    action: JSON.parse(row.action_json) as Record<string, unknown>,
    matchId: 0,
    roundId: 0,
    acceptedAt: row.accepted_at,
  };
}

export function parseAck(row: CommandRow): CommandAck | null {
  try {
    return JSON.parse(row.ack_json) as CommandAck;
  } catch {
    return null;
  }
}

export function loadRoom(db: DatabaseSync, roomId: string, opts: { upto?: number } = {}): LoadedRoom | null {
  const snapshotRow = loadSnapshotRow(db, roomId);
  if (!snapshotRow) return null;
  const snapshot = parseCanonicalRoomSnapshot(snapshotRow.snapshot_json);
  const allRows = loadCommandRows(db, roomId);
  const rows = opts.upto === undefined ? allRows : allRows.filter((row) => row.revision <= opts.upto!);
  return { roomId, snapshot, snapshotRow, rows, allRows, commands: rows.map(rowToCommand) };
}

/** restoreAuthority と同じ member 整形 [game seat 契約の active trio] */
export function membersForReplay(snapshot: CanonicalRoomSnapshot): Array<{ seat: number; is_cpu: boolean }> {
  return (snapshot.start?.members ?? []).map((member) => ({ seat: member.seat, is_cpu: member.is_cpu }));
}

export function parseRevisionOption(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`${name} must be a non-negative integer, got ${value}`);
  return n;
}

/**
 * restoreAuthority が throw した時に、失敗する最小 prefix を二分探索する。
 * replay は preShuffledPool から決定論的にやり直すので「prefix n で落ちるなら n 以上でも落ちる」が成り立つ。
 * 戻り値の revision は最初に失敗する command の revision [0 = start snapshot だけで落ちる]。
 */
export function bisectFailingRevision(
  snapshot: CanonicalRoomSnapshot,
  commands: AcceptedRoomCommand[],
  restore: (snapshot: CanonicalRoomSnapshot, commands: AcceptedRoomCommand[]) => unknown,
): { revision: number; error: string } | null {
  const throwsAt = (n: number): string | null => {
    try {
      restore(snapshot, commands.slice(0, n));
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  };
  const atStart = throwsAt(0);
  if (atStart !== null) return { revision: 0, error: atStart };
  let hi = commands.length;
  let hiError = throwsAt(hi);
  if (hiError === null) return null;
  let lo = 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const error = throwsAt(mid);
    if (error === null) lo = mid;
    else {
      hi = mid;
      hiError = error;
    }
  }
  return { revision: commands[hi - 1].revision, error: hiError };
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

export function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) return [...value];
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}

export function toJson(value: unknown, space?: number): string {
  return JSON.stringify(value, jsonReplacer, space);
}

/** Game3 内部ログ [dlog 等] が stdout を汚さないよう、console.log を stderr に逃がす */
export function routeConsoleLogToStderr(): void {
  console.log = (...args: unknown[]) => {
    process.stderr.write(args.map((a) => (typeof a === 'string' ? a : toJson(a))).join(' ') + '\n');
  };
}

// ---------------------------------------------------------------------------
// state summaries
// ---------------------------------------------------------------------------

export const PENDING_KEYS = [
  'pendingFuyu',
  'pendingKinpei',
  'pendingKamiPochi',
  'pendingPochiSwap',
  'pendingFeverContinue',
  'pendingSaiKoro',
  'pendingPingju',
  'pendingQianggang',
  'pendingNukiBei',
] as const;

export type PendingKey = typeof PENDING_KEYS[number];

/** 各 pending* を識別子だけに縮めた要約 [null / false はそのまま] */
export function summarizePending(state: StoreState): Record<PendingKey, unknown> {
  const out = {} as Record<PendingKey, unknown>;
  for (const key of PENDING_KEYS) {
    const value = (state as unknown as Record<string, unknown>)[key];
    if (value === null || value === undefined || value === false) {
      out[key] = value ?? null;
      continue;
    }
    if (typeof value !== 'object') {
      out[key] = value;
      continue;
    }
    const v = value as Record<string, unknown>;
    switch (key) {
      case 'pendingSaiKoro':
        out[key] = {
          winner: v.winner,
          currentIdx: v.currentIdx,
          chances: Array.isArray(v.chances) ? v.chances.length : null,
          finalized: v.finalized ?? null,
        };
        break;
      case 'pendingPochiSwap':
        out[key] = { winner: v.winner, kind: v.kind ?? null };
        break;
      case 'pendingKinpei':
        out[key] = { winner: v.winner, availableHuapai: v.availableHuapai ?? null, otherWinners: v.otherWinners ?? null };
        break;
      case 'pendingFuyu':
        out[key] = { winner: v.winner, decisionOwners: v.decisionOwners ?? null, otherWinners: v.otherWinners ?? null };
        break;
      case 'pendingQianggang':
        out[key] = { player: v.player, mianzi: v.mianzi, kakanPai: v.kakanPai };
        break;
      default:
        out[key] = pickKeys(v, ['winner', 'player', 'isRon', 'ronfrom', 'meta', 'kind']);
    }
  }
  return out;
}

export function activePendingKeys(state: StoreState): PendingKey[] {
  return PENDING_KEYS.filter((key) => {
    const value = (state as unknown as Record<string, unknown>)[key];
    return value !== null && value !== undefined && value !== false;
  });
}

function pickKeys(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (key in value) out[key] = value[key];
  return out;
}

export type GameSummary = {
  changbang: number;
  jushu: number;
  benbang: number;
  lizhibang: number;
  qijia: number;
  lunban: number;
  finished: boolean;
  tongaeshi: boolean;
  currentPlayer: number;
  currentOya: number;
  changshu: number;
  defen: Record<number, number>;
  chipLedger: Record<number, number>;
  paishu: number | null;
  baopai: string[];
  fubaopai: string[] | null;
  lizhi: number[];
  feverActive: Record<number, boolean>;
};

export function summarizeGame(authority: RoomAuthority): GameSummary {
  const g = authority.canonicalState().game;
  const st = g.state;
  return {
    changbang: st.changbang,
    jushu: st.jushu,
    benbang: st.benbang,
    lizhibang: st.lizhibang,
    qijia: st.qijia,
    lunban: st.lunban,
    finished: !!st.finished,
    tongaeshi: !!st.tongaeshi,
    currentPlayer: g.lunbanToPlayerId(st.lunban),
    currentOya: g.currentOya,
    changshu: g.changshu,
    defen: { ...st.defen },
    chipLedger: { ...g.chipLedger },
    paishu: safeNumber(() => g.shan.paishu),
    baopai: safeArray(() => [...g.shan.baopai]),
    fubaopai: safeNullable(() => (g.shan.fubaopai ? [...g.shan.fubaopai] : null)),
    lizhi: [...g.lizhi],
    feverActive: { ...g.feverActive },
  };
}

export type FlagSummary = {
  roundEnded: boolean;
  lastWinner: number | null;
  lastZimo: string | null;
  lastDapai: { player: number; pai: string } | null;
  message: string | null;
  cpuWinAck: boolean;
  awaitingRonDecision: boolean;
  awaitingFulou: boolean;
  /** 権威 mirror のロン候補 [canonical store は候補を持たない] */
  ronCandidates: number[];
  ponCandidates: unknown[];
  kanCandidates: unknown[];
  ronPassedPlayers: number[];
  ronDeclaredPlayers: number[];
  ronResults: number;
  lizhiPending: number | null;
  lizhiPendingFlags: unknown;
  pendingQianggangMirror: unknown;
  isPostWinResolved: boolean;
  lastHuleResult: { player: unknown; defen: unknown; fanshu: unknown } | null;
};

export function summarizeFlags(authority: RoomAuthority): FlagSummary {
  const c = authority.canonicalState();
  return {
    roundEnded: c.roundEnded,
    lastWinner: c.lastWinner,
    lastZimo: c.lastZimo,
    lastDapai: c.lastDapai,
    message: c.message,
    cpuWinAck: c.cpuWinAck,
    awaitingRonDecision: c.awaitingRonDecision,
    awaitingFulou: c.awaitingFulou,
    ronCandidates: [...authority.ronCandidates],
    ponCandidates: c.ponCandidates,
    kanCandidates: c.kanCandidates,
    ronPassedPlayers: c.ronPassedPlayers,
    ronDeclaredPlayers: c.ronDeclaredPlayers,
    ronResults: c.ronResults.length,
    lizhiPending: c.lizhiPending,
    lizhiPendingFlags: c.lizhiPendingFlags ?? null,
    pendingQianggangMirror: authority.pendingQianggang,
    isPostWinResolved: authority.isPostWinResolved(),
    lastHuleResult: c.lastHuleResult
      ? { player: c.lastHuleResult.player, defen: c.lastHuleResult.defen, fanshu: c.lastHuleResult.fanshu }
      : null,
  };
}

/** action を type + 主要 field だけに縮める [牌山などの巨大 field は長さに置換] */
export function actionBrief(action: Record<string, unknown>): Record<string, unknown> {
  const brief: Record<string, unknown> = { type: action.type };
  for (const key of ['pai', 'player', 'mianzi', 'small', 'large', 'override', 'from_role', 'use', 'target', 'opts', 'meta', 'stampId']) {
    if (key in action) brief[key] = action[key];
  }
  if (Array.isArray(action.preShuffledPool)) brief.preShuffledPool = `[${action.preShuffledPool.length}]`;
  if (action._roomChipDelta) brief._roomChipDelta = action._roomChipDelta;
  const draw = action._draw as Record<string, unknown> | undefined;
  if (draw) brief._draw = { player: draw.player, lastZimo: draw.lastZimo, paishu: draw.paishu, pochi: draw.pochi, gold: draw.gold };
  return brief;
}

export function fmtDefen(record: Record<number, number>): string {
  return [0, 1, 2].map((p) => `${p}=${record[p] ?? '?'}`).join(' ');
}

function safeNumber(fn: () => number): number | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function safeArray(fn: () => string[]): string[] {
  try {
    return fn();
  } catch {
    return [];
  }
}

function safeNullable<T>(fn: () => T | null): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
