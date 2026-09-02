// tools/hydrate_check.mts [2026-09-02 yuma]
// 部屋を復元し、各席 [0,1,2,-1=観戦] の projection を client store の hydrate に通して受理されるか確認する。
// 「resync が無限往復する」「再接続しても盤面が出ない」系の一次切り分け用。
//
//   npx tsx tools/hydrate_check.mts --db <copy.sqlite3> --room 6U1V [--upto <revision>]
//
// exit code: 0 = 全席 PASS / 1 = FAIL あり or 引数エラー / 2 = restoreAuthority が throw
import { parseArgs } from 'node:util';
import { captureSeatProjection, restoreAuthority } from '../server/ws_server.ts';
import type { RoomAuthority } from '../server/authority.ts';
import type { OnlineSeatProjection } from '../server/protocol.ts';
import { createGameStore } from '../src/lib/store.ts';
import {
  UsageError,
  bisectFailingRevision,
  errorMessage,
  loadRoom,
  openStoreReadOnly,
  parseRevisionOption,
  toJson,
} from './lib/replay_common.mts';

const HELP = `hydrate_check: capture every seat projection of a restored room and run the client hydrate on it

usage: npx tsx tools/hydrate_check.mts --db <path> --room <ROOM> [--upto <revision>] [--allow-live]

  --db <path>        sqlite store [copy of data/anmika.sqlite3; keep -wal/-shm next to it]
  --room <ROOM>      room id
  --upto <revision>  replay only accepted commands with revision <= N
  --allow-live       allow opening the live store under data/ [read-only; default refuses]
  -h, --help         this help

prints PASS/FAIL for seats 0, 1, 2 and -1 [spectator]; on FAIL lists the projection fields that look empty/null
and the reject reason logged by store.hydrateProjectionState.
exit code 0 all PASS / 1 any FAIL / 2 restore threw
`;

const SEATS = [0, 1, 2, -1] as const;

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

/** hydrate が見る field のうち、null / 空 / 不正っぽいものを列挙する */
function suspiciousFields(projection: OnlineSeatProjection, seat: number): string[] {
  const p = projection as unknown as Record<string, unknown>;
  const found: string[] = [];
  if (p.schemaVersion !== 1) found.push(`schemaVersion=${toJson(p.schemaVersion)}`);
  if (p.recipientSeat !== seat) found.push(`recipientSeat=${toJson(p.recipientSeat)} [expected ${seat}]`);
  for (const key of ['gameConfig', 'gameState', 'shan', 'fields', 'store', 'publicHands', 'rivers', 'publicEvents']) {
    if (isEmptyValue(p[key])) found.push(`${key}=${toJson(p[key] ?? null)}`);
  }
  const gameState = (p.gameState ?? {}) as Record<string, unknown>;
  if (gameState.finished === true) found.push('gameState.finished=true');
  const privateHand = p.privateHand as Record<string, unknown> | null | undefined;
  if (seat !== -1) {
    if (!privateHand) found.push('privateHand=null');
    else {
      const bp = (privateHand.bingpai ?? {}) as Record<string, unknown>;
      for (const suit of ['m', 'p', 's', 'z']) {
        const arr = bp[suit];
        const min = suit === 'z' ? 8 : 10;
        if (!Array.isArray(arr) || arr.length < min) found.push(`privateHand.bingpai.${suit}=${toJson(arr ?? null)}`);
      }
      const total = ['m', 'p', 's', 'z']
        .flatMap((suit) => (Array.isArray(bp[suit]) ? (bp[suit] as number[]).slice(1) : []))
        .reduce((sum, n) => sum + Number(n || 0), 0) + Number(bp._ ?? 0);
      if (total === 0 && (!Array.isArray(privateHand.fulou) || privateHand.fulou.length === 0)) found.push('privateHand.tiles=0');
    }
  } else if (privateHand) {
    found.push('privateHand present for spectator');
  }
  const publicHands = (p.publicHands ?? {}) as Record<string, Record<string, unknown>>;
  for (const player of [0, 1, 2]) {
    const hand = publicHands[player] ?? publicHands[String(player)];
    if (!hand) {
      found.push(`publicHands[${player}]=null`);
      continue;
    }
    const fulou = Array.isArray(hand.fulou) ? hand.fulou.length : 0;
    if (Number(hand.concealedCount ?? 0) === 0 && fulou === 0) found.push(`publicHands[${player}].concealedCount=0`);
  }
  return found;
}

