// [2026-09-02 yuma] 対局続行不可能 [stall] 探索 fuzz。
//
// codex R3 fuzz [codex_r3_authority_fuzz_2026_07_23.test.ts] の seeded harness を流用し、
// 毎 step で「誰かが合法手を持つか」を RoomAuthority.validateAndApply で実測する。
// 通常 suite には入れない [STALL_HUNT=1 の時だけ走る]:
//   STALL_HUNT=1 npx vitest run authority_stall_hunt
// 調整 env: STALL_HUNT_SEEDS [既定 64] / STALL_HUNT_STEPS [既定 2000] /
//          STALL_HUNT_DUMP_DIR / STALL_HUNT_PROJECTION_EVERY [既定 50]
//
// liveness 判定 [毎 step、状態が変わるのは accept 時だけなので rejected 経由の状態は次 probe で拾う]:
//   (i)   誰かの client 操作 [discard/tsumo/ron/pon/kan/lizhi/post-win 選択 ...] が accept される
//   (ii)  局/試合が終わっていて nextRound [host なら nextMatch] が accept される
//   (iii) post-win pending の owner が実席で、server の代行 action が accept される
// さらに server 側 driver [turnTimeoutAction / reactionTimeoutAction / post-win 代行] が
// null や reject を返す状態は、CPU 席なら即停止、人間席なら AFK/切断時に永久 re-arm になるので
// 'driver' stall として別分類で記録する [ws_server.ts scheduleRoomDeadline の再帰張り直し]。
//
// stall を見つけたら seed/step/phase と canonical+mirror の要約、直近 5 command、試した候補と
// reject 理由を DUMP_DIR に JSON で落とす。seed と step で完全再現できる [mulberry32]。
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createRoomAuthority, type RoomAuthority } from '../../../server/authority';
import {
  captureSeatProjection,
  reactionTimeoutAction,
  turnTimeoutAction,
} from '../../../server/ws_server';
import { physicalDiscardCandidates } from '../game3/tileIdentity';
import { defaultSanmaRule, generateTilePool } from '../shan3';

const ENABLED = process.env.STALL_HUNT === '1';
const SEED_COUNT = Number(process.env.STALL_HUNT_SEEDS || 64);
const STEPS = Number(process.env.STALL_HUNT_STEPS || 2000);
const PROJECTION_EVERY = Number(process.env.STALL_HUNT_PROJECTION_EVERY || 50);
const DUMP_DIR = process.env.STALL_HUNT_DUMP_DIR
  || '/tmp/claude-1000/-home-m-catlab-secretary-v2-prod/09998d2f-bc99-45b7-919c-b976a027a663/scratchpad/anmika_stall/dumps';

type Member = { seat: number; is_cpu: boolean };
type Cand = { actor: number; action: any; tag: string };
type Phase = 'post-win' | 'reaction' | 'round-ended' | 'turn';

const MEMBER_CONFIGS: Array<{ label: string; cpu: number[] }> = [
  { label: 'HHH', cpu: [] },
  { label: 'HCC', cpu: [1, 2] },
  { label: 'HHC', cpu: [2] },
  { label: 'CCC', cpu: [0, 1, 2] },
];

/** Mulberry32: seed と step で完全再現 */
function rng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function shuffledPool(random: () => number): string[] {
  const tiles = generateTilePool(defaultSanmaRule()).map(String);
  for (let index = tiles.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [tiles[index], tiles[other]] = [tiles[other], tiles[index]];
  }
  return tiles;
}

function shuffle<T>(random: () => number, values: readonly T[]): T[] {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}

function choose<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)];
}

function ownerOf(pending: any): number {
  return pending?.decisionOwners?.[pending?.decisionOwnerIndex ?? 0] ?? pending?.winner ?? 0;
}

function kinpeiTarget(state: any, pending: any): string | null {
  const hua: string[] = pending.availableHuapai
    ?? state.game.effectiveHuapaiAtHule(pending.winner);
  return hua.includes('f4') ? 'fuyu'
    : hua.includes('f3') ? 'aki'
      : hua.includes('f2') ? 'natsu'
        : hua.includes('f1') ? 'haru'
          : null;
}

function isPostWinPending(state: any): boolean {
  return !!(state.pendingFuyu || state.pendingKinpei || state.pendingKamiPochi
    || state.pendingPochiSwap || state.pendingSaiKoro || state.pendingFeverContinue);
}

function phaseOf(authority: RoomAuthority): Phase {
  const state: any = authority.canonicalState();
  if (isPostWinPending(state)) return 'post-win';
  if (authority.awaitingRonDecision || authority.awaitingFulou || authority.pendingQianggang
    || state.awaitingRonDecision || state.awaitingFulou || state.pendingQianggang) return 'reaction';
  if (state.roundEnded || authority.roundEnded) return 'round-ended';
  return 'turn';
}

