// tools/dump_to_test.mts [2026-09-02 yuma]
// client の診断ダンプ [stuck_*.json = buildDiagnosticDump] または牌譜 [paifu_*.json = buildCanonicalPaifuSnapshot] から、
// single-player store に同じ局面を組み立てる vitest の雛形を出力する。
// 生成物を src/lib/__tests__/ に置き、詰まった時の操作と期待結果 [TODO 箇所] を足せば回帰テストになる。
//
//   npx tsx tools/dump_to_test.mts --dump stuck_1723456789.json [--out src/lib/__tests__/bug_xxx.test.ts]
//   npx tsx tools/dump_to_test.mts --dump server/data/bugreports/20260902.jsonl [--index 0]   # バグ通報 jsonl も可
//
// 対応形式: anmika-diagnostic-dump v1 / バグ通報 record [dump 同梱] / anmika-mahjong-paifu schemaVersion 3
// ダンプに無い情報は TODO として出す [壁牌・相手の伏せ牌・yifaActive 等]
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const HELP = `dump_to_test: turn a client diagnostic dump / paifu into a vitest skeleton that rebuilds the state in the single-player store

usage: npx tsx tools/dump_to_test.mts --dump <stuck_*.json | paifu_*.json | bugreports/*.jsonl> [--index <n>] [--events] [--out <file>]

  --dump <file>   anmika-diagnostic-dump v1 [App.svelte 🐛/診断ダンプ], bug report record [{..., dump}], jsonl of records,
                  or anmika-mahjong-paifu schemaVersion 3
  --index <n>     which record of a jsonl file [0-based; default = last]
  --events        inline the full game.events array [default: only the last events as a comment]
  --out <file>    write the skeleton here instead of stdout [e.g. src/lib/__tests__/bug_2026_09_02_stuck.test.ts]
  -h, --help      this help

The skeleton follows the synth*.mts pattern: createGameStore() then overwrite game/state/hands/fields directly.
TODO markers show what the dump does not carry. exit code 0 ok / 1 usage or unsupported dump
`;

type Json = Record<string, any>;
type PlayerId = 0 | 1 | 2;
const PLAYERS: PlayerId[] = [0, 1, 2];

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------

function readRecords(path: string): Json[] {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  try {
    const whole = JSON.parse(text);
    return Array.isArray(whole) ? whole : [whole];
  } catch {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const records: Json[] = [];
    for (const [i, line] of lines.entries()) {
      try {
        records.push(JSON.parse(line));
      } catch (error) {
        throw new UsageError(`${path}: line ${i + 1} is not JSON [${(error as Error).message}]`);
      }
    }
    if (records.length === 0) throw new UsageError(`${path}: no JSON records found`);
    return records;
  }
}

type Source =
  | { kind: 'diag'; dump: Json; report: Json | null }
  | { kind: 'paifu'; paifu: Json };

function classify(record: Json): Source {
  if (record?.kind === 'anmika-diagnostic-dump') return { kind: 'diag', dump: record, report: null };
  if (record?.dump?.kind === 'anmika-diagnostic-dump') return { kind: 'diag', dump: record.dump, report: record };
  if (record?.type === 'anmika-mahjong-paifu') return { kind: 'paifu', paifu: record };
  const keys = Object.keys(record ?? {}).slice(0, 8).join(', ');
  throw new UsageError(`unsupported dump shape [top-level keys: ${keys}]; expected anmika-diagnostic-dump, a bug report record with dump, or anmika-mahjong-paifu`);
}

// ---------------------------------------------------------------------------
// hands: serialized bingpai -> physical tile list [server/ws_server.ts physicalConcealedTiles と同じ規則]
// ---------------------------------------------------------------------------

const CORE_OF: Record<string, string> = {
  z5b: 'z5', z5r: 'z5', z5g: 'z5', z5y: 'z5', gp: 'p0', gs: 's0', gN: 'z4', np3: 'p3', ns3: 's3', nz3: 'z3',
};
const coreOf = (pai: string): string => CORE_OF[pai] ?? pai;
const num = (value: unknown): number => Math.max(0, Number(value) || 0);

