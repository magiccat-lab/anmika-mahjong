// tools/replay_room.mts [2026-09-02 yuma]
// websocket store [room_state_snapshots + room_accepted_commands] から部屋の権威状態を復元して要約する。
//
//   npx tsx tools/replay_room.mts --db <copy.sqlite3> --room 6U1V [--upto <revision>] [--json]
//
// exit code: 0 = 復元成功 / 1 = 引数・部屋なし / 2 = restoreAuthority が throw [失敗 revision を二分探索して表示]
import { parseArgs } from 'node:util';
import { restoreAuthority } from '../server/ws_server.ts';
import type { RoomAuthority } from '../server/authority.ts';
import {
  UsageError,
  actionBrief,
  bisectFailingRevision,
  errorMessage,
  fmtDefen,
  loadRoom,
  openStoreReadOnly,
  parseAck,
  parseRevisionOption,
  routeConsoleLogToStderr,
  summarizeFlags,
  summarizeGame,
  summarizePending,
  toJson,
  type LoadedRoom,
} from './lib/replay_common.mts';

const HELP = `replay_room: restore one online room from the websocket store and print its canonical state

usage: npx tsx tools/replay_room.mts --db <path> --room <ROOM> [--upto <revision>] [--json] [--allow-live]

  --db <path>        sqlite store [copy of data/anmika.sqlite3; keep -wal/-shm next to it]
  --room <ROOM>      room id [e.g. 6U1V]
  --upto <revision>  replay only accepted commands with revision <= N
  --json             print one JSON object instead of text
  --allow-live       allow opening the live store under data/ [read-only; default refuses]
  -h, --help         this help

exit code 0 ok / 1 usage or room not found / 2 restore threw [failing revision found by bisecting]
`;

type Report = {
  room: string;
  schemaVersion: number;
  headRevision: number;
  replayedThrough: number | null;
  commandCount: number;
  upto: number | null;
  snapshot: {
    matchId: number;
    roundId: number;
    started: boolean;
    updatedAt: string;
    roomInstanceId: string;
    qijia: number | null;
    changshu: number | null;
    members: Array<{ seat: number; username: string; is_cpu: boolean }>;
    activeMapping: unknown;
    roomChipLedger: unknown;
  };
  lastAck: { matchId: number; roundId: number; revision: number } | null;
  game: ReturnType<typeof summarizeGame>;
  flags: ReturnType<typeof summarizeFlags>;
  pending: ReturnType<typeof summarizePending>;
  lastCommands: Array<{ revision: number; actor: number; type: unknown; acceptedAt: string; brief: Record<string, unknown> }>;
};

function buildReport(room: LoadedRoom, authority: RoomAuthority, upto: number | undefined): Report {
  const { snapshot } = room;
  const lastRow = room.rows.at(-1);
  const lastAck = lastRow ? parseAck(lastRow) : null;
  return {
    room: room.roomId,
    schemaVersion: room.snapshotRow.schema_version,
    headRevision: snapshot.revision,
    replayedThrough: lastRow?.revision ?? null,
    commandCount: room.rows.length,
    upto: upto ?? null,
    snapshot: {
      matchId: snapshot.matchId,
      roundId: snapshot.roundId,
      started: snapshot.started,
      updatedAt: snapshot.updatedAt,
      roomInstanceId: snapshot.roomInstanceId,
      qijia: snapshot.start?.qijia ?? null,
      changshu: snapshot.start?.changshu ?? null,
      members: (snapshot.start?.members ?? []).map((m) => ({ seat: m.seat, username: m.username, is_cpu: m.is_cpu })),
      activeMapping: snapshot.activeMapping ?? null,
      roomChipLedger: snapshot.roomChipLedger ?? null,
    },
    lastAck: lastAck ? { matchId: lastAck.matchId, roundId: lastAck.roundId, revision: lastAck.revision } : null,
    game: summarizeGame(authority),
    flags: summarizeFlags(authority),
    pending: summarizePending(authority.canonicalState()),
    lastCommands: room.rows.slice(-8).map((row) => {
      const action = JSON.parse(row.action_json) as Record<string, unknown>;
      return { revision: row.revision, actor: row.actor_seat, type: action.type, acceptedAt: row.accepted_at, brief: actionBrief(action) };
    }),
  };
}