/** ws_server.ts computePostWinAutoAction / scheduleRoomDeadline と同じ server 代行 action */
function serverPostWinAction(state: any, random: () => number): Cand | null {
  if (state.pendingFuyu) {
    return { actor: ownerOf(state.pendingFuyu), action: { type: 'selectFuyu', use: true }, tag: 'srv:selectFuyu' };
  }
  if (state.pendingKinpei) {
    return {
      actor: ownerOf(state.pendingKinpei),
      action: { type: 'selectKinpei', target: kinpeiTarget(state, state.pendingKinpei) },
      tag: 'srv:selectKinpei',
    };
  }
  if (state.pendingKamiPochi) {
    const pending = state.pendingKamiPochi;
    return {
      actor: pending.decisionOwners?.[pending.decisionOwnerIndex] ?? pending.winner,
      action: { type: 'selectKamiPochi', target: pending.candidates?.[0], occurrenceKey: pending.occurrenceKey },
      tag: 'srv:selectKamiPochi',
    };
  }
  if (state.pendingPochiSwap) {
    const pending = state.pendingPochiSwap;
    return {
      actor: pending.decisionOwners?.[pending.decisionOwnerIndex] ?? pending.winner,
      action: { type: 'selectPochiSwap', target: pending.candidates?.[0]?.target },
      tag: 'srv:selectPochiSwap',
    };
  }
  if (state.pendingSaiKoro) {
    const pending = state.pendingSaiKoro;
    const chance = pending.chances?.[pending.currentIdx ?? 0];
    const actor = chance?.winner ?? pending.winner;
    if (!pending.selectedCombo) {
      return { actor, action: { type: 'selectSaiKoroCombo', small: 1, large: 6 }, tag: 'srv:selectSaiKoroCombo' };
    }
    if (!pending.finalized) {
      return {
        actor,
        action: { type: 'rollSaiKoroDice', override: [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)] },
        tag: 'srv:rollSaiKoroDice',
      };
    }
    return { actor, action: { type: 'advanceSaiKoro' }, tag: 'srv:advanceSaiKoro' };
  }
  if (state.pendingFeverContinue) {
    return { actor: state.pendingFeverContinue.winner, action: { type: 'continueFever' }, tag: 'srv:continueFever' };
  }
  return null;
}

/** client が押せる post-win 選択肢の全列挙 [owner 候補 × 選択肢] */
function humanPostWinCandidates(state: any, random: () => number): Cand[] {
  const out: Cand[] = [];
  const owners = (pending: any): number[] => {
    const list = Array.isArray(pending?.decisionOwners) && pending.decisionOwners.length > 0
      ? pending.decisionOwners
      : [pending?.winner];
    return list.filter((seat: unknown) => seat === 0 || seat === 1 || seat === 2);
  };
  if (state.pendingFuyu) {
    for (const actor of owners(state.pendingFuyu)) {
      for (const use of [true, false]) out.push({ actor, action: { type: 'selectFuyu', use }, tag: `selectFuyu:${use}` });
    }
  }
  if (state.pendingKinpei) {
    for (const actor of owners(state.pendingKinpei)) {
      for (const target of [null, 'haru', 'natsu', 'aki', 'fuyu']) {
        out.push({ actor, action: { type: 'selectKinpei', target }, tag: `selectKinpei:${target}` });
      }
    }
  }
  if (state.pendingKamiPochi) {
    const pending = state.pendingKamiPochi;
    for (const actor of owners(pending)) {
      for (const target of pending.candidates ?? []) {
        out.push({
          actor,
          action: { type: 'selectKamiPochi', target, occurrenceKey: pending.occurrenceKey },
          tag: `selectKamiPochi:${target}`,
        });
      }
    }
  }
  if (state.pendingPochiSwap) {
    const pending = state.pendingPochiSwap;
    for (const actor of owners(pending)) {
      for (const candidate of pending.candidates ?? []) {
        out.push({ actor, action: { type: 'selectPochiSwap', target: candidate?.target }, tag: `selectPochiSwap:${candidate?.target}` });
      }
    }
  }
  if (state.pendingSaiKoro) {
    const pending = state.pendingSaiKoro;
    const chance = pending.chances?.[pending.currentIdx ?? 0];
    const actor = chance?.winner ?? pending.winner;
    const small = 1 + Math.floor(random() * 6);
    let large = 1 + Math.floor(random() * 6);
    if (large === small) large = (small % 6) + 1;
    out.push({ actor, action: { type: 'selectSaiKoroCombo', small, large }, tag: 'selectSaiKoroCombo' });
    out.push({
      actor,
      action: { type: 'rollSaiKoroDice', override: [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)] },
      tag: 'rollSaiKoroDice',
    });
    out.push({ actor, action: { type: 'advanceSaiKoro' }, tag: 'advanceSaiKoro' });
  }
  if (state.pendingFeverContinue) {
    out.push({ actor: state.pendingFeverContinue.winner, action: { type: 'continueFever' }, tag: 'continueFever' });
  }
  return out;
}