function physicalTiles(bingpai: Json): string[] {
  const ex: Json = bingpai?.anmika ?? {};
  const out: string[] = [];
  const push = (pai: string, count: number) => {
    for (let i = 0; i < count; i += 1) out.push(pai);
  };
  for (const suit of ['m', 'p', 's', 'z'] as const) {
    const arr: unknown[] = Array.isArray(bingpai?.[suit]) ? bingpai[suit] : [];
    const max = suit === 'z' ? 7 : 9;
    for (let n = 1; n <= max; n += 1) {
      if (suit === 'z' && n === 5) continue;
      let count = num(arr[n]);
      if ((suit === 'p' || suit === 's') && n === 5) count -= num(arr[0]);
      if (suit === 'z' && n === 4) count -= num(ex.gN);
      if (suit === 'p' && n === 3) count -= num(ex.np3);
      if (suit === 's' && n === 3) count -= num(ex.ns3);
      if (suit === 'z' && n === 3) count -= num(ex.nz3);
      push(`${suit}${n}`, count);
    }
  }
  push('p0', num(bingpai?.p?.[0]) - num(ex.gp));
  push('gp', num(ex.gp));
  push('s0', num(bingpai?.s?.[0]) - num(ex.gs));
  push('gs', num(ex.gs));
  push('gN', num(ex.gN));
  push('np3', num(ex.np3));
  push('ns3', num(ex.ns3));
  push('nz3', num(ex.nz3));
  for (const key of ['z5b', 'z5r', 'z5g', 'z5y']) push(key, num(ex[key]));
  const colored = ['z5b', 'z5r', 'z5g', 'z5y'].reduce((sum, key) => sum + num(ex[key]), 0);
  push('z5', num(bingpai?.z?.[5]) - colored);
  return out;
}

type SeatSpec = {
  seat: PlayerId;
  tiles: string[];
  hidden: number;
  draw: string | null;
  pseudoZimo: string | null;
  fulou: string[];
  anmikaFulou: unknown[];
  anmikaFulouPhysical: unknown[];
  goldHand: { p: number; s: number; z: number };
  pochiHand: { blue: number; red: number; green: number; yellow: number };
  notes: string[];
  missing: string | null;
};

function seatSpec(seat: PlayerId, hand: unknown): SeatSpec {
  const empty: SeatSpec = {
    seat, tiles: [], hidden: 0, draw: null, pseudoZimo: null, fulou: [], anmikaFulou: [], anmikaFulouPhysical: [],
    goldHand: { p: 0, s: 0, z: 0 }, pochiHand: { blue: 0, red: 0, green: 0, yellow: 0 }, notes: [], missing: null,
  };
  if (!hand || typeof hand !== 'object' || !(hand as Json).bingpai) {
    return { ...empty, missing: typeof hand === 'string' ? hand : 'hand missing in dump' };
  }
  const h = hand as Json;
  const spec: SeatSpec = { ...empty, tiles: physicalTiles(h.bingpai), hidden: num(h.bingpai._) };
  spec.fulou = Array.isArray(h.fulou) ? h.fulou.map(String) : [];
  spec.anmikaFulou = Array.isArray(h.anmikaFulou) ? h.anmikaFulou : [];
  spec.anmikaFulouPhysical = Array.isArray(h.anmikaFulouPhysical) ? h.anmikaFulouPhysical : [];
  const rawZimo = typeof h.zimo === 'string' ? h.zimo : null;
  if (rawZimo === '__hidden_draw__') {
    spec.pseudoZimo = rawZimo;
    spec.notes.push('drawn tile hidden in dump [opponent]; count is included in hidden');
  } else if (rawZimo !== null && rawZimo.replace(/[_*]$/, '').length > 3) {
    spec.pseudoZimo = rawZimo; // 副露直後の疑似ツモ [面子文字列]
  } else if (rawZimo !== null) {
    const physical = String(h.anmikaZimo ?? rawZimo).replace(/[_*]$/, '');
    let idx = spec.tiles.indexOf(physical);
    if (idx < 0) idx = spec.tiles.findIndex((t) => coreOf(t) === coreOf(physical));
    if (idx >= 0) {
      spec.draw = spec.tiles.splice(idx, 1)[0];
    } else {
      spec.draw = physical;
      spec.notes.push(`TODO: drawn tile ${physical} was not found in the concealed tiles; hand count may be off by one`);
    }
  }
  if (spec.hidden > 0 && spec.tiles.length === 0) spec.notes.push(`${spec.hidden} tiles hidden in dump [opponent]; TODO put real tiles if the bug needs them`);
  const all = [...spec.tiles, ...(spec.draw ? [spec.draw] : [])];
  spec.goldHand = { p: all.filter((t) => t === 'gp').length, s: all.filter((t) => t === 'gs').length, z: all.filter((t) => t === 'gN').length };
  spec.pochiHand = {
    blue: all.filter((t) => t === 'z5b').length,
    red: all.filter((t) => t === 'z5r').length,
    green: all.filter((t) => t === 'z5g').length,
    yellow: all.filter((t) => t === 'z5y').length,
  };
  return spec;
}

