// tools/scan_rooms.mts [2026-09-02 yuma]
// store 内の全部屋 [または --room 指定] を command ごとに replay し、各 step 後の状態を JSONL に落とす。
// 「どの revision から状態がおかしいか」を眺めるためのもの。
//
//   npx tsx tools/scan_rooms.mts --db <copy.sqlite3> [--room 6U1V[,1EVR]] --out <dir>
//
// 出力: <dir>/scan_<ROOM>.jsonl [1 行 = 1 command 後の状態] と <dir>/summary.json、stdout に summary table
// exit code: 0 = 全部屋 replay 完走 / 1 = 引数エラー or 途中で失敗した部屋あり
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoomAuthority, type RoomAuthority } from '../server/authority.ts';
import {
  UsageError,
  actionBrief,
  activePendingKeys,
  errorMessage,
  listRoomIds,
  loadRoom,
  membersForReplay,
  openStoreReadOnly,
  routeConsoleLogToStderr,
  toJson,
} from './lib/replay_common.mts';

const HELP = `scan_rooms: replay every room command-by-command and dump a compact per-step state as JSONL

usage: npx tsx tools/scan_rooms.mts --db <path> [--room <ROOM>[,<ROOM>...]] --out <dir> [--allow-live]

  --db <path>      sqlite store [copy of data/anmika.sqlite3; keep -wal/-shm next to it]
  --room <ROOM>    only these rooms [comma separated]; default = every room in room_state_snapshots
  --out <dir>      output directory [created]; writes scan_<ROOM>.jsonl per room and summary.json
  --allow-live     allow opening the live store under data/ [read-only; default refuses]
  -h, --help       this help

JSONL line kinds: meta [room header] / step [state after the command] / skip [stamp] / error [first failure]
step fields: rev type actor at reason current lunban jushu changbang benbang defen paishu pending awaiting ron
             roundEnded lastWinner finished msg
exit code 0 all rooms replayed / 1 usage error or a room failed
`;

type StepRecord = {
  kind: 'step';
  rev: number;
  type: string;
  actor: number | null;
  at: string | null;
  reason: string | null;
  current: number;
  lunban: number;
  jushu: number;
  changbang: number;
  benbang: number;
  defen: Record<number, number>;
  paishu: number | null;
  pending: string;
  awaiting: string;
  ron: number[];
  roundEnded: boolean;
  lastWinner: number | null;
  finished: boolean;
  msg: string | null;
  action?: Record<string, unknown>;
};

function captureStep(authority: RoomAuthority, base: Pick<StepRecord, 'rev' | 'type' | 'actor' | 'at' | 'reason' | 'action'>): StepRecord {
  const c = authority.canonicalState();
  const g = c.game;
  let paishu: number | null = null;
  try {
    paishu = g.shan.paishu;
  } catch {
    paishu = null;
  }
  const awaiting = [c.awaitingRonDecision ? 'ron' : '', c.awaitingFulou ? 'fulou' : '', c.lizhiPending !== null ? `lizhi:${c.lizhiPending}` : '']
    .filter(Boolean)
    .join(',');
  return {
    kind: 'step',
    ...base,
    current: g.lunbanToPlayerId(g.state.lunban),
    lunban: g.state.lunban,
    jushu: g.state.jushu,
    changbang: g.state.changbang,
    benbang: g.state.benbang,
    defen: { ...g.state.defen },
    paishu,
    pending: activePendingKeys(c).map((key) => key.replace(/^pending/, '')).join(','),
    awaiting,
    ron: [...authority.ronCandidates],
    roundEnded: c.roundEnded,
    lastWinner: c.lastWinner,
    finished: !!g.state.finished,
    msg: c.message === null ? null : String(c.message).slice(0, 80),
  };
}

type RoomSummary = {
  room: string;
  schema: number | null;
  commands: number;
  firstRevision: number | null;
  lastRevision: number | null;
  replayed: number;
  firstFailingRevision: number | null;
  error: string | null;
  finished: boolean | null;
  file: string | null;
};