function reactionCandidates(authority: RoomAuthority): Cand[] {
  const out: Cand[] = [];
  for (const player of authority.ronCandidates) {
    out.push({ actor: player, action: { type: 'ron', player }, tag: `ron:${player}` });
    out.push({ actor: player, action: { type: 'pass', player }, tag: `pass:${player}` });
  }
  for (const candidate of authority.ponCandidates) {
    for (const mianzi of candidate.mianzi) {
      out.push({ actor: candidate.player, action: { type: 'pon', player: candidate.player, mianzi }, tag: `pon:${mianzi}` });
    }
    out.push({ actor: candidate.player, action: { type: 'pass', player: candidate.player }, tag: `pass:${candidate.player}` });
  }
  for (const candidate of authority.kanCandidates) {
    for (const mianzi of candidate.mianzi) {
      out.push({ actor: candidate.player, action: { type: 'damingang', player: candidate.player, mianzi }, tag: `damingang:${mianzi}` });
    }
    out.push({ actor: candidate.player, action: { type: 'pass', player: candidate.player }, tag: `pass:${candidate.player}` });
  }
  return out;
}

function reactionDrivers(authority: RoomAuthority, members: Member[]): Cand[] {
  const seats = new Set<number>();
  for (const player of authority.ronCandidates) seats.add(player);
  for (const candidate of authority.ponCandidates) seats.add(candidate.player);
  for (const candidate of authority.kanCandidates) seats.add(candidate.player);
  const out: Cand[] = [];
  for (const seat of seats) {
    // ws_server は CPU 席の reaction deadline を skip する [CPU の反応は authority が即時解決する契約]
    if (members.find((member) => member.seat === seat)?.is_cpu) continue;
    out.push({ actor: seat, action: reactionTimeoutAction(authority, seat), tag: `srv:reaction:${seat}` });
  }
  return out;
}

/** current player の client 操作 [+ 他家の遅延シュバリ] */
function turnCandidates(authority: RoomAuthority, actor: number): Cand[] {
  const game = authority.game;
  const sp: any = game.shoupai.get(actor as 0 | 1 | 2);
  const out: Cand[] = [];
  out.push({ actor, action: { type: 'tsumo' }, tag: 'tsumo' });
  out.push({ actor, action: { type: 'tsumokiri' }, tag: 'tsumokiri' });
  out.push({ actor, action: { type: 'drawNext', player: actor }, tag: 'drawNext' });
  let core: string[] = [];
  try { core = (sp?.get_dapai?.(false) ?? []) as string[]; } catch { core = []; }
  const faces = new Set<string>(physicalDiscardCandidates(sp, core));
  for (const candidate of core) faces.add(String(candidate).replace(/[_*]$/, ''));
  // 北は河へ切れないが、client の互換経路 [dapai('z4') → 北抜き auto-route] があるので候補に含める
  faces.add('z4');
  faces.add('gN');
  for (const pai of faces) {
    if (!pai) continue;
    out.push({ actor, action: { type: 'discard', pai }, tag: `discard:${pai}` });
  }
  let kans: string[] = [];
  try { kans = game.getKanCandidates(actor as 0 | 1 | 2); } catch { kans = []; }
  for (const mianzi of kans) out.push({ actor, action: { type: 'declareKan', mianzi }, tag: `declareKan:${mianzi}` });
  out.push({ actor, action: { type: 'nukiBei', meta: { gold: false } }, tag: 'nukiBei' });
  out.push({ actor, action: { type: 'nukiBei', meta: { gold: true } }, tag: 'nukiBei:gold' });
  let canLizhi = false;
  try { canLizhi = game.canLizhi(actor as 0 | 1 | 2); } catch { canLizhi = false; }
  if (canLizhi) {
    for (const open of [false, true]) {
      for (const shuvari of [false, true]) {
        for (const fever of [false, true]) {
          out.push({ actor, action: { type: 'lizhi', opts: { open, shuvari, fever } }, tag: `lizhi:${open ? 'o' : ''}${shuvari ? 's' : ''}${fever ? 'f' : ''}` });
        }
      }
    }
  }
  for (const player of [0, 1, 2] as const) {
    let late = false;
    try { late = game.canDeclareLateShuvari(player); } catch { late = false; }
    if (late) out.push({ actor: player, action: { type: 'shuvari', player }, tag: `shuvari:${player}` });
  }
  return out;
}

