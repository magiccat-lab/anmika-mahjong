// tools/norosh_audit.mts [2026-09-13 yuma]
// norosh1.com の公開牌譜 [data/norosh/games/*.json] をうちの Game3/store に流し込み、
// 局ごとの採点 [役 / 翻 / 符 / 基本点 / 祝儀内訳 / サイコロ] と 点数・祝儀の移動を突き合わせる。
//
//   npx tsx tools/norosh_audit.mts [--limit 30] [--games id1,id2] [--out data/norosh/audit] [--trace gameId:round:honba]
//
// 出力: <out>/rounds.jsonl [1 行 = 1 局]、<out>/summary.json。進捗は stderr。
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  walkRound, setupRound, driveRound, summarizeTheirs, summarizeOurs, chipSummaryTheirs, chipSummaryOurs, chipEffectLines,
  diceSummaryTheirs, diceSummaryOurs, SEAT_TO_OURS, SEAT_TO_THEIRS,
  type TheirGame, type TheirRound, type YakuSummary,
} from './lib/norosh_adapter.mts';
import type { PlayerId } from '../src/lib/types.ts';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
/** ドラ族の比較キー [compareYaku で族合計を先に比べる] */
const DORA_KEYS = ['dora', 'reddora', 'uradora', 'kitadora'];

// Game3 内部の console.log を stderr に逃がす [stdout は進捗/サマリ用]
const origLog = console.log;
console.log = (...args: unknown[]) => {
  if (process.env.NOROSH_AUDIT_DEBUG) process.stderr.write(args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' ') + '\n');
};
console.error = (...args: unknown[]) => {
  if (process.env.NOROSH_AUDIT_DEBUG) process.stderr.write(args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' ') + '\n');
};
console.warn = console.error;