/** hydrate 中の console 出力 [reject 理由の dlog / warn] を拾う。dlog は ANMIKA_SERVER_DEBUG=1 の時だけ喋る */
function runHydrate(projection: OnlineSeatProjection, seat: number): { ok: boolean; logs: string[] } {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalDebug = process.env.ANMIKA_SERVER_DEBUG;
  const capture = (...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : toJson(a))).join(' '));
  };
  console.log = capture;
  console.warn = capture;
  process.env.ANMIKA_SERVER_DEBUG = '1';
  try {
    const clientStore = createGameStore();
    clientStore.setOnlineSeat(seat as 0 | 1 | 2 | -1);
    let ok: boolean;
    try {
      ok = clientStore.hydrateOnlineProjection(projection);
    } catch (error) {
      logs.push(`THREW: ${errorMessage(error)}`);
      ok = false;
    }
    return { ok, logs: logs.filter((line) => /reject|THREW/i.test(line)) };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    if (originalDebug === undefined) delete process.env.ANMIKA_SERVER_DEBUG;
    else process.env.ANMIKA_SERVER_DEBUG = originalDebug;
  }
}

function main(): number {
  let values: { db?: string; room?: string; upto?: string; 'allow-live': boolean; help: boolean };
  try {
    values = parseArgs({
      options: {
        db: { type: 'string' },
        room: { type: 'string' },
        upto: { type: 'string' },
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

  try {
    if (!values.room) throw new UsageError('--room <ROOM> is required');
    const upto = parseRevisionOption('--upto', values.upto);
    const db = openStoreReadOnly(values.db, { allowLive: values['allow-live'] });
    let room;
    try {
      room = loadRoom(db, values.room, { upto });
    } finally {
      db.close();
    }
    if (!room) throw new UsageError(`room ${values.room} has no snapshot in ${values.db}`);
    if (!room.snapshot.started || !room.snapshot.start) throw new UsageError(`room ${values.room} has not started; nothing to check`);

    let authority: RoomAuthority | null;
    try {
      authority = restoreAuthority(room.snapshot, room.commands);
    } catch (error) {
      const failing = bisectFailingRevision(room.snapshot, room.commands, restoreAuthority);
      process.stdout.write(`room ${room.roomId}: restore threw: ${errorMessage(error)}\n`);
      if (failing) process.stdout.write(`first failing revision [bisect]: ${failing.revision}\n`);
      return 2;
    }
    if (!authority) throw new UsageError(`room ${values.room}: restoreAuthority returned null`);

    const lastRevision = room.rows.at(-1)?.revision ?? 0;
    const state = authority.canonicalState();
    process.stdout.write(`room ${room.roomId}  revision ${lastRevision} [${room.rows.length} commands]  finished ${state.game.state.finished}  roundEnded ${state.roundEnded}\n`);
    let failures = 0;
    for (const seat of SEATS) {
      let projection: OnlineSeatProjection;
      try {
        projection = captureSeatProjection(authority, seat);
      } catch (error) {
        failures += 1;
        process.stdout.write(`seat ${String(seat).padStart(2)}: FAIL  captureSeatProjection threw: ${errorMessage(error)}\n`);
        continue;
      }
      const { ok, logs } = runHydrate(projection, seat);
      if (ok) {
        process.stdout.write(`seat ${String(seat).padStart(2)}: PASS\n`);
        continue;
      }
      failures += 1;
      const suspicious = suspiciousFields(projection, seat);
      process.stdout.write(`seat ${String(seat).padStart(2)}: FAIL\n`);
      if (logs.length) for (const line of logs) process.stdout.write(`    reject: ${line}\n`);
      process.stdout.write(`    empty/null fields: ${suspicious.length ? suspicious.join(', ') : '[none detected; compare against store.ts hydrateProjectionState]'}\n`);
      const store = (projection as unknown as { store: Record<string, unknown> }).store ?? {};
      process.stdout.write(`    store: roundEnded=${toJson(store.roundEnded)} lastWinner=${toJson(store.lastWinner)} message=${toJson(store.message)}\n`);
    }
    process.stdout.write(`result: ${failures === 0 ? 'all PASS' : `${failures} FAIL`}\n`);
    return failures === 0 ? 0 : 1;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = main();