function roundEndedCandidates(authority: RoomAuthority, random: () => number): Cand[] {
  const state: any = authority.canonicalState();
  const out: Cand[] = [];
  if (state.game.state.finished) {
    for (const finalize of [true, false]) {
      out.push({
        actor: 0,
        action: { type: 'nextMatch', preShuffledPool: shuffledPool(random), qijia: Math.floor(random() * 3), finalize, resetChip: false },
        tag: `nextMatch:${finalize}`,
      });
    }
  } else {
    out.push({
      actor: Math.floor(random() * 3),
      action: { type: 'nextRound', preShuffledPool: shuffledPool(random) },
      tag: 'nextRound',
    });
  }
  const winner = state.lastWinner;
  if (winner === 0 || winner === 1 || winner === 2) {
    let can = false;
    try { can = state.game.canAgariyame(winner); } catch { can = false; }
    if (can) out.push({ actor: winner, action: { type: 'agariyame' }, tag: 'agariyame' });
  }
  return out;
}

function roundEndedDriver(authority: RoomAuthority, members: Member[], random: () => number): Cand {
  const state: any = authority.canonicalState();
  if (state.game.state.finished) {
    return {
      actor: 0,
      action: { type: 'nextMatch', preShuffledPool: shuffledPool(random), qijia: Math.floor(random() * 3), finalize: true, resetChip: false },
      tag: 'srv:nextMatch',
    };
  }
  // 全員 ready gate は required[0] [human seat] を actor にする。人間が居ない部屋は seat 0 代行
  const human = members.find((member) => !member.is_cpu);
  return {
    actor: human?.seat ?? 0,
    action: { type: 'nextRound', preShuffledPool: shuffledPool(random) },
    tag: 'srv:nextRound',
  };
}

/** phase を無視した全列挙 [hard stall 判定の最終 fallback] */
function everyCandidate(authority: RoomAuthority, members: Member[], random: () => number): Cand[] {
  const state: any = authority.canonicalState();
  const out: Cand[] = [];
  const post = serverPostWinAction(state, random);
  if (post) out.push(post);
  out.push(...humanPostWinCandidates(state, random));
  out.push(...reactionDrivers(authority, members));
  out.push(...reactionCandidates(authority));
  for (const seat of [0, 1, 2]) {
    out.push({ actor: seat, action: reactionTimeoutAction(authority, seat), tag: `srv:reaction-any:${seat}` });
    out.push(...turnCandidates(authority, seat));
  }
  for (const isCpu of [false, true]) {
    const action = turnTimeoutAction(authority, isCpu);
    if (action) out.push({ actor: authority.currentPlayer(), action, tag: `srv:turn:${isCpu ? 'cpu' : 'human'}` });
  }
  out.push(roundEndedDriver(authority, members, random));
  out.push(...roundEndedCandidates(authority, random));
  return out;
}

function garbageAction(random: () => number): Cand {
  const actor = Math.floor(random() * 6) - 1;
  const tile = choose(random, ['', 'm1', 'p0', 'gp', 'np3', 'z4', 'z9', '__proto__']);
  const action = choose<any>(random, [
    null,
    {},
    { type: '' },
    { type: 'unknown', payload: { nested: [1, null, '__proto__'] } },
    { type: 'discard', pai: tile },
    { type: 'tsumokiri' },
    { type: 'drawNext', player: actor },
    { type: 'tsumo', player: actor },
    { type: 'ron', player: actor },
    { type: 'pass', player: actor },
    { type: 'pon', player: actor, mianzi: choose(random, ['', 'p111+', 'z444=']) },
    { type: 'damingang', player: actor, mianzi: 'p1111+' },
    { type: 'declareKan', mianzi: choose(random, ['', 'm1111', 'z4444']) },
    { type: 'nukiBei', meta: { gold: random() < 0.5 } },
    { type: 'lizhi', opts: { open: random() < 0.5, shuvari: random() < 0.5, fever: random() < 0.5 } },
    { type: 'shuvari', player: actor },
    { type: 'selectFuyu', use: choose(random, [true, false, 'yes']) },
    { type: 'selectKinpei', target: choose(random, [null, 'f1', '__bad__']) },
    { type: 'selectKamiPochi', pai: tile, occurrenceKey: 'stale' },
    { type: 'selectPochiSwap', target: tile },
    { type: 'selectSaiKoroCombo', small: Math.floor(random() * 10) - 2, large: Math.floor(random() * 10) - 2 },
    { type: 'rollSaiKoroDice', dice: [0, 99] },
    { type: 'advanceSaiKoro' },
    { type: 'continueFever' },
    { type: 'agariyame', accept: random() < 0.5 },
    { type: 'nextRound', preShuffledPool: [tile] },
    { type: 'nextMatch', preShuffledPool: [tile], qijia: actor, finalize: random() < 0.5, resetChip: random() < 0.5 },
    { type: 'cancelLizhi' },
  ]);
  return { actor, action, tag: 'garbage' };
}

