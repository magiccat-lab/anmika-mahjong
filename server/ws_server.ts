// Authoritative WebSocket endpoint. FastAPI issues short-lived JWTs and owns
// lobby/auth HTTP APIs; every gameplay command is accepted only here.

import { randomInt as cryptoRandomInt, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import jwt from 'jsonwebtoken';
import { defaultSanmaRule, generateTilePool } from '../src/lib/shan3';
import { toCorePai } from '../src/lib/helpers';
// [2026-07-21 監査 L-05 fix] online CPU の判断を single mode [cpuStepImpl] と同じ
// 隠し情報ベースのヘルパーに揃える。旧実装は先頭候補と簡易 fever 判定で分岐していた
import { decideFever, pickLizhiDapai } from '../src/lib/store/cpuLizhi';
import { decideCpuShuvari } from '../src/lib/store/cpuShuvari';
import { createRoomAuthority, type AuthorityMember, type RoomAuthority } from './authority';
import { RoomPersistence } from './persistence';
import {
  appendAcceptedCommand,
  createEmptyRoomSnapshot,
  validateCommandEnvelope,
  type AcceptedRoomCommand,
  type CanonicalRoomSnapshot,
  type CommandAck,
  type OnlineSeatProjection,
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
const PLAYER_FIELD_ACTIONS = new Set(['ron', 'pass', 'pon', 'damingang', 'shuvari']);

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
  internalPort?: number;
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

/** A Shuvari player cannot waive a legal ron, even when their decision is
 * made by the disconnect/timeout watchdog.  Sending the generic pass here is
 * rejected by RoomAuthority and otherwise reschedules the same timeout
 * forever. */
export function reactionTimeoutAction(
  authority: RoomAuthority,
  seat: number,
): Record<string, unknown> {
  if (seat === 0 || seat === 1 || seat === 2) {
    const source = authority.pendingQianggang
      ? { player: authority.pendingQianggang.player, pai: authority.pendingQianggang.kakanPai }
      : authority.lastDapai;
    if (authority.ronCandidates.includes(seat)
      && source
      && authority.game.shuvariActive[seat]
      && authority.game.canRon(seat, source.pai, source.player)) {
      return { type: 'ron', player: seat };
    }
  }
  return { type: 'pass', player: seat };
}

/** Pick the same legal action that the acting client is allowed to submit
 * when its turn deadline expires.  In particular, a generic efficiency
 * discard is not legal after riichi selection, for an established riichi, or
 * for a non-declarer during FEVER. */
export function turnTimeoutAction(
  authority: RoomAuthority,
  isCpu = false,
): Record<string, unknown> | null {
  const current = authority.currentPlayer();
  const game = authority.game;
  const canonical = authority.canonicalState();
  // Once the player has selected a riichi kind, the only legal continuation
  // is its exact declaration discard.  A complete 14-tile hand can still have
  // riichi candidates, so a timeout must not override that committed choice
  // by auto-tsumoing instead.
  if (canonical.lizhiPending === current) {
    const normalCandidates = game.getLizhiCandidates(current);
    const feverPending = canonical.lizhiPendingFlags?.fever === true
      || canonical._lizhiFever === true;
    const candidates = feverPending
      ? normalCandidates.filter((pai) => game.feverCandidatesByDapai(current).has(pai))
      : normalCandidates;
    // getLizhiCandidates() and feverCandidatesByDapai() expose exact physical
    // faces, so the timeout commits the same gp/np3/z5* choice shown in the UI.
    // [2026-07-21 監査 L-05 fix] CPU の宣言牌は single mode と同じ pickLizhiDapai で
    // 待ちの広い方を選ぶ [旧実装は候補先頭固定]。human timeout は先頭のままでよい
    if (candidates.length > 0) {
      const pai = isCpu ? pickLizhiDapai(game, current, candidates).pai : candidates[0];
      return { type: 'discard', pai };
    }
    // [2026-07-20] フィーバーを選んだ後にカン等で成立牌が消えると候補が空になる。
    // ここで null を返すと呼び出し側が同じ期限を張り直すだけなので、局が
    // 永久に止まる。フィーバーは諦めて通常のリーチ宣言牌へ落とし、進行を優先する。
    if (normalCandidates.length > 0) {
      const pai = isCpu ? pickLizhiDapai(game, current, normalCandidates).pai : normalCandidates[0];
      return { type: 'discard', pai };
    }
    return null;
  }

  // Without a committed two-stage declaration, a legal win takes priority
  // over every other continuation.
  if (game.canTsumo(current)) return { type: 'tsumo' };

  // This ruleset makes a wait-preserving post-riichi kan compulsory.  It also
  // precedes north extraction and the otherwise forced tsumogiri.
  const forcedKan = game.getForcedLizhiKanCandidates(current);
  if (forcedKan.length > 0) return { type: 'declareKan', mianzi: forcedKan[0] };

  // [2026-07-21 監査 L-05 fix] CPU の三元牌自動暗槓 [z5-z7 の 4 枚揃い] を single mode
  // [cpuStepImpl] と揃える。役牌 1 役 + 新ドラ確定で正収益。旧 online path はこれを
  // 通らず、single とだけ挙動が分岐していた
  if (isCpu && !game.lizhi.has(current)) {
    const spKan = game.shoupai.get(current);
    const zimoLen = typeof spKan?._zimo === 'string' ? spKan._zimo.length : 0;
    if (zimoLen > 0 && zimoLen <= 3) {
      const kanMianzis = game.getKanCandidates(current);
      const sanyuanKan = kanMianzis.find((m) => {
        const head = `${m[0]}${m[1]}`;
        return head === 'z5' || head === 'z6' || head === 'z7';
      });
      if (sanyuanKan) return { type: 'declareKan', mianzi: sanyuanKan };
    }
  }

  // North is nuki-only and is resolved before a forced discard.  Preserve the
  // physical identity so a drawn gN cannot consume an ordinary held north.
  const sp = game.shoupai.get(current);
  const drawnNorth = authority.lastZimo && toCorePai(authority.lastZimo) === 'z4';
  if ((drawnNorth || isCpu) && game.canNukiBei(current)) {
    const goldNorth = Number(game.goldHand[current]?.z ?? 0);
    const normalNorth = Math.max(0, Number(sp?._bingpai?.z?.[4] ?? 0) - goldNorth);
    const useGold = drawnNorth
      ? authority.lastZimo === 'gN'
      : normalNorth === 0 && goldNorth > 0;
    return { type: 'nukiBei', meta: { gold: useGold } };
  }

  // Human timeouts must never opt into a new riichi.  A server-owned CPU,
  // however, may not remain dama in this table: declare first and let the next
  // deadline commit the exact physical candidate through the pending branch.
  // [2026-07-21 監査 L-05 fix] fever を取るか / シュバるかを single mode と同じ
  // decideFever / decideCpuShuvari で判定する [旧実装は「合法 fever があれば必ず取る」
  // 「シュバ一切なし」だった]。宣言牌の physical 確定は pending 分岐が担う
  if (isCpu && game.canLizhi(current)) {
    const normalCandidates = game.getLizhiCandidates(current);
    const lizhiCandidateSet = new Set(normalCandidates.map((pai) => pai.replace(/[_*]$/, '')));
    const feverMap = game.feverCandidatesByDapai(current);
    const rawZimo = typeof sp?._zimo === 'string' ? sp._zimo.replace(/[_*]$/, '') : null;
    const zimoPai = rawZimo && rawZimo.length <= 3 ? rawZimo : null;
    const legalFever = [...feverMap.keys()].filter((pai) => lizhiCandidateSet.has(pai.replace(/[_*]$/, '')));
    const feverDapai = zimoPai && legalFever.includes(zimoPai) ? zimoPai : (legalFever[0] ?? null);
    if (feverDapai) {
      const fc = feverMap.get(feverDapai);
      const fd = fc ? decideFever(game, current, feverDapai, fc.tier, { rainbow: fc.rainbow }) : null;
      if (fc && fd?.takeFever) {
        const sd = decideCpuShuvari(game, current, { discardPai: feverDapai, feverTier: fc.tier });
        return { type: 'lizhi', opts: { fever: true, shuvari: sd.shuvari } };
      }
    }
    const picked = pickLizhiDapai(game, current, normalCandidates);
    const sd = decideCpuShuvari(game, current, { discardPai: picked.pai });
    return { type: 'lizhi', opts: { shuvari: sd.shuvari } };
  }

  const someoneFever = ([0, 1, 2] as const).some((player) => game.feverActive[player]);
  if ((game.lizhi.has(current) || (someoneFever && !game.feverActive[current])) && authority.lastZimo) {
    return { type: 'tsumokiri' };
  }

  const pai = game.pickBestDiscard(current)
    ?? (typeof sp?._zimo === 'string' && sp._zimo.length <= 3 ? sp._zimo : null)
    ?? ((sp?.get_dapai?.(false) ?? []) as string[])
      .find((candidate) => toCorePai(candidate.replace(/_$/, '')) !== 'z4')
      ?.replace(/_$/, '');
  return pai ? { type: 'discard', pai } : null;
}

export function restoreAuthority(
  snapshot: CanonicalRoomSnapshot,
  commands?: AcceptedRoomCommand[],
): RoomAuthority | null {
  if (!snapshot.started || !snapshot.start) return null;
  const authority = createRoomAuthority({
    preShuffledPool: snapshot.start.preShuffledPool,
    qijia: snapshot.start.qijia,
  });
  const members = snapshot.start.members.map((member) => ({ seat: member.seat, is_cpu: member.is_cpu }));
  const cmds = commands ?? snapshot.commands;
  for (const command of cmds) {
    if (command.action.type === 'stamp') continue;
    const reason = authority.validateAndApply(command.actorSeat, command.action, members);
    if (reason) {
      throw new Error(`cannot restore room ${snapshot.roomId} at revision ${command.revision}: ${reason}`);
    }
  }
  return authority;
}

type BlindStartState = {
  hands: Record<number, string[]>;
  handCounts: Record<number, number>;
  huapai: Record<number, string[]>;
  goldHand: Record<number, { p: number; s: number; z: number }>;
  pochiHand: Record<number, Record<string, number>>;
  firstZimo: string | null;
  firstZimoPlayer: number | null;
  paishu: number;
  baopai: string[];
  fubaopai: string[] | null;
  canDrawRinshan: boolean;
};

type ActionCapture = {
  eventsLength: number;
  baopai: string[];
  fubaopai: string[] | null;
  fuyuRevealedLength: number;
};

function captureBlindStart(authority: RoomAuthority): BlindStartState {
  const g = authority.game;
  const hands: Record<number, string[]> = {};
  const handCounts: Record<number, number> = {};
  const huapai: Record<number, string[]> = {};
  const goldHand: Record<number, { p: number; s: number; z: number }> = {};
  const pochiHand: Record<number, Record<string, number>> = {};
  for (const p of [0, 1, 2] as const) {
    const qipaiEvent = g.events.findLast((e: any) => e.type === 'qipai' && e.player === p);
    hands[p] = qipaiEvent?.type === 'qipai' ? [...qipaiEvent.tiles] : [];
    handCounts[p] = hands[p].length + (g.lastZimoInfo.player === p && authority.lastZimo ? 1 : 0);
    huapai[p] = [...(g.huapai?.[p] ?? [])];
    goldHand[p] = { ...(g.goldHand?.[p] ?? { p: 0, s: 0, z: 0 }) };
    pochiHand[p] = { ...(g.pochiHand?.[p] ?? { blue: 0, red: 0, green: 0, yellow: 0 }) };
  }
  return {
    hands, handCounts, huapai, goldHand, pochiHand,
    firstZimo: authority.lastZimo,
    firstZimoPlayer: g.lastZimoInfo.player,
    paishu: g.shan.paishu,
    baopai: [...g.shan.baopai],
    fubaopai: g.shan.fubaopai ? [...g.shan.fubaopai] : null,
    canDrawRinshan: g.shan.canDrawRinshan,
  };
}

function maskBlindStart(state: BlindStartState, recipientSeat: number): Record<string, unknown> {
  const emptyGold = () => ({ p: 0, s: 0, z: 0 });
  const emptyPochi = () => ({ blue: 0, red: 0, green: 0, yellow: 0 });
  const hands: Record<number, string[]> = { 0: [], 1: [], 2: [] };
  const goldHand: Record<number, { p: number; s: number; z: number }> = {
    0: emptyGold(), 1: emptyGold(), 2: emptyGold(),
  };
  const pochiHand: Record<number, Record<string, number>> = {
    0: emptyPochi(), 1: emptyPochi(), 2: emptyPochi(),
  };
  if (recipientSeat === 0 || recipientSeat === 1 || recipientSeat === 2) {
    hands[recipientSeat] = [...(state.hands[recipientSeat] ?? [])];
    goldHand[recipientSeat] = { ...(state.goldHand[recipientSeat] ?? emptyGold()) };
    pochiHand[recipientSeat] = { ...(state.pochiHand[recipientSeat] ?? emptyPochi()) };
  }
  return {
    hands,
    handCounts: { ...state.handCounts },
    huapai: structuredClone(state.huapai),
    goldHand,
    pochiHand,
    firstZimo: state.firstZimoPlayer === recipientSeat ? state.firstZimo : null,
    firstZimoPlayer: state.firstZimoPlayer,
    privateSeat: recipientSeat,
    paishu: state.paishu,
    baopai: [...state.baopai],
    canDrawRinshan: state.canDrawRinshan,
    // Ura indicators remain secret until a valid win reaches its resolution pipeline.
    fubaopai: null,
  };
}

function serializePrivateHand(sp: any): Record<string, unknown> | null {
  if (!sp?._bingpai) return null;
  const bp = sp._bingpai;
  return {
    bingpai: {
      _: bp._ ?? 0,
      m: [...(bp.m ?? [])],
      p: [...(bp.p ?? [])],
      s: [...(bp.s ?? [])],
      z: [...(bp.z ?? [])],
      anmika: bp.__anmika ? { ...bp.__anmika } : null,
    },
    fulou: [...(sp._fulou ?? [])],
    zimo: sp._zimo ?? null,
    anmikaZimo: sp._anmikaZimo ?? null,
    anmikaFulou: structuredClone(sp._anmikaFulou ?? []),
    anmikaFulouPhysical: structuredClone(sp._anmikaFulouPhysical ?? []),
  };
}

function concealedCount(sp: any): number {
  if (!sp?._bingpai) return 0;
  const bp = sp._bingpai;
  let count = Number(bp._ ?? 0);
  for (const suit of ['m', 'p', 's'] as const) {
    for (let number = 1; number <= 9; number += 1) count += Number(bp[suit]?.[number] ?? 0);
  }
  for (let number = 1; number <= 7; number += 1) count += Number(bp.z?.[number] ?? 0);
  return count;
}

/**
 * Expand a concealed Shoupai into physical Anmika tile names.  Core Shoupai
 * counts merge red/gold/rainbow/pochi copies, so subtract the expanded
 * inventory before adding those copies back under their physical names.
 */
function physicalConcealedTiles(sp: any): string[] {
  if (!sp?._bingpai) return [];
  const bp = sp._bingpai;
  const expanded = bp.__anmika ?? {};
  const out: string[] = [];
  const push = (pai: string, count: unknown): void => {
    const n = Math.max(0, Number(count) || 0);
    for (let index = 0; index < n; index += 1) out.push(pai);
  };

  for (const suit of ['m', 'p', 's', 'z'] as const) {
    const max = suit === 'z' ? 7 : 9;
    for (let number = 1; number <= max; number += 1) {
      if (suit === 'z' && number === 5) continue;
      let count = Number(bp[suit]?.[number] ?? 0);
      if ((suit === 'p' || suit === 's') && number === 5) {
        // p/s[5] includes every five; index 0 holds red + gold copies.
        count -= Number(bp[suit]?.[0] ?? 0);
      }
      if (suit === 'z' && number === 4) count -= Number(expanded.gN ?? 0);
      if (suit === 'p' && number === 3) count -= Number(expanded.np3 ?? 0);
      if (suit === 's' && number === 3) count -= Number(expanded.ns3 ?? 0);
      if (suit === 'z' && number === 3) count -= Number(expanded.nz3 ?? 0);
      push(`${suit}${number}`, count);
    }
  }

  push('p0', Number(bp.p?.[0] ?? 0) - Number(expanded.gp ?? 0));
  push('gp', expanded.gp);
  push('s0', Number(bp.s?.[0] ?? 0) - Number(expanded.gs ?? 0));
  push('gs', expanded.gs);
  push('gN', expanded.gN);
  push('np3', expanded.np3);
  push('ns3', expanded.ns3);
  push('nz3', expanded.nz3);
  push('z5b', expanded.z5b);
  push('z5r', expanded.z5r);
  push('z5g', expanded.z5g);
  push('z5y', expanded.z5y);
  const coloredZ5 = ['z5b', 'z5r', 'z5g', 'z5y']
    .reduce((sum, key) => sum + Number(expanded[key] ?? 0), 0);
  // Keep old/imported plain z5 data visible as z5 without inventing a color.
  push('z5', Number(bp.z?.[5] ?? 0) - coloredZ5);
  return out;
}

function publicWaitCore(pai: string): string {
  const stripped = String(pai ?? '').replace(/[+=\-_*]/g, '');
  const core = toCorePai(stripped);
  return core.length >= 2 && core[1] === '0' ? `${core[0]}5` : core;
}

type FeverWaitPublicInfo = {
  player: 0 | 1 | 2;
  waits: Array<{
    tile: string;
    remain: number;
    hasRed: boolean;
    hasGold: boolean;
    hasNiji: boolean;
  }>;
};

function confirmedFeverWaitInfo(game: any): {
  waitInfo: FeverWaitPublicInfo[];
  waitsByDeclarer: Map<0 | 1 | 2, Set<string>>;
} {
  const liveWall = [...((game.shan as any)._pai ?? [])] as string[];
  const waitInfo: FeverWaitPublicInfo[] = [];
  const waitsByDeclarer = new Map<0 | 1 | 2, Set<string>>();
  for (const player of [0, 1, 2] as const) {
    if (!game.isFeverConfirmed(player)) continue;
    const rawWaits = [...(game.feverDeclareTing?.[player] ?? [])] as string[];
    const waits = new Set(rawWaits.map(publicWaitCore).filter(Boolean));
    waitsByDeclarer.set(player, waits);
    const seen = new Set<string>();
    const rows: FeverWaitPublicInfo['waits'] = [];
    for (const rawWait of rawWaits) {
      const core = publicWaitCore(rawWait);
      if (!core || seen.has(core)) continue;
      seen.add(core);
      // Rule 5-2: a white wait whose only physical copies are pochi does not
      // keep FEVER alive.  Keep it in waitsByDeclarer for hand exposure, but
      // publish zero surviving wall copies.
      const remaining = core === 'z5'
        ? []
        : liveWall.filter((pai) => publicWaitCore(pai) === core);
      rows.push({
        tile: core,
        remain: remaining.length,
        hasRed: remaining.some((pai) => pai === 'p0' || pai === 's0'),
        hasGold: remaining.some((pai) => pai === 'gp' || pai === 'gs' || pai === 'gN'),
        hasNiji: remaining.some((pai) => pai === 'np3' || pai === 'ns3' || pai === 'nz3'),
      });
    }
    waitInfo.push({ player, waits: rows });
  }
  return { waitInfo, waitsByDeclarer };
}

function publicEventForSeat(event: any, recipientSeat: number): Record<string, unknown> {
  if (event?.type === 'qipai') {
    return { type: 'qipai', player: event.player, count: Array.isArray(event.tiles) ? event.tiles.length : 13 };
  }
  if (event?.type === 'zimo') {
    return { type: 'zimo', player: event.player, pai: event.player === recipientSeat ? event.pai : null };
  }
  return structuredClone(event);
}

function isPostWinState(state: ReturnType<RoomAuthority['canonicalState']>): boolean {
  return !!state.lastHuleResult
    || state.ronResults.length > 0
    || !!state.pendingFuyu
    || !!state.pendingKinpei
    || !!state.pendingKamiPochi
    || !!state.pendingPochiSwap
    || !!state.pendingSaiKoro
    || !!state.pendingFeverContinue
    || (state.roundEnded && state.lastWinner !== null);
}

function postWinWinners(state: ReturnType<RoomAuthority['canonicalState']>): Set<number> {
  const winners = new Set<number>();
  const add = (value: unknown) => {
    if (value === 0 || value === 1 || value === 2) winners.add(value);
  };
  add(state.lastWinner);
  for (const result of state.ronResults) add(result.player);
  for (const pending of [
    state.pendingFuyu,
    state.pendingKinpei,
    state.pendingKamiPochi,
    state.pendingPochiSwap,
    state.pendingFeverContinue,
  ]) {
    if (!pending) continue;
    add(pending.winner);
    const otherWinners = (pending as { otherWinners?: unknown[] }).otherWinners;
    if (Array.isArray(otherWinners)) for (const winner of otherWinners) add(winner);
  }
  if (state.pendingSaiKoro) {
    add(state.pendingSaiKoro.winner);
    for (const chance of state.pendingSaiKoro.chances) add((chance as { winner?: unknown }).winner);
  }
  return winners;
}

/** Ura indicators are public only when at least one actual winner of this hand
 * had declared riichi.  A losing riichi player must not reveal them for a
 * non-riichi winner, including while post-win choices are still pending. */
export function shouldRevealUra(authority: RoomAuthority): boolean {
  const state = authority.canonicalState();
  // Do not expose ura while another player still has a ron/pass decision.
  // In a double-ron window, the first declared winner may already appear in
  // ronResults, but later responders must decide without seeing hidden dora.
  if (state.awaitingRonDecision || state.pendingQianggang) return false;
  if (!isPostWinState(state)) return false;
  return [...postWinWinners(state)].some((winner) => state.game.lizhi.has(winner as 0 | 1 | 2));
}

/**
 * Seat-scoped canonical state.  A client may optimistically run its local
 * reducer for animation, but this projection is the source of truth after
 * every accepted command and on every reconnect.
 */
export function captureSeatProjection(authority: RoomAuthority, recipientSeat: number): OnlineSeatProjection {
  const state = authority.canonicalState();
  const game = state.game;
  // A first ron declaration can populate ronResults while another seat is
  // still deciding.  Treat that as an unresolved reaction window, not as a
  // public post-win state: private pochi/payment fields could otherwise help
  // the remaining player decide whether to ron or pass.
  const revealPostWinPrivateState = isPostWinState(state)
    && !state.awaitingRonDecision
    && !state.pendingQianggang;
  // [2026-07-21 監査 S-02 fix] ダブロンの反応窓が開いている間は、先に宣言した和了者の
  // 評価結果 [lastWinner / lastHuleResult / ronResults / message] と評価中の秋処理で
  // 増えた追加表示牌が broadcast に乗り、残りのプレイヤーが結果を見てロン/パスを
  // 選べた。窓が閉じるまで result 系を neutral にし、確定後に一括公開する。
  const reactionWindowOpen = state.awaitingRonDecision || !!state.pendingQianggang;
  const revealUra = shouldRevealUra(authority);
  const emptyGold = () => ({ p: 0, s: 0, z: 0 });
  const emptyPochi = () => ({ blue: 0, red: 0, green: 0, yellow: 0 });
  const maskedGold: Record<number, { p: number; s: number; z: number }> = {
    0: emptyGold(), 1: emptyGold(), 2: emptyGold(),
  };
  const maskedPochi: Record<number, Record<string, number>> = {
    0: emptyPochi(), 1: emptyPochi(), 2: emptyPochi(),
  };
  if (recipientSeat === 0 || recipientSeat === 1 || recipientSeat === 2) {
    maskedGold[recipientSeat] = { ...game.goldHand[recipientSeat] };
    maskedPochi[recipientSeat] = { ...game.pochiHand[recipientSeat] };
  }
  const { waitInfo: feverWaitPublicInfo, waitsByDeclarer } = confirmedFeverWaitInfo(game);
  const publicHands: Record<number, Record<string, unknown>> = {};
  for (const player of [0, 1, 2] as const) {
    const sp: any = game.shoupai.get(player);
    // [2026-07-22 リョー報告: 他の人のアガリがback表示] 和了確定後 [反応窓クローズ後] は
    // 勝者の手牌を全席に開示する。従来はオープンリーチとフィーバーだけが開示対象で、
    // 通常の和了は勝者以外の画面で手牌が裏のままだった
    const isPostWinRevealedWinner = revealPostWinPrivateState
      && postWinWinners(state).has(player);
    const publiclyRevealed = game.openLizhi.has(player)
      || (game.feverActive[player] && game.feverDeclareDapaiPlayer !== player)
      || isPostWinRevealedWinner;
    const exposedWaits = new Set<string>();
    for (const [declarer, waits] of waitsByDeclarer) {
      if (declarer === player) continue;
      for (const wait of waits) exposedWaits.add(wait);
    }
    const revealedWaitTiles = exposedWaits.size === 0
      ? []
      : physicalConcealedTiles(sp).filter((pai) => exposedWaits.has(publicWaitCore(pai)));
    const zimo = typeof sp?._zimo === 'string' ? sp._zimo : null;
    publicHands[player] = {
      concealedCount: concealedCount(sp),
      hasZimo: zimo !== null && zimo.length <= 3,
      pseudoZimo: zimo !== null && zimo.length > 3 ? zimo : null,
      fulou: [...(sp?._fulou ?? [])],
      anmikaFulou: structuredClone(sp?._anmikaFulou ?? []),
      anmikaFulouPhysical: structuredClone(sp?._anmikaFulouPhysical ?? []),
      revealedHand: publiclyRevealed ? serializePrivateHand(sp) : null,
      revealedWaitTiles,
    };
  }
  const own = recipientSeat === 0 || recipientSeat === 1 || recipientSeat === 2
    ? recipientSeat as 0 | 1 | 2
    : null;
  const ownRonCandidates = own !== null && authority.ronCandidates.includes(own) ? [own] : [];
  const ownPonCandidates = own === null ? [] : state.ponCandidates.filter((entry) => entry.player === own);
  const ownKanCandidates = own === null ? [] : state.kanCandidates.filter((entry) => entry.player === own);
  const maskOwnerDecision = (pending: any): any => {
    if (!pending) return null;
    if (pending.winner === own) return structuredClone(pending);
    const value: any = pending;
    return {
      winner: value.winner,
      isRon: value.isRon,
      ronfrom: value.ronfrom,
    };
  };
  const neutralMultiplier = { defen: 1, chip: 1 };
  const pochiMultiplier = {
    0: own === 0 || revealPostWinPrivateState ? { ...game.pochiMultiplier[0] } : { ...neutralMultiplier },
    1: own === 1 || revealPostWinPrivateState ? { ...game.pochiMultiplier[1] } : { ...neutralMultiplier },
    2: own === 2 || revealPostWinPrivateState ? { ...game.pochiMultiplier[2] } : { ...neutralMultiplier },
  };
  const maskPrivateRecord = <T>(record: Record<0 | 1 | 2, T>, fallback: T): Record<number, T> => ({
    0: own === 0 || revealPostWinPrivateState ? structuredClone(record[0]) : structuredClone(fallback),
    1: own === 1 || revealPostWinPrivateState ? structuredClone(record[1]) : structuredClone(fallback),
    2: own === 2 || revealPostWinPrivateState ? structuredClone(record[2]) : structuredClone(fallback),
  });
  const shan: any = game.shan;
  return {
    schemaVersion: 1,
    recipientSeat,
    gameState: structuredClone(game.state),
    shan: {
      paishu: game.shan.paishu,
      // [2026-07-21 秋ドラ表示漏れ 根治] 確定表示分 [displayBaopai] だけを配信する。
      // hule() の秋カスケードが評価中/modal中に伸ばした未 commit めくりは含めない
      // [applyHule / kan で commit されるまで表示しない]。S-02 の反応窓スライスも
      // committed が pre-win に据え置かれるため subsume される
      baopai: [...game.shan.displayBaopai],
      // 裏ドラは committed かつ revealUra [リーチ和了確定] の時だけ現物を送る
      fubaopai: revealUra && game.shan.displayFubaopai ? [...game.shan.displayFubaopai] : null,
      kanDoraCount: game.shan.kanDoraCount,
      rinshanUsed: game.shan.rinshanUsed,
      canDrawRinshan: game.shan.canDrawRinshan,
      fuyuRevealed: [...(shan._fuyuRevealed ?? [])],
    },
    privateHand: own === null ? null : serializePrivateHand(game.shoupai.get(own)),
    publicHands,
    rivers: {
      0: [...(game.he.get(0)?._pai ?? [])],
      1: [...(game.he.get(1)?._pai ?? [])],
      2: [...(game.he.get(2)?._pai ?? [])],
    },
    publicEvents: game.events.map((event) => publicEventForSeat(event, recipientSeat)),
    fields: {
      nukidora: structuredClone(game.nukidora),
      nukidoraGold: structuredClone(game.nukidoraGold),
      yifaActive: structuredClone(game.yifaActive),
      lizhiDeclareDapai: structuredClone(game.lizhiDeclareDapai),
      lingshangActive: structuredClone(game.lingshangActive),
      lingshangFromKan: structuredClone(game.lingshangFromKan),
      firstTurnState: structuredClone(game.firstTurnState),
      qianggangPending: game.qianggangPending,
      feverWinCount: structuredClone(game.feverWinCount),
      goldHand: maskedGold,
      huapai: structuredClone(game.huapai),
      pochiHand: maskedPochi,
      lastZimoInfo: game.lastZimoInfo.player === own
        ? structuredClone(game.lastZimoInfo)
        : { player: game.lastZimoInfo.player, pai: null, pochi: null, gold: false },
      pochiMultiplier,
      pochiPaymentMode: maskPrivateRecord(game.pochiPaymentMode, false),
      pochiChipReverse: maskPrivateRecord(game.pochiChipReverse, false),
      pochiChipDouble: maskPrivateRecord(game.pochiChipDouble, false),
      chipLedger: structuredClone(game.chipLedger),
      haruActive: structuredClone(game.haruActive),
      fuyuSkip: structuredClone(game.fuyuSkip),
      fuyuConsumed: structuredClone(game.fuyuConsumed),
      fuyuRevealState: structuredClone(game.fuyuRevealState),
      akiUsedCount: structuredClone(game.akiUsedCount),
      kinpeiTarget: maskPrivateRecord(game.kinpeiTarget, null),
      kamiPochiDoraChoices: structuredClone(game.kamiPochiDoraChoices),
      pochiSwapChoice: structuredClone(game.pochiSwapChoice),
      chipBreakdown: structuredClone(game.chipBreakdown),
      discardLog: structuredClone(game.discardLog),
      justNukidBei: structuredClone(game.justNukidBei),
      lizhi: [...game.lizhi],
      doubleLizhi: [...game.doubleLizhi],
      openLizhi: [...game.openLizhi],
      feverActive: structuredClone(game.feverActive),
      // Rule 5-2: waits and exact live-wall remainder become public only after
      // the declaration tile's ron window has closed and FEVER is confirmed.
      feverWaitPublicInfo,
      feverDeclareTing: {
        0: game.feverDeclareDapaiPlayer === 0 && own !== 0 ? [] : [...game.feverDeclareTing[0]],
        1: game.feverDeclareDapaiPlayer === 1 && own !== 1 ? [] : [...game.feverDeclareTing[1]],
        2: game.feverDeclareDapaiPlayer === 2 && own !== 2 ? [] : [...game.feverDeclareTing[2]],
      },
      feverTier: structuredClone(game.feverTier),
      feverDeclareDapaiPlayer: game.feverDeclareDapaiPlayer,
      feverPendingShuvari: structuredClone(game.feverPendingShuvari),
      feverSaiAwarded: structuredClone(game.feverSaiAwarded),
      shuvariActive: structuredClone(game.shuvariActive),
      shuvariUsed: structuredClone(game.shuvariUsed),
      lateShuvariWindow: structuredClone(game.lateShuvariWindow),
      tobiChipPaid: game.tobiChipPaid,
    },
    store: {
      matchStartChipLedger: authority.currentMatchStartChipLedger(),
      lastZimo: game.lastZimoInfo.player === own ? state.lastZimo : null,
      lastDapai: structuredClone(state.lastDapai),
      // S-02: 反応窓中は先に宣言した和了者の結果を neutral 化 [宣言の発声
      // = ronDeclaredPlayers はパブリックのまま]
      lastWinner: reactionWindowOpen ? null : state.lastWinner,
      lastHuleResult: reactionWindowOpen ? null : structuredClone(state.lastHuleResult),
      awaitingRonDecision: state.awaitingRonDecision,
      ronCandidates: ownRonCandidates,
      ronPassedPlayers: own === null ? [] : state.ronPassedPlayers.filter((player) => player === own),
      ronDeclaredPlayers: structuredClone(state.ronDeclaredPlayers),
      ronResults: reactionWindowOpen ? [] : structuredClone(state.ronResults),
      awaitingFulou: state.awaitingFulou,
      ponCandidates: structuredClone(ownPonCandidates),
      kanCandidates: structuredClone(ownKanCandidates),
      roundEnded: state.roundEnded,
      // [2026-07-22 リョー報告] 「player N リーチ、宣言牌を選んで…」の操作プロンプトが
      // 他家にも出ていた。宣言者本人以外には送らない [状態は status 行が名前付きで示す]。
      // S-02 の反応窓マスクが最優先
      message: reactionWindowOpen && isPostWinState(state)
        ? 'ロン宣言 受付中 [他家の判断待ち]'
        : (state.lizhiPending !== null && state.lizhiPending !== own ? null : state.message),
      cpu: structuredClone(state.cpu),
      lizhiPending: state.lizhiPending === own ? own : null,
      // The two-stage declaration choice is private to the acting seat until
      // the discard is made, but that seat must receive it on every ack and
      // reconnect.  Without these fields the UI forgets FEVER/open/Shuvari
      // and can highlight declaration tiles that the authority will reject.
      lizhiPendingFlags: state.lizhiPending === own
        ? structuredClone(state.lizhiPendingFlags ?? null)
        : null,
      _lizhiOpen: state.lizhiPending === own && state._lizhiOpen === true,
      _lizhiShuvari: state.lizhiPending === own && state._lizhiShuvari === true,
      _lizhiFever: state.lizhiPending === own && state._lizhiFever === true,
      pendingKinpei: structuredClone(state.pendingKinpei),
      pendingFuyu: structuredClone(state.pendingFuyu),
      pendingKamiPochi: structuredClone(state.pendingKamiPochi),
      pendingPochiSwap: structuredClone(state.pendingPochiSwap),
      pendingFeverContinue: maskOwnerDecision(state.pendingFeverContinue as any),
      pendingPingju: state.pendingPingju,
      pendingQianggang: structuredClone(state.pendingQianggang),
      pendingNukiBei: structuredClone(state.pendingNukiBei ?? null),
      pendingSaiKoro: structuredClone(state.pendingSaiKoro),
      cpuWinAck: state.cpuWinAck,
      // [2026-07-21 監査 L-03] 演出 cutin を権威イベントとして seat 共通で送る。
      // client は ts で dedup し未再生のものだけ再生する。broadcastAction 後に
      // canonical から drain されるので、この projection には「この action 分」だけ載る
      cutin: structuredClone((state as any).cutin ?? null),
      cutinQueue: structuredClone((state as any).cutinQueue ?? []),
    },
  } as unknown as OnlineSeatProjection;
}

function captureBeforeAction(authority: RoomAuthority): ActionCapture {
  const g = authority.game;
  return {
    eventsLength: g.events.length,
    // [2026-07-21 秋ドラ表示漏れ 根治] 確定表示分でめくり差分を取る。未 commit の
    // 秋カスケードめくりは newBaopai/doraDraws 化されない [applyHule/kan で commit
    // された時のみ差分が出て演出が発火する = 上がりまで表示増えない]
    baopai: [...g.shan.displayBaopai],
    fubaopai: g.shan.displayFubaopai ? [...g.shan.displayFubaopai] : null,
    fuyuRevealedLength: (((g.shan as any)._fuyuRevealed ?? []) as string[]).length,
  };
}

export function captureActionEffects(authority: RoomAuthority, before: ActionCapture): Record<string, unknown> | null {
  const g = authority.game;
  const postBaopai = [...g.shan.displayBaopai];
  const postFubaopai = g.shan.displayFubaopai ? [...g.shan.displayFubaopai] : null;
  const newBaopai = postBaopai.slice(before.baopai.length);
  const newFubaopai = before.fubaopai && postFubaopai
    ? postFubaopai.slice(before.fubaopai.length)
    : [];
  const newEvents = g.events.slice(before.eventsLength);
  const drawEvent = newEvents.findLast((event: any) => event.type === 'zimo') as any;
  const fuyuAll = (((g.shan as any)._fuyuRevealed ?? []) as string[]);
  const fuyuRevealed = fuyuAll.slice(before.fuyuRevealedLength);
  const revealUra = shouldRevealUra(authority);
  if (!drawEvent && newBaopai.length === 0 && newFubaopai.length === 0
    && fuyuRevealed.length === 0 && !revealUra) return null;
  const doraDraws: Array<{ tile: string; isFu: boolean }> = [];
  const maxDora = Math.max(newBaopai.length, newFubaopai.length);
  for (let index = 0; index < maxDora; index += 1) {
    if (newBaopai[index]) doraDraws.push({ tile: newBaopai[index], isFu: false });
    if (newFubaopai[index]) doraDraws.push({ tile: newFubaopai[index], isFu: true });
  }
  return {
    player: drawEvent?.player ?? null,
    lastZimo: drawEvent?.pai ?? null,
    paishu: g.shan.paishu,
    huapai: [...g.shan.lastDrawnHuapai],
    gold: g.shan.lastZimoGold,
    pochi: g.shan.lastZimoPochi,
    newBaopai: newBaopai.length > 0 ? newBaopai : undefined,
    newFubaopai: newFubaopai.length > 0 ? newFubaopai : undefined,
    doraDraws: doraDraws.length > 0 ? doraDraws : undefined,
    fuyuRevealed: fuyuRevealed.length > 0 ? fuyuRevealed : undefined,
    revealFubaopai: revealUra ? postFubaopai : undefined,
  };
}

function sanitizeActionForSeat(actionInput: Record<string, unknown>, recipientSeat: number): Record<string, unknown> {
  const action = { ...actionInput };
  delete action.preShuffledPool;
  if (action._blindState && typeof action._blindState === 'object') {
    action._blindState = maskBlindStart(action._blindState as BlindStartState, recipientSeat);
  }
  if (action._draw && typeof action._draw === 'object') {
    const draw = { ...(action._draw as Record<string, unknown>) };
    const ownDraw = draw.player === recipientSeat;
    if (!ownDraw) {
      draw.lastZimo = null;
      delete draw.gold;
      delete draw.pochi;
    }
    // Ura-dora draws stay server-only until revealFubaopai is present.
    if (!Array.isArray(draw.revealFubaopai)) {
      delete draw.newFubaopai;
      if (Array.isArray(draw.doraDraws)) {
        draw.doraDraws = (draw.doraDraws as Array<Record<string, unknown>>)
          .filter((entry) => entry.isFu !== true);
      }
    }
    action._draw = draw;
  }
  return action;
}

function actionRelay(
  command: AcceptedRoomCommand,
  snapshot: CanonicalRoomSnapshot,
  recipientSeat: number,
  authority: RoomAuthority | null,
  duplicate = false,
) {
  const action = sanitizeActionForSeat(command.action, recipientSeat);
  if (authority) action._state = captureSeatProjection(authority, recipientSeat);
  return {
    type: 'action',
    commandId: command.commandId,
    revision: command.revision,
    matchId: snapshot.matchId,
    roundId: snapshot.roundId,
    from_seat: command.actorSeat,
    from_user_id: command.fromUserId,
    duplicate,
    action,
  };
}

function sendJson(ws: WebSocket | null, payload: unknown): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch { /* socket closed between check and send */ }
}

function broadcast(room: Room, payload: unknown): void {
  for (const member of room.members.values()) sendJson(member.ws, payload);
}

function broadcastAction(room: Room, command: AcceptedRoomCommand): void {
  for (const member of room.members.values()) {
    sendJson(member.ws, actionRelay(command, room.snapshot, member.seat, room.authority));
  }
  // [2026-07-21 監査 L-03] 各 seat の projection に cutin を載せて配り終えたので、
  // canonical から drain して cutinQueue の無限蓄積を防ぐ [server は pop しないため]
  room.authority?.takePendingCutins();
}

function sendSync(
  ws: WebSocket | null,
  snapshot: CanonicalRoomSnapshot,
  recipientSeat: number,
  authority: RoomAuthority | null,
  fullCommands?: AcceptedRoomCommand[],
): void {
  const payload = fullCommands ? { ...snapshot, commands: fullCommands } : snapshot;
  let sanitizedStart = payload.start;
  if (sanitizedStart && sanitizedStart.preShuffledPool?.length > 0) {
    const tempAuth = createRoomAuthority({ preShuffledPool: sanitizedStart.preShuffledPool, qijia: sanitizedStart.qijia });
    const blindData = captureBlindStart(tempAuth);
    sanitizedStart = {
      ...sanitizedStart,
      preShuffledPool: [],
      ...maskBlindStart(blindData, recipientSeat),
      blindStart: true,
    } as any;
  }
  const commands = (payload.commands ?? []).map((command) => ({
    ...command,
    action: sanitizeActionForSeat(command.action, recipientSeat),
  }));
  sendJson(ws, {
    type: 'sync',
    snapshot: {
      ...payload,
      start: sanitizedStart,
      commands,
      state: authority ? captureSeatProjection(authority, recipientSeat) : null,
    },
  });
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

export function resolveActorSeat(room: Room, uid: string, seat: number, action: Record<string, unknown>) {
  const actorSeat = seat;
  // [2026-07-21 監査 S-01 fix] client 起点の cpuRelay [host が CPU action を代理送信] を廃止。
  // host は「その CPU が選んだ action か」を証明できず、不正候補が revision を消費しない性質と
  // 合わせて隠し手牌の oracle 探索・CPU 直接操作に使えた。CPU action は権威サーバーの
  // deadline driver [turnTimeoutAction、CPU 席は 750ms] だけが生成する。
  if (action.cpuRelay === true) {
    return { actorSeat, reason: 'cpuRelay is no longer accepted; CPU actions are server-driven' };
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
    const response = await fetch(`${apiBase}/api/internal/rooms/${roomId}/members`, {
      headers: { 'X-Anmika-Internal-Secret': internalApiSecret },
    });
    if (!response.ok) throw new Error(`member authority returned ${response.status}`);
    const data = await response.json() as { members?: Array<Record<string, unknown>> };
    if (!Array.isArray(data.members)) throw new Error('member authority response missing members');
    return data.members
      .filter((member) => typeof member.user_id === 'string' && typeof member.seat === 'number')
      .map((member) => ({
        seat: member.seat as number,
        user_id: member.user_id as string,
        username: typeof member.username === 'string' ? member.username : String(member.user_id),
        is_cpu: member.is_cpu === true || String(member.user_id).startsWith('CPU_'),
      }));
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
    const dbCommands = snapshot.started ? persistence.loadCommands(roomId) : [];
    const room: Room = {
      roomId,
      hostUserId,
      members: new Map(),
      authority: restoreAuthority(snapshot, dbCommands),
      snapshot: { ...snapshot, commands: [] },
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
    // WSA: 復元した started room に deadline を再設定 [Node再起動後の自動進行停止を防ぐ]
    if (room.authority && room.snapshot.started) {
      scheduleRoomDeadline(room);
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
      // WSA: stamp は revision を進めない。broadcast だけして早期 return
      broadcast(room, { type: 'stamp', seat: actorSeat, stampId: action.stampId });
      return { reason: null };
    } else {
      if (!room.authority) return { reason: 'authority not initialized' };
      if (action.type === 'rollSaiKoroDice') {
        action.override = [cryptoRandomInt(1, 7), cryptoRandomInt(1, 7)];
      }
      if (action.type === 'nextRound' || action.type === 'nextMatch') {
        action.preShuffledPool = serverShuffledPool();
      }
      if (action.type === 'nextMatch') {
        // [2026-07-22 リョー報告: 次の試合へで同じ東1局に戻る]
        // 権威側の nextMatch は post-win pending [サイコロ未消化等] が残っていると
        // store 実装が無言 no-op になり、投影が旧試合へスナップバックしていた。
        // host の明示操作 = 試合を締める意思なので、残りの勝ち処理を自動消化してから進める
        for (let guard = 0; guard < 60; guard++) {
          const canonical = room.authority.canonicalState();
          if (!canonical.game.state?.finished) break;
          const auto = computePostWinAutoAction(canonical);
          if (!auto) break;
          const autoReason = room.authority.validateAndApply(auto.owner, auto.action, membersForAuthority(room));
          if (autoReason) {
            warn('[anmika-ws] nextMatch fast-forward reject', autoReason, auto.action?.type);
            break;
          }
        }
      }
      if (action.type === 'nextMatch') {
        // The host may choose whether accumulated chips are reset.  All other
        // settlement inputs are derived from canonical server state.
        action.resetChip = action.resetChip === true;
        action.finalize = action.resetChip !== true;
        action.qijia = room.authority.game.state.qijia;
        action.cpuSeats = membersForAuthority(room)
          .filter((member) => member.is_cpu)
          .map((member) => member.seat);
        delete action.chipLedger;
      }
      const beforeEffects = captureBeforeAction(room.authority);
      const reason = room.authority.validateAndApply(actorSeat, action, membersForAuthority(room));
      if (reason) {
        room.authority = restoreAuthority(previous, persistence.loadCommands(room.roomId));
        return { reason };
      }
      const drawData = captureActionEffects(room.authority, beforeEffects);
      if (action.type === 'nextRound' || action.type === 'nextMatch') {
        action._blindState = captureBlindStart(room.authority!);
      } else if (drawData) {
        action._draw = drawData;
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
      room.authority = restoreAuthority(previous, persistence.loadCommands(room.roomId));
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
          broadcastAction(room, accepted.command);
          scheduleRoomDeadline(room);
        }
      }).catch((error) => warn('[anmika-ws] next-round deadline failed', error));
    }, nextRoundTimeoutMs);
    return null;
  };

  /** post-win pending [冬/金北/神ぽっち/高目/サイコロ/フィーバー継続] の自動消化アクション。
   *  deadline 代行と nextMatch 前の fast-forward [2026-07-22] で共用 */
  const computePostWinAutoAction = (
    canonical: ReturnType<RoomAuthority['canonicalState']>,
  ): { owner: number; action: Record<string, unknown> } | null => {
    if (canonical.pendingFuyu) {
      const pending = canonical.pendingFuyu;
      return {
        owner: pending.decisionOwners?.[pending.decisionOwnerIndex ?? 0] ?? pending.winner,
        action: { type: 'selectFuyu', use: true },
      };
    }
    if (canonical.pendingKinpei) {
      const pending = canonical.pendingKinpei;
      const hua = pending.availableHuapai
        ?? canonical.game.effectiveHuapaiAtHule(pending.winner as 0 | 1 | 2);
      const target = hua.includes('f4') ? 'fuyu'
        : hua.includes('f3') ? 'aki'
        : hua.includes('f2') ? 'natsu'
        : hua.includes('f1') ? 'haru'
        : null;
      return {
        owner: pending.decisionOwners?.[pending.decisionOwnerIndex ?? 0] ?? pending.winner,
        action: { type: 'selectKinpei', target },
      };
    }
    if (canonical.pendingKamiPochi) {
      const pending = canonical.pendingKamiPochi;
      return {
        owner: pending.decisionOwners[pending.decisionOwnerIndex] ?? pending.winner,
        action: { type: 'selectKamiPochi', target: pending.candidates[0], occurrenceKey: pending.occurrenceKey },
      };
    }
    if (canonical.pendingPochiSwap) {
      const pending = canonical.pendingPochiSwap;
      return {
        owner: pending.decisionOwners[pending.decisionOwnerIndex] ?? pending.winner,
        action: { type: 'selectPochiSwap', target: pending.candidates[0]?.target },
      };
    }
    if (canonical.pendingSaiKoro) {
      const pending = canonical.pendingSaiKoro;
      const chance = pending.chances[pending.currentIdx] as any;
      const owner = chance?.winner ?? pending.winner;
      const action = !pending.selectedCombo
        ? { type: 'selectSaiKoroCombo', small: 1, large: 6 }
        : !pending.finalized
          ? { type: 'rollSaiKoroDice', override: [cryptoRandomInt(1, 7), cryptoRandomInt(1, 7)] }
          : { type: 'advanceSaiKoro' };
      return { owner, action };
    }
    if (canonical.pendingFeverContinue) {
      return { owner: canonical.pendingFeverContinue.winner, action: { type: 'continueFever' } };
    }
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
      const pending = canonical.pendingFuyu;
      postWinOwner = pending.decisionOwners?.[pending.decisionOwnerIndex ?? 0] ?? pending.winner;
      postWinAction = { type: 'selectFuyu', use: true };
    } else if (canonical.pendingKinpei) {
      const pending = canonical.pendingKinpei;
      postWinOwner = pending.decisionOwners?.[pending.decisionOwnerIndex ?? 0] ?? pending.winner;
      const hua = pending.availableHuapai
        ?? canonical.game.effectiveHuapaiAtHule(pending.winner as 0 | 1 | 2);
      const target = hua.includes('f4') ? 'fuyu'
        : hua.includes('f3') ? 'aki'
        : hua.includes('f2') ? 'natsu'
        : hua.includes('f1') ? 'haru'
        : null;
      postWinAction = { type: 'selectKinpei', target };
    } else if (canonical.pendingKamiPochi) {
      const pending = canonical.pendingKamiPochi;
      postWinOwner = pending.decisionOwners[pending.decisionOwnerIndex] ?? pending.winner;
      postWinAction = {
        type: 'selectKamiPochi',
        target: pending.candidates[0],
        occurrenceKey: pending.occurrenceKey,
      };
    } else if (canonical.pendingPochiSwap) {
      const pending = canonical.pendingPochiSwap;
      postWinOwner = pending.decisionOwners[pending.decisionOwnerIndex] ?? pending.winner;
      postWinAction = { type: 'selectPochiSwap', target: pending.candidates[0]?.target };
    } else if (canonical.pendingSaiKoro) {
      const pending = canonical.pendingSaiKoro;
      const chance = pending.chances[pending.currentIdx] as any;
      postWinOwner = chance?.winner ?? pending.winner;
      postWinAction = !pending.selectedCombo
        ? { type: 'selectSaiKoroCombo', small: 1, large: 6 }
        : !pending.finalized
          ? { type: 'rollSaiKoroDice', override: [cryptoRandomInt(1, 7), cryptoRandomInt(1, 7)] }
          : { type: 'advanceSaiKoro' };
    } else if (canonical.pendingFeverContinue) {
      postWinOwner = canonical.pendingFeverContinue.winner;
      postWinAction = { type: 'continueFever' };
    }
    if (postWinOwner !== null && postWinAction) {
      const owner = Array.from(room.members.values()).find((item) => item.seat === postWinOwner);
      // 2026-07-16 リョー報告: CPU owner の 750ms 刻みだと client の演出 [サイコロ spin 等] が
      // 追いつかず「押す前に済んでチップが動いた」体験になる。solo の App 側 driver と同じ
      // 「見える」ペースに合わせる。人間 owner の deadline 代行 [勝手に出目宣言→roll] は
      // 実質チート級の介入なので、離席救済としてだけ長めに残す [env で調整可]。
      const cpuStepDelay = postWinAction.type === 'selectSaiKoroCombo' ? 1500
        : postWinAction.type === 'rollSaiKoroDice' ? 2500
        : postWinAction.type === 'advanceSaiKoro' ? 2000
        : 1500;
      const humanPostWinTimeoutMs = Number(process.env.ANMIKA_POST_WIN_TIMEOUT_MS || 180_000);
      const delay = owner?.is_cpu ? cpuStepDelay : humanPostWinTimeoutMs;
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
          if (result.command) broadcastAction(room, result.command);
          scheduleRoomDeadline(room);
        }).catch((error) => warn('[anmika-ws] post-win deadline failed', error));
      }, Math.max(0, delay));
      return;
    }

    if (canonical.roundEnded) {
      // [2026-07-21 監査 H-02 fix] 解決済み終局は winner/host の ready [markReadyForNextRound]
      // 頼みで、両者が切断すると誰も次局へ進めず残った参加者が全員詰みだった。
      // サーバー自身が長めの fallback deadline で冪等な nextRound を発行する。
      // ready が先に動けば revision が進み、この timer は guard で no-op になる。
      if (!authority.isPostWinResolved()) return;
      if (canonical.game?.state?.finished) return; // 半荘終了は nextMatch [host 選択] 待ち
      const revision = room.snapshot.revision;
      const fallbackMs = Number(process.env.ANMIKA_NEXT_ROUND_FALLBACK_MS || 120_000);
      room.deadlineTimer = setTimeout(() => {
        room.queue = room.queue.then(async () => {
          if (room.snapshot.revision !== revision || !room.authority?.isPostWinResolved()) return;
          // client 側検証は「和了局 nextRound は winner か host、流局は host のみ」。
          // 和了局は winner、流局 [lastWinner null] は host を actor にして整合させる
          const hostSeat = room.members.get(room.hostUserId)?.seat;
          const accepted = acceptAction(
            room,
            room.authority.lastWinner ?? hostSeat ?? 0,
            '__server_next_round_fallback__',
            { type: 'nextRound', from_role: 'server-fallback' },
            `srv:${room.roomId}:${room.snapshot.revision + 1}:${randomUUID()}`,
          );
          if (accepted.command) {
            broadcastAction(room, accepted.command);
            scheduleRoomDeadline(room);
          }
        }).catch((error) => warn('[anmika-ws] next-round fallback failed', error));
      }, fallbackMs);
      return;
    }

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
              reactionTimeoutAction(room.authority!, seat),
              `srv:${room.roomId}:${room.snapshot.revision + 1}:${randomUUID()}`,
            );
            if (result.command) broadcastAction(room, result.command);
          }
          scheduleRoomDeadline(room);
        }).catch((error) => warn('[anmika-ws] reaction deadline failed', error));
      }, reactionTimeoutMs);
      return;
    }

    const current = authority.currentPlayer();
    const member = Array.from(room.members.values()).find((item) => item.seat === current);
    // [2026-07-21 監査 D-15 fix] この timer を張った時点の接続世代を控える。
    // 発火までに切断→再接続で generation が上がっていたら、この timer は旧世代の
    // 期限なので無効化し、再接続時に張り直した新 timer に任せる
    const scheduledGeneration = member?.generation ?? 0;
    let delay = member?.is_cpu ? 750 : member?.connected ? turnTimeoutMs : disconnectGraceMs;
    // [2026-07-21 監査 L-04 fix] 他家 FEVER 中の非 FEVER 者は強制ツモ切りしか選択肢が
    // 無いのに、online だけ通常手番 deadline [60s] まで手動待ちだった。single の
    // 800ms 自動進行と揃えて、強制ツモ切り確定時は権威が短い専用 deadline で発行する
    // [client は表示追従のみ]。tsumo/カン/北抜き/リーチが可能なら turnTimeoutAction が
    // tsumokiri 以外を返すので、この短縮は選択肢ゼロの局面だけに効く
    if (member && !member.is_cpu && member.connected) {
      const someoneFever = ([0, 1, 2] as const).some((p) => authority.game.feverActive[p]);
      if (someoneFever && !authority.game.feverActive[current] && authority.lastZimo
        && turnTimeoutAction(authority, false)?.type === 'tsumokiri') {
        delay = 800;
      }
    }
    room.deadlineTimer = setTimeout(() => {
      room.queue = room.queue.then(async () => {
        const live = room.authority;
        if (!live || live.roundEnded || live.currentPlayer() !== current) return;
        const liveMember = Array.from(room.members.values()).find((item) => item.seat === current);
        if (liveMember && !liveMember.is_cpu && liveMember.generation !== scheduledGeneration) return;
        const action = turnTimeoutAction(live, member?.is_cpu === true);
        if (!action) {
          scheduleRoomDeadline(room);
          return;
        }
        const result = acceptAction(
          room,
          current,
          member?.user_id ?? `deadline-seat-${current}`,
          action,
          `srv:${room.roomId}:${room.snapshot.revision + 1}:${randomUUID()}`,
        );
        if (result.command) broadcastAction(room, result.command);
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
    const blindStart = captureBlindStart(room.authority!);
    for (const member of room.members.values()) {
      sendJson(member.ws, {
        type: 'start',
        blindStart: true,
        ...maskBlindStart(blindStart, member.seat),
        state: captureSeatProjection(room.authority!, member.seat),
        qijia: start.qijia,
        members: start.members,
        revision: room.snapshot.revision,
        matchId: room.snapshot.matchId,
        roundId: room.snapshot.roundId,
      });
    }
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
    // Revalidate every connection, including reconnects to a cached room.
    // Otherwise a member removed after token issuance could use the still-live
    // short JWT to add themselves back to room.members and recover private state.
    if (internalApiSecret) {
      let liveMembers: RoomMemberSnapshot[];
      try {
        liveMembers = await fetchMembers(roomId);
      } catch (error) {
        warn(`[anmika-ws] member revalidation failed room=${roomId}`, error);
        ws.close(1013, 'member authority unavailable');
        return;
      }
      const liveMember = liveMembers.find((member) => member.user_id === payload.uid);
      if (!liveMember || liveMember.is_cpu || liveMember.seat !== payload.seat) {
        ws.close(4403, 'room membership changed');
        return;
      }
      const liveIds = new Set(liveMembers.map((member) => member.user_id));
      for (const [userId, staleMember] of room.members) {
        if (liveIds.has(userId)) continue;
        if (staleMember.ws) {
          try { staleMember.ws.close(4410, 'evicted'); } catch { /* noop */ }
        }
        room.members.delete(userId);
      }
      for (const authoritativeMember of liveMembers) {
        const cachedMember = room.members.get(authoritativeMember.user_id);
        room.members.set(authoritativeMember.user_id, {
          ...authoritativeMember,
          ws: cachedMember?.ws ?? null,
          generation: cachedMember?.generation ?? 0,
          connected: cachedMember?.connected ?? false,
        });
      }
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
          sendSync(ws, room.snapshot, payload.seat, room.authority, persistence.loadCommands(room.roomId));
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
        if ((msg as Record<string, unknown>)?.type === 'stamp') {
          const value = msg as Record<string, unknown>;
          if (!room.snapshot.started) return;
          if (typeof value.stampId !== 'string' || !STAMP_IDS.has(value.stampId as string)) return;
          broadcast(room, { type: 'stamp', seat: payload.seat, stampId: value.stampId });
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
          sendSync(ws, room.snapshot, payload.seat, room.authority, persistence.loadCommands(room.roomId));
          return;
        }
        if (envelope.expectedVersion !== room.snapshot.revision
          || envelope.matchId !== room.snapshot.matchId
          || envelope.roundId !== room.snapshot.roundId) {
          reject(ws, room, envelope.commandId, 'version conflict');
          sendSync(ws, room.snapshot, payload.seat, room.authority, persistence.loadCommands(room.roomId));
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
        broadcastAction(room, accepted.command);
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
      // WSA: CPU席を除いた human だけで無接続判定 [CPU入り部屋が永久に残る問題を修正]
      const humanMembers = Array.from(room.members.values()).filter((item) => !item.is_cpu);
      if (humanMembers.length === 0 || humanMembers.every((item) => !item.connected)) {
        room.cleanupTimer = setTimeout(() => {
          const latest = rooms.get(room.roomId);
          const latestHumans = latest === room ? Array.from(room.members.values()).filter((item) => !item.is_cpu) : [];
          if (latest === room && (latestHumans.length === 0 || latestHumans.every((item) => !item.connected))) {
            if (room.deadlineTimer) clearTimeout(room.deadlineTimer);
            if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
            rooms.delete(room.roomId);
          }
        }, disconnectGraceMs);
      }
    });

    broadcast(room, lobbyPayload(room));
    if (room.snapshot.started) {
      sendSync(ws, room.snapshot, payload.seat, room.authority, persistence.loadCommands(room.roomId));
      // [2026-07-21 監査 D-15 fix] 再接続時は手番 deadline を現在時刻から張り直す。
      // scheduleRoomDeadline は冒頭で旧 timer を clearTimeout するので、切断前の
      // 残り期限で復帰直後に auto-discard される事故を防ぐ [新世代で rebase]
      scheduleRoomDeadline(room);
    }
    if (!room.snapshot.started && room.pendingStart && room.members.size >= 3) {
      startRoom(room, room.pendingStart.qijia);
    }
  });

  // Internal HTTP API for cross-process notifications (Python → Node)
  const internalPort = options.internalPort ?? Number(process.env.ANMIKA_WS_INTERNAL_PORT || (port === 0 ? 0 : port + 1));
  const internalHttp = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (!internalApiSecret || req.headers['x-anmika-internal-secret'] !== internalApiSecret) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    if (req.method === 'POST' && req.url === '/internal/evict-member') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const { room_id, user_id } = body;
        if (typeof room_id !== 'string' || typeof user_id !== 'string') {
          res.writeHead(400); res.end('bad request'); return;
        }
        const room = rooms.get(room_id);
        if (room) {
          const member = room.members.get(user_id);
          if (member?.ws) {
            try { member.ws.close(4410, 'evicted'); } catch (_) { /* noop */ }
          }
          room.members.delete(user_id);
          broadcast(room, lobbyPayload(room));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
      } catch (_) { res.writeHead(400); res.end('bad request'); }
      return;
    }
    if (req.method === 'POST' && req.url === '/internal/chip-ledger') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const { room_id } = body;
        if (typeof room_id !== 'string') { res.writeHead(400); res.end('bad request'); return; }
        const room = rooms.get(room_id);
        const snapshot = room?.snapshot ?? persistence.loadSnapshot(room_id);
        const authority = room?.authority
          ?? (snapshot?.started ? restoreAuthority(snapshot, persistence.loadCommands(room_id)) : null);
        if (!authority || !snapshot?.start) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ledger: null }));
          return;
        }
        const state = authority.canonicalState();
        const matchLedger = state.game.state.finished
          ? authority.matchResultLedger()
          : state.game.chipLedger;
        const ledger: Record<string, number> = {};
        for (const [seat, chips] of Object.entries(matchLedger ?? {})) {
          const member = snapshot.start.members.find((m) => m.seat === Number(seat));
          if (member) ledger[member.user_id] = chips as number;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ledger, finished: state.game.state.finished }));
      } catch (_) { res.writeHead(400); res.end('bad request'); }
      return;
    }
    // 事故復帰 [2026-07-20 リョー裁定: 落ちた局の冒頭から / PW は 1 個]
    // room は snapshot + 受理コマンド列で保持されているので、現局のコマンドを捨てて
    // replay し直せば局頭へ戻せる。局の境目は最後の nextRound コマンドで判る
    // [受理コマンドテーブルに roundId 列が無いため、action.type で辿る]。
    if (req.method === 'POST' && req.url === '/internal/rewind-room') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const { room_id } = body;
        if (typeof room_id !== 'string') { res.writeHead(400); res.end('bad request'); return; }
        const room = rooms.get(room_id);
        const snapshot = room?.snapshot ?? persistence.loadSnapshot(room_id);
        if (!snapshot?.started) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'room not started' }));
          return;
        }
        const commands = persistence.loadCommands(room_id);
        let keepThrough = 0;
        for (const command of commands) {
          if ((command.action as any)?.type === 'nextRound') keepThrough = command.revision;
        }
        const kept = commands.filter((command) => command.revision <= keepThrough);
        if (kept.length === commands.length) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'already at round head', revision: keepThrough }));
          return;
        }
        let authority: RoomAuthority | null = null;
        try {
          authority = restoreAuthority(snapshot, kept);
        } catch (error: any) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: `replay failed: ${error?.message ?? error}` }));
          return;
        }
        if (!authority) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'cannot rebuild authority' }));
          return;
        }
        const rewound: CanonicalRoomSnapshot = {
          ...snapshot,
          revision: keepThrough,
          commands: kept,
          updatedAt: new Date().toISOString(),
        };
        const dropped = persistence.rewindRoom(rewound, keepThrough);
        if (room) {
          room.authority = authority;
          room.snapshot = rewound;
          // 巻き戻し前に張られた期限タイマーは、巻き戻し後の局面に対しては無効。
          // 止めずに残すと古い手番の自動打牌が走りかねないし、張り直さないと
          // 誰も動かない限り永久に待つことになる。
          if (room.nextRoundTimer) { clearTimeout(room.nextRoundTimer); room.nextRoundTimer = null; }
          if (room.deadlineTimer) { clearTimeout(room.deadlineTimer); room.deadlineTimer = null; }
          for (const member of room.members.values()) {
            sendSync(member.ws, rewound, member.seat, authority, kept);
          }
          scheduleRoomDeadline(room);
        }
        log(`[anmika-ws] rewind room=${room_id} -> revision ${keepThrough} [dropped ${dropped}]`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, revision: keepThrough, dropped }));
      } catch (_) { res.writeHead(400); res.end('bad request'); }
      return;
    }
    if (req.method === 'POST' && req.url === '/internal/purge-room') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const { room_id } = body;
        if (typeof room_id !== 'string') { res.writeHead(400); res.end('bad request'); return; }
        const room = rooms.get(room_id);
        if (room) {
          for (const member of room.members.values()) {
            if (member.ws) try { member.ws.close(4404, 'room purged'); } catch (_) { /* noop */ }
          }
          if (room.deadlineTimer) clearTimeout(room.deadlineTimer);
          if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
          if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
          rooms.delete(room_id);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
      } catch (_) { res.writeHead(400); res.end('bad request'); }
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  internalHttp.listen(internalPort, '127.0.0.1', () => {
    log(`[anmika-ws] internal API listening on 127.0.0.1:${internalPort}`);
  });

  return {
    wss,
    rooms,
    persistence,
    internalHttp,
    close: async () => {
      for (const room of rooms.values()) {
        if (room.deadlineTimer) clearTimeout(room.deadlineTimer);
        if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
        if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => internalHttp.close(() => resolve()));
      persistence.close();
    },
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) createWsRuntime();