function safeJson(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

const { values } = parseArgs({
  options: {
    limit: { type: 'string' },
    games: { type: 'string' },
    out: { type: 'string', default: 'data/norosh/audit' },
    dir: { type: 'string', default: 'data/norosh/games' },
    trace: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});
if (values.help) {
  origLog('usage: npx tsx tools/norosh_audit.mts [--limit N] [--games a,b] [--out dir] [--dir games] [--trace gameId:round:honba]');
  process.exit(0);
}

const gamesDir = resolve(REPO_ROOT, values.dir!);
const outDir = resolve(REPO_ROOT, values.out!);
mkdirSync(outDir, { recursive: true });
let files = readdirSync(gamesDir).filter((f) => f.endsWith('.json')).sort();
if (values.games) {
  const want = new Set(values.games.split(',').map((s) => s.trim()).filter(Boolean));
  files = files.filter((f) => want.has(f.replace(/\.json$/, '')));
}
if (values.limit) files = files.slice(0, Number(values.limit));
const traceKey = values.trace ?? null;

type RoundLine = {
  gameId: string;
  round: number;
  honba: number;
  status: 'ok' | 'mismatch' | 'replay_error' | 'skipped';
  /** mismatch の内訳: core = 役/翻/符/基本点/サイコロ/祝儀種別の差、 soft = 春の支払時期・局中祝儀・点数移動だけの差 */
  mismatchKind: 'core' | 'soft' | null;
  reason: string | null;
  variant: string | null;
  goldNorthCount: number | null;
  tileSetMismatch: boolean;
  winners: { theirs: number[]; ours: number[] };
  ours: any;
  theirs: any;
  diff: string[];
  notes: string[];
  warnings: string[];
  /** 祝儀差の性質: match = 局合計一致、timing = 内訳だけ違い局合計は一致 [支払時期の差]、amount = 局合計も違う、
   *  dice = サイコロチャンスが絡む局 [出目再現の有無で額が変わるので別枠]、n/a = 次局なし */
  chipKind: 'match' | 'timing' | 'amount' | 'dice' | 'n/a' | null;
  /** 記録にあるがうちのエンジンが拒否した action [向こうの server も拒否したとみなして無視した] */
  ignoredActions: string[];
};

const lines: RoundLine[] = [];
const outJsonl = join(outDir, 'rounds.jsonl');
writeFileSync(outJsonl, '');

let gameIdx = 0;
for (const f of files) {
  gameIdx += 1;
  let g: TheirGame;
  try {
    g = JSON.parse(readFileSync(join(gamesDir, f), 'utf8')) as TheirGame;
  } catch (e: any) {
    process.stderr.write(`[${gameIdx}/${files.length}] ${f}: unreadable (${e?.message})\n`);
    continue;
  }
  const ruleSet = g.rule?.options?.ruleSet ?? null;
  const variant: string | null = ruleSet?.variant ?? null;
  const goldNorthCount: number | null = ruleSet?.tileSet?.goldNorthCount ?? null;
  const counts = { ok: 0, mismatch: 0, replay_error: 0, skipped: 0 };
  for (let ri = 0; ri < g.rounds.length; ri++) {
    const round = g.rounds[ri];
    const next = g.rounds[ri + 1] ?? null;
    const line = auditRound(g, round, next, ruleSet, variant, goldNorthCount, traceKey === `${g.gameId}:${round.round}:${round.honba}`);
    lines.push(line);
    counts[line.status] += 1;
    writeFileSync(outJsonl, JSON.stringify(line) + '\n', { flag: 'a' });
  }
  process.stderr.write(`[${gameIdx}/${files.length}] ${g.gameId} ${variant ?? '?'} gN=${goldNorthCount ?? '?'} rounds=${g.rounds.length} ok=${counts.ok} mismatch=${counts.mismatch} err=${counts.replay_error} skip=${counts.skipped}\n`);
}

// ---------------------------------------------------------------------------

function auditRound(g: TheirGame, round: TheirRound, next: TheirRound | null, ruleSet: any, variant: string | null, goldNorthCount: number | null, trace: boolean): RoundLine {
  const base: RoundLine = {
    gameId: g.gameId,
    round: round.round,
    honba: round.honba,
    status: 'skipped',
    mismatchKind: null,
    reason: null,
    variant,
    goldNorthCount,
    tileSetMismatch: goldNorthCount !== null && goldNorthCount !== 1,
    winners: { theirs: Object.keys(round.scoreResults ?? {}).map(Number), ours: [] },
    ours: null,
    theirs: null,
    diff: [],
    notes: [],
    warnings: [],
    chipKind: null,
    ignoredActions: [],
  };
  if (variant !== 'sanma') {
    base.reason = `variant ${variant ?? 'unknown'} not supported [sanma only]`;
    return base;
  }
  try {
    // うちのエンジンが拒否した action [向こうの server も拒否して記録だけ残った要求] は ignore に入れて再生し直す [最大 4 回]
    const ignore = new Set<number>();
    let walk = walkRound(round, { ignore });
    let setup: ReturnType<typeof setupRound> | null = null;
    let drive: ReturnType<typeof driveRound> | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      walk = walkRound(round, { ignore });
      base.warnings = walk.warnings;
      if (walk.problems.length > 0) {
        base.status = 'skipped';
        base.reason = `record inconsistent: ${walk.problems[0]}`;
        return base;
      }
      setup = setupRound(round, walk, ruleSet);
      drive = driveRound(setup, walk, { trace: trace ? (l) => process.stderr.write(l + '\n') : undefined });
      if (drive.status === 'rejected_action' && drive.rejectedIndex !== null && !ignore.has(drive.rejectedIndex)) {
        ignore.add(drive.rejectedIndex);
        base.ignoredActions.push(`#${drive.rejectedIndex}: ${drive.reason}`);
        continue;
      }
      break;
    }
    if (!setup || !drive) throw new Error('drive did not run');
    if (drive.status === 'rejected_action') {
      base.status = 'replay_error';
      base.reason = drive.reason;
      return base;
    }
    base.notes = drive.notes;
    base.winners.ours = drive.wins.map((w) => w.theirSeat);
    if (drive.status === 'unsupported') {
      base.status = 'skipped';
      base.reason = drive.reason;
      return base;
    }
    if (drive.status === 'replay_error') {
      base.status = 'replay_error';
      base.reason = drive.reason;
      return base;
    }
    // ---- compare ----
    const diff: string[] = [];
    const chipDiff: string[] = [];
    let diceInvolved = false;
    const theirsOut: any = { winners: {}, scoreDelta: null, chipDelta: null };
    const oursOut: any = { winners: {}, scoreDelta: {}, chipDelta: {}, pingju: drive.pingju, dice: drive.diceBreakdown };
    const theirWinners = Object.keys(round.scoreResults ?? {}).map(Number).sort();
    const ourWinners = drive.wins.map((w) => w.theirSeat).sort();
    if (theirWinners.join(',') !== ourWinners.join(',')) {
      diff.push(`winner: theirs=[${theirWinners.join(',')}] ours=[${ourWinners.join(',')}]`);
    }
    for (const ws of theirWinners) {
      const tr = round.scoreResults[String(ws)];
      const ts = summarizeTheirs(tr);
      theirsOut.winners[ws] = { ...ts, chips: chipSummaryTheirs(tr), dice: diceSummaryTheirs(tr), rankName: tr.rankName };
      const ow = drive.wins.find((w) => w.theirSeat === ws);
      if (!ow) continue;
      const os = summarizeOurs(ow.result);
      const ownEffects = drive.chipEffects.slice(ow.effectsStart, ow.effectsEnd);
      oursOut.winners[ws] = {
        ...os,
        chips: chipSummaryOurs(ownEffects, ow.seat),
        chipEffects: chipEffectLines(ownEffects, ow.seat),
        dice: diceSummaryOurs(ow.result),
        hand: ow.hand,
        fuyuLog: (ow.result?.fuyuLog ?? []).map((e: any) => `${e.pai}${e.tier === 'lower' ? '(下)' : ''}:${e.hit}`),
        hupai: (ow.result?.hupai ?? []).map((h: any) => `${h.name}(${h.fanshu})`),
        chipBreakdown: (ow.result?.chipBreakdown ?? []).map((e: any) => `${e.label}:${e.base}x${e.multiplier}=${e.total}:${e.mode}`),
      };
      compareYaku(ts, os, diff, ws);
      compareChips(chipSummaryTheirs(tr), chipSummaryOurs(ownEffects, ow.seat), chipDiff, ws);
      compareDice(diceSummaryTheirs(tr), diceSummaryOurs(ow.result), diff, ws);
      if (Object.keys(diceSummaryTheirs(tr)).length > 0 || Object.keys(diceSummaryOurs(ow.result)).length > 0) diceInvolved = true;
    }
    if (drive.diceBreakdown.length > 0) diceInvolved = true;
    // ---- score / chip deltas ----
    const gs = round.initialState.gameState;
    for (const p of [1, 2, 3]) {
      const ours = SEAT_TO_OURS[p];
      oursOut.scoreDelta[p] = setup.game.state.defen[ours] - setup.initialDefen[ours];
      oursOut.chipDelta[p] = setup.game.chipLedger[ours] - setup.initialChips[ours];
    }
    // リーチ棒は うちは lizhibang に退避、向こうは kyotaku。次局の初期点で比較するので供託分は両方とも点から引かれている
    if (next) {
      theirsOut.scoreDelta = {};
      theirsOut.chipDelta = {};
      const ngs = next.initialState.gameState;
      for (const p of [1, 2, 3]) {
        theirsOut.scoreDelta[p] = ngs.players[String(p)].score - gs.players[String(p)].score;
        theirsOut.chipDelta[p] = ngs.players[String(p)].chips - gs.players[String(p)].chips;
      }
      const sd = [1, 2, 3].filter((p) => theirsOut.scoreDelta[p] !== oursOut.scoreDelta[p]);
      if (sd.length > 0) diff.push(`score_delta: theirs=${fmtDelta(theirsOut.scoreDelta)} ours=${fmtDelta(oursOut.scoreDelta)}`);
      const cd = [1, 2, 3].filter((p) => theirsOut.chipDelta[p] !== oursOut.chipDelta[p]);
      // サイコロが絡む局は出目当ての額が両側で独立に決まる [向こう側だけの chance は再現できない] ので別枠に切る
      if (diceInvolved) {
        base.chipKind = 'dice';
        if (cd.length > 0) diff.push(`chip_delta_dice: theirs=${fmtDelta(theirsOut.chipDelta)} ours=${fmtDelta(oursOut.chipDelta)}`);
      } else if (cd.length > 0) {
        base.chipKind = 'amount';
        diff.push(`chip_delta: theirs=${fmtDelta(theirsOut.chipDelta)} ours=${fmtDelta(oursOut.chipDelta)}`);
      } else {
        base.chipKind = chipDiff.length > 0 ? 'timing' : 'match';
      }
    } else {
      base.notes.push('last round of game: no next-round scores to compare deltas');
      base.chipKind = diceInvolved ? 'dice' : 'n/a';
    }
    // 祝儀内訳の差は局合計の一致/不一致で意味が変わるので category にタグを付ける [chip:haru[timing] 等]
    for (const d of chipDiff) diff.push(d.replace(/^chip:([^:]+):/, `chip:$1[${base.chipKind}]:`));
    base.ours = oursOut;
    base.theirs = theirsOut;
    base.diff = diff;
    base.status = diff.length === 0 ? 'ok' : 'mismatch';
    if (base.status === 'mismatch') {
      base.mismatchKind = diff.every((d) => isSoftDiff(d)) ? 'soft' : 'core';
    }
    return base;
  } catch (e: any) {
    base.status = 'replay_error';
    base.reason = `adapter exception: ${e?.message ?? String(e)}`;
    return base;
  }
}

/** 採点そのものではなく支払いの時期・局中加算・多重和了の集計差で説明できる diff */
function isSoftDiff(d: string): boolean {
  return /^chip:[^:]*\[(timing|n\/a|dice)\]:/.test(d) || /^chip:haru/.test(d) || /^chip_delta(_dice)?:/.test(d) || /^score_delta:/.test(d) || /^dora_attr:/.test(d);
}

function fmtDelta(d: Record<number, number>): string {
  return `[${[1, 2, 3].map((p) => d[p]).join('/')}]`;
}

function compareYaku(t: YakuSummary, o: YakuSummary, diff: string[], ws: number): void {
  const keys = new Set([...Object.keys(t.han), ...Object.keys(o.han)]);
  // ドラ族 [表/赤/金/裏/北] は帰属が実装で違う [金 5 が向こうは golddora、うちは赤ドラ側や表ドラ側に乗る 等] ので
  // 族合計を先に比べ、合計が同じで内訳だけ違う時は dora_attr 1 行に畳む
  const tf = DORA_KEYS.reduce((acc, k) => acc + (t.han[k] ?? 0), 0);
  const of = DORA_KEYS.reduce((acc, k) => acc + (o.han[k] ?? 0), 0);
  const doraKeyDiff = DORA_KEYS.filter((k) => (t.han[k] ?? 0) !== (o.han[k] ?? 0));
  if (tf !== of) {
    diff.push(`dora_family: theirs=${tf} ours=${of} [seat${ws}]`);
    for (const k of doraKeyDiff) diff.push(`yaku:${k}: theirs=${t.han[k] ?? 0} ours=${o.han[k] ?? 0} [seat${ws}]`);
  } else if (doraKeyDiff.length > 0) {
    diff.push(`dora_attr: theirs={${DORA_KEYS.map((k) => `${k}:${t.han[k] ?? 0}`).join(',')}} ours={${DORA_KEYS.map((k) => `${k}:${o.han[k] ?? 0}`).join(',')}} [seat${ws}]`);
  }
  for (const k of keys) {
    if (DORA_KEYS.includes(k)) continue;
    const a = t.han[k] ?? 0;
    const b = o.han[k] ?? 0;
    if (a !== b) diff.push(`yaku:${k}: theirs=${a} ours=${b} [seat${ws}]`);
  }
  const ykeys = new Set([...Object.keys(t.yakuman), ...Object.keys(o.yakuman)]);
  for (const k of ykeys) {
    const a = t.yakuman[k] ?? 0;
    const b = o.yakuman[k] ?? 0;
    if (a !== b) diff.push(`yakuman:${k}: theirs=${a} ours=${b} [seat${ws}]`);
  }
  if (t.damanguan === 0 && o.damanguan === 0) {
    if (t.totalHan !== o.totalHan) diff.push(`han_total: theirs=${t.totalHan} ours=${o.totalHan} [seat${ws}]`);
    if (t.fu !== o.fu) diff.push(`fu: theirs=${t.fu} ours=${o.fu} [seat${ws}]`);
  }
  if (t.base !== o.base) diff.push(`base_points: theirs=${t.base} ours=${o.base} [seat${ws}]`);
}

function compareChips(t: Record<string, number>, o: Record<string, number>, diff: string[], ws: number): void {
  const keys = new Set([...Object.keys(t), ...Object.keys(o)]);
  for (const k of keys) {
    const a = t[k] ?? 0;
    const b = o[k] ?? 0;
    if (a !== b) diff.push(`chip:${k}: theirs=${a} ours=${b} [seat${ws}]`);
  }
}

function compareDice(t: Record<string, number>, o: Record<string, number>, diff: string[], ws: number): void {
  const keys = new Set([...Object.keys(t), ...Object.keys(o)]);
  for (const k of keys) {
    const a = t[k] ?? 0;
    const b = o[k] ?? 0;
    if (a !== b) diff.push(`dice:${k}: theirs=${a} ours=${b} [seat${ws}]`);
  }
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

/** replay_error の粗い分類 [summary.errorFamilies] */
function errorFamily(r: string | null): string {
  if (!r) return '(none)';
  if (/待ち牌全消失/.test(r)) return /フィーバー立直成立、/.test(r) ? 'fever: wait exhausted at declaration (ours ends, theirs continues)' : 'fever: wait exhausted after a win (ours ends, theirs continues)';
  if (/their DRAW .* already ended/.test(r)) {
    if (/🎉/.test(r)) return 'fever: our round ended after a win, theirs continues';
    if (/🎲/.test(r)) return 'our round ended with a dice chance, theirs continues';
    if (/🌀/.test(r)) return 'our round ended by ryukyoku, theirs continues';
    return 'our round ended, theirs continues (other)';
  }
  if (/シュバリ中、 見逃し不可。 ツモ/.test(r)) return 'shuvari: their record discards while our engine forces tsumo';
  if (/シュバリ中、 見逃し不可。 ロン/.test(r)) return 'shuvari: their record passes while our engine forces ron';
  if (/turn mismatch at (\w+)/.test(r)) return `turn mismatch at ${r.match(/turn mismatch at (\w+)/)![1]}`;
  if (/no ron window/.test(r)) return 'no ron window on our side';
  if (/hand mismatch/.test(r)) return 'hand mismatch';
  if (/flower .* not extracted/.test(r)) return 'flower not extracted on our side';
  if (/tsumo rejected/.test(r)) return /神ぽっち/.test(r) ? 'tsumo rejected: kami-pochi recalculation' : 'tsumo rejected';
  if (/discard .* rejected/.test(r)) return /フィーバー中の非宣言者/.test(r) ? 'discard rejected: fever non-declarer forced tsumogiri' : /待ち不変カンが必須/.test(r) ? 'discard rejected: forced kan after riichi' : 'discard rejected (other)';
  if (/rejected_action|no matching kan candidate|declareKan/.test(r)) return 'kan refused by our engine';
  if (/pass made no progress/.test(r)) return 'pass made no progress (other)';
  return normalizeReason(r).slice(0, 60);
}

function normalizeReason(r: string | null): string {
  if (!r) return '(none)';
  return r
    .replace(/\{.*\}$/, '')
    .replace(/#\d+/g, '#N')
    .replace(/\[[^\]]*\]/g, '[..]')
    .replace(/\b[mpsz][0-9]\b|\bg[psN]\b|\bz5[brgy]\b|\bf[1-4]\b/g, 'T')
    .replace(/seat\d/g, 'seatN')
    .replace(/p[0-2]\b/g, 'pN')
    .replace(/\d+/g, 'N')
    .slice(0, 120);
}

function diffCategory(d: string): string {
  const m = d.match(/^([a-z_]+)(?::([^:]+))?/);
  if (!m) return d;
  if (m[1] === 'yaku' || m[1] === 'yakuman' || m[1] === 'chip' || m[1] === 'dice') return `${m[1]}:${m[2]}`;
  return m[1];
}

const summary: any = {
  generatedAt: new Date().toISOString(),
  games: files.length,
  rounds: lines.length,
  status: { ok: 0, mismatch: 0, replay_error: 0, skipped: 0 },
  mismatchKind: { core: 0, soft: 0 },
  sanmaRounds: 0,
  replayed: 0,
  skippedReasons: {} as Record<string, number>,
  errors: {} as Record<string, { count: number; examples: string[] }>,
  errorFamilies: {} as Record<string, { count: number; examples: string[] }>,
  chipKind: {} as Record<string, number>,
  ignoredActions: 0,
  mismatchCategories: {} as Record<string, { count: number; examples: string[] }>,
  roundsWithDiffOnly: {} as Record<string, number>,
  warnings: {} as Record<string, number>,
};
for (const l of lines) {
  summary.status[l.status] += 1;
  if (l.variant === 'sanma') summary.sanmaRounds += 1;
  const id = `${l.gameId}:${l.round}-${l.honba}`;
  if (l.status === 'skipped') {
    const k = normalizeReason(l.reason);
    summary.skippedReasons[k] = (summary.skippedReasons[k] ?? 0) + 1;
  }
  if (l.status === 'replay_error') {
    const k = normalizeReason(l.reason);
    const e = (summary.errors[k] ??= { count: 0, examples: [] });
    e.count += 1;
    if (e.examples.length < 3) e.examples.push(`${id} :: ${l.reason}`);
    const fk = errorFamily(l.reason);
    const fe = (summary.errorFamilies[fk] ??= { count: 0, examples: [] });
    fe.count += 1;
    if (fe.examples.length < 3) fe.examples.push(`${id} :: ${(l.reason ?? '').slice(0, 300)}`);
  }
  if (l.ignoredActions.length > 0) summary.ignoredActions += 1;
  if (l.chipKind) summary.chipKind[l.chipKind] = (summary.chipKind[l.chipKind] ?? 0) + 1;
  if (l.status === 'ok' || l.status === 'mismatch') summary.replayed += 1;
  if (l.status === 'mismatch') {
    if (l.mismatchKind) summary.mismatchKind[l.mismatchKind] += 1;
    const cats = new Set(l.diff.map(diffCategory));
    for (const c of cats) {
      const e = (summary.mismatchCategories[c] ??= { count: 0, examples: [] });
      e.count += 1;
      if (e.examples.length < 3) {
        const d = l.diff.find((x) => diffCategory(x) === c) ?? '';
        const sm = d.match(/\[seat(\d)\]/);
        const ws = sm ? Number(sm[1]) : null;
        const ow = ws !== null ? l.ours?.winners?.[ws] : null;
        const tw = ws !== null ? l.theirs?.winners?.[ws] : null;
        const hand = ow ? ` :: hand=${String(ow.hand ?? '').split(' ')[0]} theirs{han=${tw?.totalHan} fu=${tw?.fu} base=${tw?.base} ${tw?.rankName ?? ''}} ours{han=${ow.totalHan} fu=${ow.fu} base=${ow.base}}` : '';
        e.examples.push(`${id} :: ${d}${hand}`);
      }
    }
    if (cats.size === 1) {
      const only = [...cats][0];
      summary.roundsWithDiffOnly[only] = (summary.roundsWithDiffOnly[only] ?? 0) + 1;
    }
  }
  for (const w of l.warnings) {
    const k = normalizeReason(w);
    summary.warnings[k] = (summary.warnings[k] ?? 0) + 1;
  }
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

origLog(`== norosh audit: ${summary.games} games / ${summary.rounds} rounds (sanma ${summary.sanmaRounds}) ==`);
origLog(`ok=${summary.status.ok} mismatch=${summary.status.mismatch} [core ${summary.mismatchKind.core} / soft ${summary.mismatchKind.soft}] replay_error=${summary.status.replay_error} skipped=${summary.status.skipped} | replayed to the end: ${summary.replayed}`);
origLog('-- skipped reasons --');
for (const [k, v] of Object.entries(summary.skippedReasons).sort((a: any, b: any) => b[1] - a[1])) origLog(`  ${v}  ${k}`);
origLog('-- replay error families --');
for (const [k, v] of Object.entries(summary.errorFamilies).sort((a: any, b: any) => b[1].count - a[1].count)) {
  origLog(`  ${(v as any).count}  ${k}`);
  for (const ex of (v as any).examples.slice(0, 1)) origLog(`       e.g. ${ex}`);
}
origLog(`-- chip kinds [rounds]: ${JSON.stringify(summary.chipKind)}  rounds with ignored (engine-refused) actions: ${summary.ignoredActions}`);
origLog('-- replay errors --');
for (const [k, v] of Object.entries(summary.errors).sort((a: any, b: any) => b[1].count - a[1].count)) {
  origLog(`  ${(v as any).count}  ${k}`);
  for (const ex of (v as any).examples) origLog(`       e.g. ${ex}`);
}
origLog('-- mismatch categories [rounds] --');
for (const [k, v] of Object.entries(summary.mismatchCategories).sort((a: any, b: any) => b[1].count - a[1].count)) {
  origLog(`  ${(v as any).count}  ${k}`);
  for (const ex of (v as any).examples.slice(0, 2)) origLog(`       e.g. ${ex}`);
}
origLog(`written: ${outJsonl}, ${join(outDir, 'summary.json')}`);