function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Map) return Object.fromEntries(item);
    if (item instanceof Set) return [...item];
    if (typeof item === 'bigint') return String(item);
    if (typeof item === 'function') return undefined;
    if (item && typeof item === 'object') {
      if (seen.has(item)) return '[circular]';
      seen.add(item);
    }
    return item;
  }, 2);
}

function handOf(game: any, player: number) {
  const sp: any = game.shoupai.get(player);
  if (!sp) return null;
  return {
    text: typeof sp.toString === 'function' ? sp.toString() : null,
    zimo: sp._zimo ?? null,
    fulou: [...(sp._fulou ?? [])],
    anmika: sp._bingpai?.__anmika ?? null,
    hidden: sp._bingpai?._ ?? 0,
  };
}

function summarize(authority: RoomAuthority) {
  const state: any = authority.canonicalState();
  const game: any = state.game;
  return {
    canonical: {
      state: game.state,
      current: game.lunbanToPlayerId(game.state.lunban),
      paishu: game.shan.paishu,
      rinshanRemaining: game.shan.rinshanRemaining,
      canDrawRinshan: game.shan.canDrawRinshan,
      baopai: [...game.shan.baopai],
      hands: [0, 1, 2].map((player) => handOf(game, player)),
      rivers: [0, 1, 2].map((player) => [...(game.he.get(player)?._pai ?? [])]),
      huapai: game.huapai,
      lizhi: [...game.lizhi],
      openLizhi: [...game.openLizhi],
      lizhiDeclareDapai: game.lizhiDeclareDapai,
      feverActive: game.feverActive,
      feverTier: game.feverTier,
      shuvariActive: game.shuvariActive,
      shuvariUsed: game.shuvariUsed,
      lateShuvariWindow: game.lateShuvariWindow,
      nukidora: game.nukidora,
      nukidoraGold: game.nukidoraGold,
      qianggangPending: game.qianggangPending,
      lastZimo: state.lastZimo,
      lastDapai: state.lastDapai,
      lastWinner: state.lastWinner,
      roundEnded: state.roundEnded,
      pendingPingju: state.pendingPingju,
      awaitingRonDecision: state.awaitingRonDecision,
      awaitingFulou: state.awaitingFulou,
      ronPassedPlayers: state.ronPassedPlayers,
      ronDeclaredPlayers: state.ronDeclaredPlayers,
      ronCandidates: state.ronCandidates,
      ponCandidates: state.ponCandidates,
      kanCandidates: state.kanCandidates,
      lizhiPending: state.lizhiPending,
      lizhiPendingFlags: state.lizhiPendingFlags,
      _lizhiOpen: state._lizhiOpen,
      _lizhiShuvari: state._lizhiShuvari,
      _lizhiFever: state._lizhiFever,
      pendingFuyu: state.pendingFuyu,
      pendingKinpei: state.pendingKinpei,
      pendingKamiPochi: state.pendingKamiPochi,
      pendingPochiSwap: state.pendingPochiSwap,
      pendingSaiKoro: state.pendingSaiKoro,
      pendingFeverContinue: state.pendingFeverContinue,
      pendingQianggang: state.pendingQianggang,
      pendingNukiBei: state.pendingNukiBei,
      cpu: state.cpu,
      cpuWinAck: state.cpuWinAck,
      message: state.message,
      eventsTail: game.events.slice(-10),
    },
    mirror: {
      current: authority.currentPlayer(),
      lunban: authority.game.state.lunban,
      paishu: authority.game.shan.paishu,
      lastZimo: authority.lastZimo,
      lastDapai: authority.lastDapai,
      awaitingRonDecision: authority.awaitingRonDecision,
      awaitingFulou: authority.awaitingFulou,
      ronCandidates: authority.ronCandidates,
      ronPassedPlayers: authority.ronPassedPlayers,
      ronDeclaredPlayers: authority.ronDeclaredPlayers,
      ponCandidates: authority.ponCandidates,
      kanCandidates: authority.kanCandidates,
      pendingQianggang: authority.pendingQianggang,
      roundEnded: authority.roundEnded,
      lastWinner: authority.lastWinner,
      hands: [0, 1, 2].map((player) => handOf(authority.game, player)),
      lizhi: [...authority.game.lizhi],
      feverActive: authority.game.feverActive,
    },
  };
}