function printText(r: Report): void {
  const out = (line: string) => process.stdout.write(line + '\n');
  const uptoLabel = r.upto === null ? '' : ` [--upto ${r.upto}]`;
  out(`room ${r.room}  schema ${r.schemaVersion}  head revision ${r.headRevision}  replayed ${r.commandCount} commands through revision ${r.replayedThrough ?? '-'}${uptoLabel}`);
  out(`snapshot: matchId ${r.snapshot.matchId}  roundId ${r.snapshot.roundId}  started ${r.snapshot.started}  updatedAt ${r.snapshot.updatedAt}  instance ${r.snapshot.roomInstanceId || '-'}`);
  out(`members: ${r.snapshot.members.map((m) => `seat${m.seat} ${m.username}${m.is_cpu ? ' [cpu]' : ''}`).join(' | ')}  qijia ${r.snapshot.qijia ?? '-'}  changshu ${r.snapshot.changshu ?? '-'}`);
  if (r.snapshot.activeMapping || r.snapshot.roomChipLedger) {
    out(`rotation: activeMapping ${toJson(r.snapshot.activeMapping)}  roomChipLedger ${toJson(r.snapshot.roomChipLedger)}`);
  }
  out(`last ack: ${r.lastAck ? `matchId ${r.lastAck.matchId}  roundId ${r.lastAck.roundId}  revision ${r.lastAck.revision}` : '-'}`);
  const g = r.game;
  out(`game: changbang ${g.changbang}  jushu ${g.jushu}  benbang ${g.benbang}  lizhibang ${g.lizhibang}  finished ${g.finished}  tongaeshi ${g.tongaeshi}  changshu ${g.changshu}`);
  out(`      lunban ${g.lunban}  currentPlayer ${g.currentPlayer}  currentOya ${g.currentOya}  paishu ${g.paishu ?? '-'}  baopai ${g.baopai.join(',') || '-'}  fubaopai ${g.fubaopai ? g.fubaopai.join(',') || '-' : '-'}`);
  out(`defen: ${fmtDefen(g.defen)}   chipLedger: ${fmtDefen(g.chipLedger)}`);
  out(`lizhi: ${g.lizhi.length ? g.lizhi.join(',') : '-'}  feverActive: ${[0, 1, 2].filter((p) => g.feverActive[p]).join(',') || '-'}`);
  const f = r.flags;
  out(`awaiting: ron=${f.awaitingRonDecision} fulou=${f.awaitingFulou}   lizhiPending: ${f.lizhiPending ?? 'null'}${f.lizhiPendingFlags ? ' ' + toJson(f.lizhiPendingFlags) : ''}`);
  out(`candidates: ron=${toJson(f.ronCandidates)} pon=${toJson(f.ponCandidates)} kan=${toJson(f.kanCandidates)}  passed=${toJson(f.ronPassedPlayers)} declared=${toJson(f.ronDeclaredPlayers)} ronResults=${f.ronResults}`);
  const active = Object.entries(r.pending).filter(([, v]) => v !== null && v !== false);
  out(`pending: ${active.length ? active.map(([k, v]) => `${k}=${toJson(v)}`).join('  ') : '[none]'}`);
  if (f.pendingQianggangMirror) out(`pendingQianggang [mirror]: ${toJson(f.pendingQianggangMirror)}`);
  out(`roundEnded ${f.roundEnded}  lastWinner ${f.lastWinner ?? 'null'}  lastZimo ${f.lastZimo ?? 'null'}  lastDapai ${f.lastDapai ? toJson(f.lastDapai) : 'null'}  cpuWinAck ${f.cpuWinAck}`);
  out(`lastHuleResult: ${f.lastHuleResult ? toJson(f.lastHuleResult) : 'null'}`);
  out(`message: ${f.message ?? 'null'}`);
  out(`isPostWinResolved: ${f.isPostWinResolved}`);
  out(`last ${r.lastCommands.length} commands:`);
  for (const c of r.lastCommands) {
    const extra = Object.entries(c.brief).filter(([k]) => k !== 'type').map(([k, v]) => `${k}=${toJson(v)}`).join(' ');
    out(`  rev ${String(c.revision).padStart(4)}  seat ${c.actor}  ${String(c.type).padEnd(20)} ${c.acceptedAt}  ${extra}`);
  }
}

function main(): number {
  let values: { db?: string; room?: string; upto?: string; json: boolean; 'allow-live': boolean; help: boolean };
  try {
    values = parseArgs({
      options: {
        db: { type: 'string' },
        room: { type: 'string' },
        upto: { type: 'string' },
        json: { type: 'boolean', default: false },
        'allow-live': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
    }).values as typeof values;
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n\n${HELP}`);
    return 1;
  }
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.json) routeConsoleLogToStderr();

  try {
    if (!values.room) throw new UsageError('--room <ROOM> is required');
    const upto = parseRevisionOption('--upto', values.upto);
    const db = openStoreReadOnly(values.db, { allowLive: values['allow-live'] });
    let room: LoadedRoom | null;
    try {
      room = loadRoom(db, values.room, { upto });
    } finally {
      db.close();
    }
    if (!room) throw new UsageError(`room ${values.room} has no snapshot in ${values.db}`);
    if (!room.snapshot.started || !room.snapshot.start) {
      throw new UsageError(`room ${values.room} has not started [revision ${room.snapshot.revision}]; nothing to replay`);
    }

    let authority: RoomAuthority | null;
    try {
      authority = restoreAuthority(room.snapshot, room.commands);
    } catch (error) {
      const message = errorMessage(error);
      const failing = bisectFailingRevision(room.snapshot, room.commands, restoreAuthority);
      const failingRow = failing ? room.rows.find((row) => row.revision === failing.revision) : undefined;
      const failingAction = failingRow ? actionBrief(JSON.parse(failingRow.action_json) as Record<string, unknown>) : null;
      if (values.json) {
        process.stdout.write(toJson({
          room: room.roomId,
          restoreError: message,
          failingRevision: failing?.revision ?? null,
          failingError: failing?.error ?? null,
          failingActor: failingRow?.actor_seat ?? null,
          failingAction,
          commandCount: room.rows.length,
        }, 2) + '\n');
      } else {
        process.stdout.write(`room ${room.roomId}: restore threw: ${message}\n`);
        if (failing) {
          process.stdout.write(`first failing revision [bisect]: ${failing.revision}  actor seat ${failingRow?.actor_seat ?? '-'}  action ${toJson(failingAction)}\n`);
          process.stdout.write(`  error at that prefix: ${failing.error}\n`);
        } else {
          process.stdout.write('bisect could not reproduce the failure [non-deterministic?]\n');
        }
      }
      return 2;
    }
    if (!authority) throw new UsageError(`room ${values.room}: restoreAuthority returned null`);

    const report = buildReport(room, authority, upto);
    if (values.json) process.stdout.write(toJson(report, 2) + '\n');
    else printText(report);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = main();