// ---------------------------------------------------------------------------
// rendering helpers
// ---------------------------------------------------------------------------

const J = (value: unknown): string => JSON.stringify(value === undefined ? null : value);

function commentBlock(label: string, value: unknown, max = 900): string {
  const text = J(value);
  return `// ${label}: ${text.length > max ? text.slice(0, max) + ' ...' : text}`;
}

function eventBrief(event: Json): string {
  const parts = [String(event?.type ?? '?')];
  if (event?.player !== undefined) parts.push(`p${event.player}`);
  if (event?.pai !== undefined) parts.push(String(event.pai));
  if (event?.mianzi !== undefined) parts.push(String(event.mianzi));
  if (event?.tiles !== undefined && Array.isArray(event.tiles)) parts.push(`[${event.tiles.length}]`);
  return parts.join(' ');
}

function renderSeat(spec: SeatSpec): string[] {
  const v = `sp${spec.seat}`;
  const lines: string[] = [];
  if (spec.missing) {
    lines.push(`  // seat ${spec.seat}: ${spec.missing}`);
    lines.push(`  // TODO: seat ${spec.seat} の手牌をダンプ以外 [報告本文 / スクショ] から埋める`);
    lines.push(`  const ${v} = buildShoupai([]);`);
    lines.push(`  g.shoupai.set(${spec.seat}, ${v});`);
    return lines;
  }
  const summary = [`${spec.tiles.length} tiles`];
  if (spec.hidden) summary.push(`${spec.hidden} hidden`);
  if (spec.draw) summary.push(`draw ${spec.draw}`);
  if (spec.pseudoZimo) summary.push(`zimo ${spec.pseudoZimo}`);
  if (spec.fulou.length) summary.push(`fulou ${spec.fulou.join(' ')}`);
  lines.push(`  // seat ${spec.seat}: ${summary.join(', ')}`);
  for (const note of spec.notes) lines.push(`  // ${note}`);
  lines.push(`  const ${v} = buildShoupai(${J(spec.tiles)});`);
  if (spec.hidden) lines.push(`  ${v}._bingpai._ = ${spec.hidden};`);
  if (spec.draw) lines.push(`  ${v}.zimo(${J(spec.draw)});`);
  if (spec.pseudoZimo) lines.push(`  ${v}._zimo = ${J(spec.pseudoZimo)};`);
  if (spec.fulou.length) lines.push(`  ${v}._fulou = ${J(spec.fulou)};`);
  if (spec.anmikaFulou.length) lines.push(`  ${v}._anmikaFulou = ${J(spec.anmikaFulou)};`);
  if (spec.anmikaFulouPhysical.length) lines.push(`  ${v}._anmikaFulouPhysical = ${J(spec.anmikaFulouPhysical)};`);
  lines.push(`  g.shoupai.set(${spec.seat}, ${v});`);
  return lines;
}

function renderRivers(he: unknown, withDiscardLog: boolean): string[] {
  const lines: string[] = [];
  for (const p of PLAYERS) {
    const river = Array.isArray((he as Json)?.[p]) ? ((he as Json)[p] as unknown[]).map(String) : null;
    if (!river) {
      lines.push(`  // TODO: seat ${p} の河がダンプに無い [${J((he as Json)?.[p] ?? null)}]`);
      continue;
    }
    lines.push(`  g.he.get(${p})._pai = ${J(river)};`);
    if (withDiscardLog) {
      const log = river.map((pai) => ({ pai: pai.replace(/[_*\-+=]+$/, ''), tsumogiri: pai.includes('_') }));
      lines.push(`  g.discardLog[${p}] = ${J(log)}; // 河から導出 [gold/pochi 属性は不明]`);
    }
  }
  return lines;
}