function briefAction(action: any): any {
  if (!action || typeof action !== 'object') return action;
  const copy: any = { ...action };
  if (Array.isArray(copy.preShuffledPool)) copy.preShuffledPool = `[${copy.preShuffledPool.length} tiles]`;
  return copy;
}

/** 状態を変えない rejected command の検出用。R3 の projection 込み fingerprint より軽い */
function cheapFingerprint(authority: RoomAuthority): string {
  const state: any = authority.canonicalState();
  const game: any = state.game;
  return JSON.stringify({
    mirror: {
      current: authority.currentPlayer(),
      lastZimo: authority.lastZimo,
      lastDapai: authority.lastDapai,
      awaitingRonDecision: authority.awaitingRonDecision,
      awaitingFulou: authority.awaitingFulou,
      ronCandidates: authority.ronCandidates,
      ronPassedPlayers: authority.ronPassedPlayers,
      ronDeclaredPlayers: authority.ronDeclaredPlayers,
      ponCandidates: authority.ponCandidates,
      kanCandidates: authority.kanCandidates,
      pendingQianggang: authority.pendingQianggang,
      roundEnded: authority.roundEnded,
      lastWinner: authority.lastWinner,
      lunban: authority.game.state.lunban,
      paishu: authority.game.shan.paishu,
      events: authority.game.events.length,
      hands: [0, 1, 2].map((player) => handOf(authority.game, player)),
    },
    canonical: {
      state: game.state,
      paishu: game.shan.paishu,
      hands: [0, 1, 2].map((player) => handOf(game, player)),
      rivers: [0, 1, 2].map((player) => [...(game.he.get(player)?._pai ?? [])]),
      lastZimo: state.lastZimo,
      lastDapai: state.lastDapai,
      lastWinner: state.lastWinner,
      roundEnded: state.roundEnded,
      pendingPingju: state.pendingPingju,
      awaitingRonDecision: state.awaitingRonDecision,
      awaitingFulou: state.awaitingFulou,
      lizhiPending: state.lizhiPending,
      pendingFuyu: state.pendingFuyu,
      pendingKinpei: state.pendingKinpei,
      pendingKamiPochi: state.pendingKamiPochi,
      pendingPochiSwap: state.pendingPochiSwap,
      pendingSaiKoro: state.pendingSaiKoro,
      pendingFeverContinue: state.pendingFeverContinue,
      pendingQianggang: state.pendingQianggang,
      chipLedger: game.chipLedger,
      events: game.events.length,
    },
  });
}

type Stall = {
  kind: 'hard' | 'driver' | 'throw' | 'mutation';
  seed: string;
  step: number;
  phase: Phase;
  members: string;
  detail: string;
  dump: string;
};

const findings: Stall[] = [];
const coverage = {
  seeds: 0,
  steps: 0,
  accepted: 0,
  rejected: 0,
  rounds: 0,
  matches: 0,
  postWin: 0,
  reactions: 0,
  wallMs: 0,
  byType: {} as Record<string, number>,
  byPhase: {} as Record<string, number>,
  byTag: {} as Record<string, number>,
};

function seedList(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (Math.imul(index + 1, 0x9e3779b9) ^ 0x2026_0902) >>> 0);
}

function writeDump(name: string, payload: unknown): string {
  mkdirSync(DUMP_DIR, { recursive: true });
  const file = join(DUMP_DIR, name);
  writeFileSync(file, safeJson(payload));
  return file;
}