function scanRoom(db: ReturnType<typeof openStoreReadOnly>, roomId: string, outDir: string): RoomSummary {
  const summary: RoomSummary = {
    room: roomId, schema: null, commands: 0, firstRevision: null, lastRevision: null, replayed: 0,
    firstFailingRevision: null, error: null, finished: null, file: null,
  };
  const room = loadRoom(db, roomId);
  if (!room) {
    summary.error = 'no snapshot';
    return summary;
  }
  summary.schema = room.snapshotRow.schema_version;
  summary.commands = room.rows.length;
  summary.firstRevision = room.rows[0]?.revision ?? null;
  summary.lastRevision = room.rows.at(-1)?.revision ?? null;
  const file = resolve(outDir, `scan_${roomId}.jsonl`);
  summary.file = file;
  const lines: string[] = [];
  const { snapshot } = room;
  lines.push(toJson({
    kind: 'meta', room: roomId, schemaVersion: room.snapshotRow.schema_version, revision: snapshot.revision,
    matchId: snapshot.matchId, roundId: snapshot.roundId, started: snapshot.started, updatedAt: snapshot.updatedAt,
    members: snapshot.start?.members ?? [], qijia: snapshot.start?.qijia ?? null, changshu: snapshot.start?.changshu ?? null,
    activeMapping: snapshot.activeMapping ?? null, roomChipLedger: snapshot.roomChipLedger ?? null,
  }));
  if (!snapshot.started || !snapshot.start) {
    summary.error = 'not started';
    lines.push(toJson({ kind: 'error', where: 'start', message: 'room not started' }));
    writeFileSync(file, lines.join('\n') + '\n');
    return summary;
  }
  let authority: RoomAuthority;
  try {
    authority = createRoomAuthority({
      preShuffledPool: snapshot.start.preShuffledPool,
      qijia: snapshot.start.qijia,
      changshu: snapshot.start.changshu,
    });
  } catch (error) {
    summary.error = `create: ${errorMessage(error)}`;
    summary.firstFailingRevision = 0;
    lines.push(toJson({ kind: 'error', where: 'create', message: errorMessage(error) }));
    writeFileSync(file, lines.join('\n') + '\n');
    return summary;
  }
  const members = membersForReplay(snapshot);
  lines.push(toJson(captureStep(authority, { rev: 0, type: 'init', actor: null, at: null, reason: null })));
  for (const row of room.rows) {
    const action = JSON.parse(row.action_json) as Record<string, unknown>;
    const type = String(action.type);
    if (type === 'stamp') {
      lines.push(toJson({ kind: 'skip', rev: row.revision, type, actor: row.actor_seat, at: row.accepted_at }));
      continue;
    }
    let reason: string | null;
    try {
      reason = authority.validateAndApply(row.actor_seat, action, members);
    } catch (error) {
      reason = `THREW: ${errorMessage(error)}`;
    }
    lines.push(toJson(captureStep(authority, {
      rev: row.revision, type, actor: row.actor_seat, at: row.accepted_at, reason, action: actionBrief(action),
    })));
    summary.replayed += 1;
    if (reason) {
      summary.firstFailingRevision = row.revision;
      summary.error = reason;
      lines.push(toJson({ kind: 'error', where: 'apply', rev: row.revision, actor: row.actor_seat, type, reason }));
      break;
    }
  }
  summary.finished = !!authority.canonicalState().game.state.finished;
  writeFileSync(file, lines.join('\n') + '\n');
  return summary;
}

function printTable(rows: RoomSummary[]): void {
  const header = ['room', 'schema', 'commands', 'revisions', 'replayed', 'finished', 'first failing rev', 'error'];
  const cells = rows.map((r) => [
    r.room,
    r.schema === null ? '-' : String(r.schema),
    String(r.commands),
    r.firstRevision === null ? '-' : `${r.firstRevision}..${r.lastRevision}`,
    String(r.replayed),
    r.finished === null ? '-' : String(r.finished),
    r.firstFailingRevision === null ? '-' : String(r.firstFailingRevision),
    r.error ? r.error.slice(0, 60) : '',
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c: string[]) => c.map((v, i) => v.padEnd(widths[i])).join(' | ').trimEnd();
  process.stdout.write(line(header) + '\n');
  process.stdout.write(widths.map((w) => '-'.repeat(w)).join('-+-') + '\n');
  for (const c of cells) process.stdout.write(line(c) + '\n');
}

function main(): number {
  let values: { db?: string; room?: string; out?: string; 'allow-live': boolean; help: boolean };
  try {
    values = parseArgs({
      options: {
        db: { type: 'string' },
        room: { type: 'string' },
        out: { type: 'string' },
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
  routeConsoleLogToStderr();

  try {
    if (!values.out) throw new UsageError('--out <dir> is required');
    const outDir = resolve(values.out);
    mkdirSync(outDir, { recursive: true });
    const db = openStoreReadOnly(values.db, { allowLive: values['allow-live'] });
    const summaries: RoomSummary[] = [];
    try {
      const rooms = values.room
        ? values.room.split(',').map((r) => r.trim()).filter(Boolean)
        : listRoomIds(db);
      if (rooms.length === 0) throw new UsageError('no rooms found in room_state_snapshots');
      for (const roomId of rooms) {
        const summary = scanRoom(db, roomId, outDir);
        summaries.push(summary);
        process.stderr.write(`[scan] ${roomId}: ${summary.replayed}/${summary.commands} commands${summary.error ? `  error: ${summary.error}` : ''}\n`);
      }
    } finally {
      db.close();
    }
    writeFileSync(resolve(outDir, 'summary.json'), toJson({ db: values.db, generatedAt: new Date().toISOString(), rooms: summaries }, 2) + '\n');
    printTable(summaries);
    process.stdout.write(`\nwrote ${summaries.filter((s) => s.file).length} jsonl files + summary.json to ${outDir}\n`);
    return summaries.some((s) => s.error) ? 1 : 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = main();