function pochiColorOf(pai: string | null): string | null {
  return ({ z5b: 'blue', z5r: 'red', z5g: 'green', z5y: 'yellow' } as Record<string, string>)[pai ?? ''] ?? null;
}

const TAIL = `
const PENDING_KEYS = ['pendingFuyu', 'pendingKinpei', 'pendingKamiPochi', 'pendingPochiSwap', 'pendingFeverContinue',
  'pendingSaiKoro', 'pendingPingju', 'pendingQianggang', 'pendingNukiBei'];

/** 状態の要点だけ [デバッグ出力用] */
function brief(s: any) {
  const g = s.game;
  return {
    message: s.message,
    current: g.lunbanToPlayerId(g.state.lunban),
    roundEnded: s.roundEnded,
    lastWinner: s.lastWinner,
    lastZimo: s.lastZimo,
    lastDapai: s.lastDapai,
    awaitingRon: s.awaitingRonDecision,
    awaitingFulou: s.awaitingFulou,
    lizhiPending: s.lizhiPending,
    pending: PENDING_KEYS.filter((key) => s[key]),
    defen: g.state.defen,
  };
}
`;

// ---------------------------------------------------------------------------
// diag dump -> skeleton
// ---------------------------------------------------------------------------

function renderDiag(dump: Json, report: Json | null, file: string, inlineEvents: boolean): string {
  const game: Json = dump.game ?? {};
  const blocking: Json = dump.blocking ?? {};
  const flow: Json = dump.flow ?? {};
  const state: Json = game.state ?? {};
  const events: Json[] = Array.isArray(game.events) ? game.events : [];
  const cpu: Json = flow.cpu ?? {};
  const cpuSeats = PLAYERS.filter((p) => cpu[p] === true);
  const currentPlayer = typeof flow.currentPlayer === 'number' ? flow.currentPlayer : null;
  const lastZimo: string | null = typeof flow.lastZimo === 'string' ? flow.lastZimo : null;
  const seats = PLAYERS.map((p) => seatSpec(p, game.shoupai?.[p]));
  const stem = basename(file).replace(/\.[^.]+$/, '');

  const head: string[] = [];
  head.push(`// generated by tools/dump_to_test.mts from ${basename(file)} [${dump.kind} v${dump.version ?? '?'}, savedAt ${dump.savedAt ?? '?'}, reason ${dump.reason ?? '?'}]`);
  if (report) {
    head.push(`// bug report: ${J(report.comment ?? '')} mode=${report.mode ?? '?'} room=${report.room_id || '-'} revision=${report.revision ?? '-'} seat=${report.seat ?? '-'} version=${report.version || '-'} user=${report.username || report.user_id || '-'}`);
    if (report.mode === 'online' && report.room_id) {
      head.push(`// online の詰まりは server 側 journal が正: npx tsx tools/replay_room.mts --db <copy> --room ${report.room_id}${typeof report.revision === 'number' ? ` --upto ${report.revision}` : ''}`);
    }
  }
  head.push(commentBlock('blocking', blocking));
  head.push(commentBlock('flow', { ...flow, cpu: undefined }));
  head.push(`// events: ${events.length} total; last: ${events.slice(-12).map(eventBrief).join(' | ') || '-'}`);
  head.push('// このダンプに無いもの [必要なら埋める]: 壁牌 [g.shan._pai / _rinshan は createGameStore の乱数のまま], kanDoraCount,');
  head.push('//   yifaActive, lingshangActive, lingshangFromKan, firstTurnState, lizhiDeclareDapai, doubleLizhi, openLizhi,');
  head.push('//   feverDeclareTing, pochiMultiplier, 相手の伏せ牌 [online]。goldHand / pochiHand / discardLog / lastZimoInfo は導出値');
  head.push('');
  head.push("import { describe, expect, it } from 'vitest';");
  head.push("import { get } from 'svelte/store';");
  head.push("import { buildShoupai } from '../game3';");
  head.push("import { createGameStore } from '../store';");
  head.push('');

  const body: string[] = [];
  body.push('function buildStuckState() {');
  body.push('  const store = createGameStore();');
  body.push(`  store.setCpuSeats(${J(cpuSeats)});`);
  body.push('  const s: any = get(store);');
  body.push('  const g: any = s.game;');
  body.push('');
  body.push('  // -- 局情報 [dump game.state をそのまま] --');
  body.push(`  g.state = ${J(state)};`);
  body.push('  g.diyizimo = false; // TODO: 配牌直後 [第一ツモ前] の詰まりなら true');
  body.push('');
  body.push('  // -- 手牌 [ツモ牌は手牌から外して sp.zimo() で入れる] --');
  for (const spec of seats) body.push(...renderSeat(spec));
  body.push('');
  body.push('  // -- 河 --');
  body.push(...renderRivers(game.he, true));
  body.push('');
  body.push('  // -- 卓 field [dump にある分] --');
  body.push(`  g.lizhi = new Set(${J(Array.isArray(game.lizhi) ? game.lizhi : [])});`);
  body.push('  // TODO: doubleLizhi / openLizhi はダンプに無い。オープンリーチ / ダブリー絡みなら new Set([...]) で立てる');
  for (const field of ['huapai', 'nukidora', 'nukidoraGold', 'feverActive', 'feverTier', 'shuvariActive', 'shuvariUsed', 'kinpeiTarget', 'akiUsedCount', 'akiUsedIndicators', 'chipLedger']) {
    if (game[field] !== undefined) body.push(`  g.${field} = ${J(game[field])};`);
    else body.push(`  // TODO: g.${field} はダンプに無い`);
  }
  const goldHand = Object.fromEntries(seats.map((sp) => [sp.seat, sp.goldHand]));
  const pochiHand = Object.fromEntries(seats.map((sp) => [sp.seat, sp.pochiHand]));
  body.push(`  g.goldHand = ${J(goldHand)}; // 手牌の gp/gs/gN から導出 [伏せ牌の席は 0]`);
  body.push(`  g.pochiHand = ${J(pochiHand)}; // 手牌の z5b/z5r/z5g/z5y から導出`);
  body.push(`  g.lastZimoInfo = ${J({ player: lastZimo ? currentPlayer : null, pai: lastZimo, pochi: pochiColorOf(lastZimo), gold: ['gp', 'gs', 'gN'].includes(lastZimo ?? '') })}; // flow.lastZimo / currentPlayer から導出`);
  body.push(`  g.qianggangPending = ${J(!!blocking.pendingQianggang)}; // blocking.pendingQianggang から導出`);
  body.push('');
  body.push('  // -- ドラ [表示牌だけ差し替える。壁牌そのものは createGameStore の乱数のまま] --');
  if (Array.isArray(game.baopai)) {
    body.push('  g.shan._baopai.length = 0;');
    body.push(`  g.shan._baopai.push(...${J(game.baopai)});`);
  } else body.push('  // TODO: baopai がダンプに無い');
  if (Array.isArray(game.fubaopai)) {
    body.push('  if (g.shan._fubaopai) { g.shan._fubaopai.length = 0; }');
    body.push(`  if (g.shan._fubaopai) { g.shan._fubaopai.push(...${J(game.fubaopai)}); }`);
  } else body.push(`  // fubaopai: ${J(game.fubaopai ?? null)} [裏ドラ無し or ダンプに無い]`);
  body.push('  g.shan.commitDoraReveal?.();');
  body.push(`  // TODO: kanDoraCount はダンプに無い [paishu ${J(game.paishu ?? null)}, baopai ${Array.isArray(game.baopai) ? game.baopai.length : '?'} 枚]。カン後なら g.shan.kanDoraCount = n`);
  body.push('  // TODO: 次のツモ / 嶺上牌に依存するバグなら g.shan._pai / g.shan._rinshan[0] を固定する');
  body.push('');
  body.push('  // -- store 進行フラグ [dump blocking / flow をそのまま] --');
  const storeFields: Array<[string, unknown]> = [
    ['lastZimo', flow.lastZimo ?? null],
    ['lastDapai', flow.lastDapai ?? null],
    ['lastWinner', flow.lastWinner ?? null],
    ['message', flow.message ?? null],
    ['roundEnded', !!blocking.roundEnded],
    ['awaitingRonDecision', !!blocking.awaitingRonDecision],
    ['awaitingFulou', !!blocking.awaitingFulou],
    ['ronPassedPlayers', flow.ronCandidatesPassed ?? []],
    ['ronDeclaredPlayers', flow.ronDeclared ?? []],
    ['ponCandidates', flow.ponCandidates ?? []],
    ['kanCandidates', flow.kanCandidates ?? []],
    ['lizhiPending', blocking.lizhiPending ?? null],
    ['pendingKinpei', blocking.pendingKinpei ?? null],
    ['pendingFuyu', blocking.pendingFuyu ?? null],
    ['pendingKamiPochi', blocking.pendingKamiPochi ?? null],
    ['pendingPochiSwap', blocking.pendingPochiSwap ?? null],
    ['pendingFeverContinue', blocking.pendingFeverContinue ?? null],
    ['pendingPingju', !!blocking.pendingPingju],
    ['pendingQianggang', blocking.pendingQianggang ?? null],
    ['pendingSaiKoro', blocking.pendingSaiKoro ?? null],
    ['pendingNukiBei', blocking.pendingNukiBei ?? null],
    ['cpuWinAck', blocking.cpuWinAck !== false],
  ];
  for (const [key, value] of storeFields) body.push(`  s.${key} = ${J(value)};`);
  body.push('  // lastHuleResult / ronResults はダンプに無い [和了後の詰まりなら TODO: hule 結果を入れる]');
  if (blocking.cutin || (blocking.cutinQueueLength ?? 0) > 0) {
    body.push(`  // NOTE: dump 時点でカットイン再生中 [cutin ${J(blocking.cutin)}, queue ${blocking.cutinQueueLength}]。演出待ちで CPU 進行が止まる系かも`);
  }
  if (inlineEvents) body.push(`  g.events = ${J(events)};`);
  else body.push(`  // g.events は省略 [${events.length} 件; --events で埋め込める]`);
  body.push('  return store;');
  body.push('}');

  const test: string[] = [];
  test.push('');
  test.push(`describe('bug ${stem}', () => {`);
  test.push("  it('TODO: 本来の挙動を書く', () => {");
  test.push('    const store = buildStuckState();');
  test.push('    const before = brief(get(store));');
  if (currentPlayer !== null) test.push(`    expect(before.current).toBe(${currentPlayer});`);
  else test.push(`    // currentPlayer could not be read from the dump: ${J(flow.currentPlayer ?? null)}`);
  test.push(`    expect(before.message).toBe(${J(flow.message ?? null)});`);
  test.push('    // TODO: 詰まった時に押した操作を再現する [例: store.tsumo() / store.discard(\'p3\') / store.selectKinpei(\'natsu\') / store.nextRound()]');
  test.push('    // TODO: 本来どうなるべきかを assert する [例: expect(get(store).roundEnded).toBe(true)]');
  test.push('    const after = brief(get(store));');
  test.push('    expect(after).toBeDefined();');
  test.push('  });');
  test.push('});');

  return [...head, ...body, TAIL, ...test].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// paifu v3 -> skeleton
// ---------------------------------------------------------------------------

const PAIFU_RECORD_FIELDS = [
  'nukidora', 'nukidoraGold', 'yifaActive', 'lizhiDeclareDapai', 'lingshangActive', 'lingshangFromKan',
  'feverWinCount', 'goldHand', 'huapai', 'pochiHand', 'lastZimoInfo', 'pochiMultiplier', 'pochiPaymentMode',
  'pochiChipReverse', 'pochiChipDouble', 'chipLedger', 'haruActive', 'fuyuSkip', 'fuyuConsumed', 'akiUsedCount',
  'akiUsedIndicators', 'kinpeiTarget', 'chipBreakdown', 'discardLog', 'justNukidBei', 'feverActive',
  'feverDeclareTing', 'feverTier', 'feverPendingShuvari', 'feverSaiAwarded', 'shuvariActive', 'shuvariUsed',
  'lateShuvariWindow',
];

function renderPaifu(paifu: Json, file: string, inlineEvents: boolean): string {
  const game: Json = paifu.game ?? {};
  const storeData: Json = paifu.store ?? {};
  const init: Json = game.init ?? {};
  const shan: Json = game.shan ?? {};
  const fields: Json = game.fields ?? {};
  const events: Json[] = Array.isArray(game.events) ? game.events : [];
  const stem = basename(file).replace(/\.[^.]+$/, '');
  const cpu: Json = storeData.cpu ?? {};
  const cpuSeats = PLAYERS.filter((p) => cpu[p] === true);
  const shoupai = Array.isArray(game.shoupai) ? game.shoupai : PLAYERS.map((p) => game.shoupai?.[p]);
  const he = Array.isArray(game.he) ? game.he : PLAYERS.map((p) => game.he?.[p]);
  const seats = PLAYERS.map((p) => seatSpec(p, shoupai?.[p]));
  const schema = paifu.schemaVersion ?? paifu.version;
  const notV3 = schema !== 3;

  const head: string[] = [];
  head.push(`// generated by tools/dump_to_test.mts from ${basename(file)} [anmika-mahjong-paifu schemaVersion ${schema ?? '?'}, ${paifu.timestamp ?? '?'}, safePoint ${J(paifu.safePoint?.kind ?? null)}]`);
  if (notV3) head.push('// TODO: schemaVersion 3 以外の牌譜。fields / shan の形が違うので下の割り当ては要確認 [src/lib/store/paifuIo.ts 参照]');
  head.push('// 牌譜は山まで持つので決定論的に復元できる。丸ごと復元するだけなら buildStateFromPaifu(paifu) [src/lib/store/paifuIo.ts] でも良い');
  head.push(`// store: ${J({ lastZimo: storeData.lastZimo, lastDapai: storeData.lastDapai, lastWinner: storeData.lastWinner, roundEnded: storeData.roundEnded, message: storeData.message })}`);
  head.push(`// events: ${events.length} total; last: ${events.slice(-12).map(eventBrief).join(' | ') || '-'}`);
  head.push('');
  head.push("import { describe, expect, it } from 'vitest';");
  head.push("import { get } from 'svelte/store';");
  head.push("import { buildShoupai } from '../game3';");
  head.push("import { createGameStore } from '../store';");
  head.push('');

  const body: string[] = [];
  body.push('function buildState() {');
  body.push('  const store = createGameStore();');
  body.push(`  store.setCpuSeats(${J(cpuSeats)});`);
  body.push('  const s: any = get(store);');
  body.push('  const g: any = s.game;');
  body.push('');
  body.push('  // -- 対局設定 / 局情報 --');
  if (init.changshu !== undefined) body.push(`  g.changshu = ${J(init.changshu)};`);
  if (init.startingDefen !== undefined) body.push(`  g.startingDefen = ${J(init.startingDefen)};`);
  body.push(`  g.state = ${J(game.state ?? {})};`);
  body.push('');
  body.push('  // -- 山 [牌譜の shan をそのまま restore] --');
  const shanRestore = {
    pai: shan.pai ?? [], rinshan: shan.rinshan ?? [], rinshanUsed: shan.rinshanUsed ?? 0,
    lastDrawnHuapai: shan.lastDrawnHuapai ?? [], lastZimoGold: !!shan.lastZimoGold, lastZimoPochi: shan.lastZimoPochi ?? null,
    kanDoraCount: shan.kanDoraCount ?? 0, weikaigang: !!shan.weikaigang, baopai: shan.baopai ?? [],
    fubaopai: shan.fubaopai === null ? null : (shan.fubaopai ?? []),
  };
  body.push(`  g.shan.restore(${J(shanRestore)});`);
  body.push(`  g.shan._initialPai = ${J(shan.initialPai ?? [])};`);
  body.push(`  g.shan._fuyuRevealed = ${J(shan.fuyuRevealed ?? [])};`);
  body.push(`  g.shan.extraSanReduction = ${J(Number(shan.extraSanReduction ?? 0))};`);
  body.push(`  g.shan._closed = ${J(!!shan.closed)};`);
  body.push('');
  body.push('  // -- 手牌 --');
  for (const spec of seats) body.push(...renderSeat(spec));
  body.push('');
  body.push('  // -- 河 [discardLog は fields から入る] --');
  body.push(...renderRivers(Object.fromEntries(PLAYERS.map((p) => [p, he?.[p]])), false));
  body.push('');
  body.push('  // -- 卓 field [paifuIo.ts restoreV3 と同じ割り当て] --');
  const record: Json = {};
  const missing: string[] = [];
  for (const field of PAIFU_RECORD_FIELDS) {
    if (fields[field] !== undefined) record[field] = fields[field];
    else missing.push(field);
  }
  body.push(`  const FIELDS: Record<string, any> = ${J(record)};`);
  body.push('  for (const [key, value] of Object.entries(FIELDS)) g[key] = value;');
  if (missing.length) body.push(`  // TODO: 牌譜に無い field: ${missing.join(', ')}`);
  if (fields.lingshangFromKan === undefined) body.push('  g.lingshangFromKan = { ...g.lingshangActive }; // 旧牌譜互換');
  body.push(`  g.lizhi = new Set(${J(fields.lizhi ?? [])});`);
  body.push(`  g.doubleLizhi = new Set(${J(fields.doubleLizhi ?? [])});`);
  body.push(`  g.openLizhi = new Set(${J(fields.openLizhi ?? [])});`);
  body.push(`  g.restoreFirstTurnState(${J(fields.firstTurnState ?? null)});`);
  body.push(`  g.qianggangPending = ${J(!!fields.qianggangPending)};`);
  body.push(`  g.feverDeclareDapaiPlayer = ${J(fields.feverDeclareDapaiPlayer ?? null)};`);
  body.push(`  g.tobiChipPaid = ${J(!!fields.tobiChipPaid)};`);
  body.push('');
  body.push('  // -- store 進行フラグ --');
  for (const key of ['lastZimo', 'lastDapai', 'lastWinner', 'lastHuleResult', 'roundEnded', 'message']) {
    body.push(`  s.${key} = ${J(storeData[key] ?? null)};`);
  }
  if (inlineEvents) body.push(`  g.events = ${J(events)};`);
  else body.push(`  // g.events は省略 [${events.length} 件; --events で埋め込める]`);
  body.push('  return store;');
  body.push('}');

  const currentLine = (() => {
    const st: Json = game.state ?? {};
    return typeof st.lunban === 'number' ? `    expect(get(store).game.state.lunban).toBe(${st.lunban});` : '    // TODO: state.lunban が無い';
  })();
  const test: string[] = [];
  test.push('');
  test.push(`describe('paifu ${stem}', () => {`);
  test.push("  it('TODO: 本来の挙動を書く', () => {");
  test.push('    const store = buildState();');
  test.push(currentLine);
  test.push(`    expect(get(store).lastZimo).toBe(${J(storeData.lastZimo ?? null)});`);
  test.push('    // TODO: ここから操作を進めて [store.discard(...) / store.tsumo() など] 期待結果を assert する');
  test.push('    expect(brief(get(store))).toBeDefined();');
  test.push('  });');
  test.push('});');

  return [...head, ...body, TAIL, ...test].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(): number {
  let values: { dump?: string; index?: string; events: boolean; out?: string; help: boolean };
  try {
    values = parseArgs({
      options: {
        dump: { type: 'string' },
        index: { type: 'string' },
        events: { type: 'boolean', default: false },
        out: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
    }).values as typeof values;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${HELP}`);
    return 1;
  }
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  try {
    if (!values.dump) throw new UsageError('--dump <file> is required');
    const records = readRecords(values.dump);
    let index = records.length - 1;
    if (values.index !== undefined) {
      index = Number(values.index);
      if (!Number.isInteger(index) || index < 0 || index >= records.length) {
        throw new UsageError(`--index must be 0..${records.length - 1} [file has ${records.length} records]`);
      }
    }
    const source = classify(records[index]);
    const text = source.kind === 'diag'
      ? renderDiag(source.dump, source.report, values.dump, values.events)
      : renderPaifu(source.paifu, values.dump, values.events);
    if (values.out) {
      writeFileSync(values.out, text);
      process.stderr.write(`wrote ${values.out} [${source.kind}, record ${index + 1}/${records.length}]\n`);
    } else {
      process.stdout.write(text);
      const stem = basename(values.dump).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]+/g, '_');
      process.stderr.write(`[dump_to_test] ${source.kind} record ${index + 1}/${records.length}; suggested file: src/lib/__tests__/bug_${stem}.test.ts\n`);
    }
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