describe.skipIf(!ENABLED)('authority stall hunt [STALL_HUNT=1]', { timeout: 3_600_000 }, () => {
  const startedAt = Date.now();

  afterAll(() => {
    coverage.wallMs = Date.now() - startedAt;
    mkdirSync(DUMP_DIR, { recursive: true });
    writeFileSync(join(DUMP_DIR, 'summary.json'), safeJson({ coverage, findings }));
    // eslint-disable-next-line no-console
    console.log(`[stall-hunt] seeds=${coverage.seeds} steps=${coverage.steps} accepted=${coverage.accepted} rejected=${coverage.rejected} rounds=${coverage.rounds} matches=${coverage.matches} postWin=${coverage.postWin} reactions=${coverage.reactions} wall=${(coverage.wallMs / 1000).toFixed(1)}s findings=${findings.length}`);
    if (findings.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[stall-hunt findings]\n' + findings.map((f) => `${f.kind} seed=${f.seed} step=${f.step} phase=${f.phase} members=${f.members} ${f.detail} -> ${f.dump}`).join('\n'));
    }
  });

  for (const [seedIndex, seed] of seedList(SEED_COUNT).entries()) {
    const seedHex = `0x${seed.toString(16).padStart(8, '0')}`;
    const config = MEMBER_CONFIGS[seedIndex % MEMBER_CONFIGS.length];
    it(`seed ${seedHex} members=${config.label}`, () => {
      const random = rng(seed);
      const members: Member[] = [0, 1, 2].map((seat) => ({ seat, is_cpu: config.cpu.includes(seat) }));
      const isCpu = (seat: number) => members.find((member) => member.seat === seat)?.is_cpu === true;
      const authority = createRoomAuthority({
        preShuffledPool: shuffledPool(random),
        qijia: Math.floor(random() * 3),
        changshu: random() < 0.5 ? 1 : 2,
      });
      authority.validateAndApply(-1, { type: 'unknown' }, members);

      const recent: Array<{ step: number; actor: number; action: any; tag: string }> = [];
      const localFindings: Stall[] = [];
      let hardStalled = false;

      const apply = (cand: Cand, step: number): string | null => {
        let reason: string | null = null;
        try {
          reason = authority.validateAndApply(cand.actor, cand.action, members);
        } catch (error: any) {
          const dump = writeDump(`throw_${seedHex}_step${step}.json`, {
            seed: seedHex, step, members: config.label, phase: phaseOf(authority),
            candidate: { ...cand, action: briefAction(cand.action) },
            error: String(error?.stack ?? error),
            state: summarize(authority),
            recent: recent.map((entry) => ({ ...entry, action: briefAction(entry.action) })),
          });
          localFindings.push({
            kind: 'throw', seed: seedHex, step, phase: phaseOf(authority), members: config.label,
            detail: `validateAndApply threw for ${cand.tag}: ${error?.message ?? error}`, dump,
          });
          return `threw: ${error?.message ?? error}`;
        }
        if (reason === null) {
          coverage.accepted += 1;
          const type = String(cand.action?.type);
          coverage.byType[type] = (coverage.byType[type] ?? 0) + 1;
          if (type === 'lizhi' || cand.tag.startsWith('srv:')) {
            coverage.byTag[cand.tag] = (coverage.byTag[cand.tag] ?? 0) + 1;
          }
          if (type === 'nextRound') coverage.rounds += 1;
          if (type === 'nextMatch') coverage.matches += 1;
          recent.push({ step, actor: cand.actor, action: cand.action, tag: cand.tag });
          if (recent.length > 5) recent.shift();
        } else {
          coverage.rejected += 1;
        }
        return reason;
      };

      const record = (kind: Stall['kind'], step: number, phase: Phase, detail: string, tried: Array<{ tag: string; actor: number; reason: string | null }>) => {
        const dump = writeDump(`${kind}_${seedHex}_step${step}.json`, {
          kind, seed: seedHex, step, members: config.label, phase, detail,
          state: summarize(authority),
          recent: recent.map((entry) => ({ ...entry, action: briefAction(entry.action) })),
          tried,
        });
        localFindings.push({ kind, seed: seedHex, step, phase, members: config.label, detail, dump });
      };

      for (let step = 0; step < STEPS && !hardStalled; step += 1) {
        coverage.steps += 1;
        const phase = phaseOf(authority);
        coverage.byPhase[phase] = (coverage.byPhase[phase] ?? 0) + 1;
        if (phase === 'post-win') coverage.postWin += 1;
        if (phase === 'reaction') coverage.reactions += 1;

        // ---- (1) garbage injection: rejected command must not mutate state ----
        if (random() < 0.2) {
          const garbage = garbageAction(random);
          const before = cheapFingerprint(authority);
          const reason = apply(garbage, step);
          if (reason !== null && cheapFingerprint(authority) !== before) {
            record('mutation', step, phase, `rejected garbage mutated state: ${garbage.tag} ${JSON.stringify(garbage.action)} reason=${reason}`, [{ tag: garbage.tag, actor: garbage.actor, reason }]);
          }
          continue;
        }

        // ---- (2) liveness probe ----
        const state: any = authority.canonicalState();
        const tried: Array<{ tag: string; actor: number; reason: string | null }> = [];
        let progressed = false;

        const tryCand = (cand: Cand): boolean => {
          const reason = apply(cand, step);
          tried.push({ tag: cand.tag, actor: cand.actor, reason });
          return reason === null;
        };

        // driver [server 代行] を先に評価するか
        let driverFirst: boolean;
        let drivers: Cand[] = [];
        let human: Cand[] = [];
        if (phase === 'post-win') {
          const driver = serverPostWinAction(state, random);
          drivers = driver ? [driver] : [];
          human = humanPostWinCandidates(state, random);
          driverFirst = (driver !== null && isCpu(driver.actor)) || random() < 0.35;
        } else if (phase === 'reaction') {
          drivers = reactionDrivers(authority, members);
          human = reactionCandidates(authority);
          driverFirst = random() < 0.35;
        } else if (phase === 'round-ended') {
          drivers = [roundEndedDriver(authority, members, random)];
          human = roundEndedCandidates(authority, random);
          driverFirst = random() < 0.6;
        } else {
          const current = authority.currentPlayer();
          const action = turnTimeoutAction(authority, isCpu(current));
          drivers = action ? [{ actor: current, action, tag: `srv:turn:${isCpu(current) ? 'cpu' : 'human'}` }] : [];
          human = turnCandidates(authority, current);
          driverFirst = isCpu(current) || random() < 0.25;
          if (!action) {
            tried.push({ tag: 'srv:turn', actor: current, reason: 'turnTimeoutAction returned null' });
          }
        }

        const runDrivers = (): boolean => {
          if (drivers.length === 0) {
            if (phase === 'reaction') {
              // ws_server の reaction deadline は CPU 席を skip する。候補が CPU 席だけなら
              // server 側に打つ手が無く、同じ期限を張り直し続ける [人間は他席の pass を送れない]
              const seats = [...new Set<number>([
                ...authority.ronCandidates,
                ...authority.ponCandidates.map((entry) => entry.player),
                ...authority.kanCandidates.map((entry) => entry.player),
              ])];
              if (seats.length > 0) {
                record('driver', step, phase, `reaction pending only for CPU seat(s) ${seats.join(',')}: server deadline has no action`, [...tried]);
              }
            }
            return false;
          }
          let any = false;
          let failed = false;
          for (const driver of drivers) {
            if (tryCand(driver)) any = true; else failed = true;
          }
          if (failed && phase === 'reaction') {
            // reaction は席ごとに独立。reject された席が候補のまま残っていれば次 deadline も同じ結果 = stall
            const stillPending = new Set<number>([
              ...authority.ronCandidates,
              ...authority.ponCandidates.map((entry) => entry.player),
              ...authority.kanCandidates.map((entry) => entry.player),
            ]);
            const stuck = drivers.filter((driver) => stillPending.has(driver.actor)
              && tried.some((entry) => entry.tag === driver.tag && entry.reason !== null));
            if (stuck.length > 0) {
              record('driver', step, phase, `reaction deadline rejected for seat(s) ${stuck.map((d) => d.actor).join(',')} that remain candidates`, [...tried]);
            }
            return any;
          }
          if (!any) {
            record('driver', step, phase, `server driver action rejected: ${drivers.map((d) => `${d.tag}=${JSON.stringify(briefAction(d.action))}`).join(' | ')}`, [...tried]);
          }
          return any;
        };

        const runHuman = (): boolean => {
          for (const cand of shuffle(random, human)) {
            if (tryCand(cand)) return true;
          }
          return false;
        };

        if (driverFirst) {
          if (drivers.length === 0 && phase === 'turn') {
            const current = authority.currentPlayer();
            record('driver', step, phase, `turnTimeoutAction(isCpu=${isCpu(current)}) returned null for current=${current}`, [...tried]);
          }
          progressed = runDrivers() || runHuman();
        } else {
          progressed = runHuman();
          if (!progressed) progressed = runDrivers();
        }

        if (!progressed) {
          // 最終 fallback: phase を無視して全部試す
          for (const cand of shuffle(random, everyCandidate(authority, members, random))) {
            if (tryCand(cand)) { progressed = true; break; }
          }
        }
        if (!progressed) {
          hardStalled = true;
          record('hard', step, phase, `no candidate accepted from any seat (${tried.length} tried)`, [...tried]);
        }

        // ---- (3) cheap invariants every step, projection invariants periodically ----
        const canonical: any = authority.canonicalState();
        expect(canonical.game.state.lunban, `seed=${seedHex} step=${step}: mirror/canonical lunban`).toBe(authority.game.state.lunban);
        expect(canonical.game.shan.paishu, `seed=${seedHex} step=${step}: mirror/canonical paishu`).toBe(authority.game.shan.paishu);
        expect([0, 1, 2]).toContain(authority.currentPlayer());
        if (step % PROJECTION_EVERY === 0) {
          for (const seat of [0, 1, 2]) {
            const projection: any = captureSeatProjection(authority, seat);
            expect(projection.privateHand, `seed=${seedHex} step=${step} seat=${seat}: privateHand`).not.toBeNull();
          }
          const spectator: any = captureSeatProjection(authority, -1);
          expect(spectator.privateHand).toBeNull();
        }
      }

      coverage.seeds += 1;
      findings.push(...localFindings);
      expect(
        localFindings.map((f) => `${f.kind}@${f.step}[${f.phase}] ${f.detail} -> ${f.dump}`),
        `seed=${seedHex} members=${config.label}: stall findings`,
      ).toEqual([]);
    });
  }
});
