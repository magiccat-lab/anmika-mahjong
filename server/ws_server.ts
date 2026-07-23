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
  type RoomSeatMapping,
  type RoomStartSnapshot,
} from './protocol';
import { computeRoomChipDelta, foldRoomState, gameToRoomSeat, initialRoomChipLedger, nextMappingForMatch, roomToGameSeat } from './rotation';

const DEFAULT_PORT = 8791;
const DEFAULT_REACTION_TIMEOUT_MS = 15_000;
const DEFAULT_TURN_TIMEOUT_MS = 60_000;
const DEFAULT_DISCONNECT_GRACE_MS = 30_000;
// [2026-07-22 リョー要望: 全員ready制] 30s 自動進行は廃止。timeout は AFK/切断時の最終保険のみ
const DEFAULT_NEXT_ROUND_TIMEOUT_MS = 180_000;
const SERVER_NEXT_ROUND_UID = '__server_next_round__';

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
  // [2026-07-23 リョー要望 観戦モード] true なら seat=-1 の閲覧専用接続
  spectator?: boolean;
  iat?: number;
  exp?: number;
};

// [2026-07-23 観戦モード] 閲覧専用接続。room.members には入れない [ゲーム進行に不関与]
type SpectatorConn = {
  user_id: string;
  username: string;
  ws: WebSocket;
  generation: number;
};

// 観戦者の projection は「席なし」= 全 private マスク [own=null 経路]
const SPECTATOR_SEAT = -1;

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
  // [2026-07-23] 部屋作成時の対局形式 [API が SSoT、start 時に changshu へ変換]
  matchMode: 'tonpu' | 'hanchan';
  // [2026-07-23 観戦モード] uid → 閲覧専用接続
  spectators: Map<string, SpectatorConn>;
  // [2026-07-23 Sol 7周目 P1] 初期化 [member/matchMode fetch] の完了 promise。
  // publish [rooms.set] は同時接続共有のため fetch 前に行うが、利用側は必ず await する
  ready?: Promise<void>;
  pendingStart: { qijia: number } | null;
  generation: number;
  queue: Promise<void>;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  nextRoundTimer: ReturnType<typeof setTimeout> | null;
  nextRoundReadyRevision: number | null;
  nextRoundReadySeats: Set<number>;
  // [2026-07-23 リョー指示] チップリセット同意 vote [human 席]。全員揃った時だけ nextMatch で発動
  chipResetVotes: Set<number>;
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

export function membersForAuthority(room: Room): AuthorityMember[] {
  // [2026-07-23 4人回し Phase3] member.seat は room seat 契約。authority へは
  // mapping で game seat に写像し、抜け番 [game seat 無し] は渡さない。
  // 3人部屋 [mapping null] は恒等写像で従来と同一
  const mapping = room.snapshot.activeMapping ?? null;
  const projected: AuthorityMember[] = [];
  for (const member of room.members.values()) {
    const gameSeat = roomToGameSeat(mapping, member.seat);
    if (gameSeat === null) continue;
    projected.push({ seat: gameSeat, is_cpu: member.is_cpu });
  }
  return projected;
}

/** [2026-07-23 4人回し Phase3] 権威側の game seat から room member を引く。
 *  member.seat は room seat 契約なので、mapping 経由で照合する [mapping 無しは恒等] */
export function memberByGameSeat(room: Room, gameSeat: number) {
  const roomSeat = gameToRoomSeat(room.snapshot.activeMapping ?? null, gameSeat);
  return Array.from(room.members.values()).find((member) => member.seat === roomSeat);
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

/** [2026-07-23 4人回し Phase2, Sol P1-①] server 計算専用の予約 field を client action から剥がす。
 *  validateAndApply は未知 field を無視するため、合法 action に _roomChipDelta 等を同梱すると
 *  そのまま command に焼かれ fold されてしまう [room ledger 偽装 / 偽 _blindState 配布]。
 *  必ず accept 入口で delete し、server が計算した時だけ再付与する。 */
export function sanitizeIncomingAction(actionInput: Record<string, unknown>): Record<string, unknown> {
  const action = { ...actionInput };
  delete action._roomChipDelta;
  delete action._nextMapping;
  delete action._blindState;
  delete action._draw;
  delete action._state;
  return action;
}

/** [2026-07-23 4人回し Phase2, Sol P1-②] v1/v2 [rotation field 導入前] の進行中部屋の
 *  one-shot 移行。roomChipLedger 未定義のまま載せると次 accept の delta fold が空 ledger
 *  から始まり既存残高を無いことにするため、復元済み canonical game ledger を 3 席
 *  room ledger として seed する [mapping null = 恒等]。移行不要なら null。 */
export function upgradeLegacySnapshotRoomLedger(
  snapshot: CanonicalRoomSnapshot,
  authority: RoomAuthority | null,
): CanonicalRoomSnapshot | null {
  if (!snapshot.started || !authority || snapshot.roomChipLedger !== undefined) return null;
  const gameLedger = authority.canonicalState().game.chipLedger;
  return {
    ...snapshot,
    roomChipLedger: Object.fromEntries(
      ([0, 1, 2] as const).map((seat) => [String(seat), gameLedger[seat] ?? 0]),
    ),
    activeMapping: snapshot.activeMapping ?? null,
  };
}

export function restoreAuthority(
  snapshot: CanonicalRoomSnapshot,
  commands?: AcceptedRoomCommand[],
): RoomAuthority | null {
  if (!snapshot.started || !snapshot.start) return null;
  const authority = createRoomAuthority({
    preShuffledPool: snapshot.start.preShuffledPool,
    qijia: snapshot.start.qijia,
    // [2026-07-23 changshu protocol] 東風/半荘は start snapshot が持つ [restore で default に戻さない]
    changshu: snapshot.start.changshu,
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
  // [2026-07-23 4人回し Phase2] replay で再発行された精算 effect は捨てる。
  // room ledger は command に焼かれた _roomChipDelta の fold が正で、ここで drain
  // しないと次の live accept が全履歴分の delta を二重に焼く。
  authority.takeCanonicalChipEffects();
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
  // [2026-07-23 名牌譜で追加した nukiBei event] replacement = 補充ツモ牌は本人以外に非公開。
  // 抜いた北/金北そのもの [gold flag] は卓上公開情報なので残す
  if (event?.type === 'nukiBei') {
    return {
      type: 'nukiBei',
      player: event.player,
      gold: event.gold === true,
      replacement: event.player === recipientSeat ? (event.replacement ?? null) : null,
    };
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
    // [2026-07-23 changshu protocol] client hydrate の source of truth [reconnect 初期化で
    // current.game.changshu が default に引かれる Sol 指摘の穴を塞ぐ]
    gameConfig: { changshu: game.changshu },
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
  recipientRoomSeat: number,
  authority: RoomAuthority | null,
  duplicate = false,
) {
  // [2026-07-23 4人回し Phase3] 受信者は room seat 契約で渡り、masking / projection は
  // game seat 契約。抜け番 [game seat 無し] は観戦投影 [全 private マスク] を受ける
  const mapping = snapshot.activeMapping ?? null;
  const recipientGameSeat = recipientRoomSeat === SPECTATOR_SEAT
    ? null
    : roomToGameSeat(mapping, recipientRoomSeat);
  const projectionSeat = recipientGameSeat ?? SPECTATOR_SEAT;
  const action = sanitizeActionForSeat(command.action, projectionSeat);
  if (authority) action._state = captureSeatProjection(authority, projectionSeat);
  return {
    type: 'action',
    commandId: command.commandId,
    revision: command.revision,
    matchId: snapshot.matchId,
    roundId: snapshot.roundId,
    from_seat: command.actorSeat,
    from_room_seat: command.actorRoomSeat ?? command.actorSeat,
    from_user_id: command.fromUserId,
    duplicate,
    // [2026-07-23 4人回し Phase3] client の actorGameSeat 分離と room chip 表示用
    recipientRoomSeat,
    recipientGameSeat,
    activeMapping: mapping,
    roomChipLedger: snapshot.roomChipLedger ?? null,
    mappingEpoch: snapshot.matchId,
    action,
  };
}

// [2026-07-23 Sol 7周目 P0] rewind の局頭境界計算。nextRound だけでなく nextMatch も
// 境界にし [2試合目第1局で前試合へ戻る事故]、matchId/roundId は kept 列から
// appendAcceptedCommand と同じ遷移則で再算出する [旧実装は現 snapshot の ID を据え置き、
// canonical 実体と protocol ID が別試合になって以後の action/POST/restore を壊した]
export function computeRewindPlan(
  commands: Array<Pick<AcceptedRoomCommand, 'revision' | 'action'>>,
): { keepThrough: number; matchId: number; roundId: number } {
  let keepThrough = 0;
  for (const command of commands) {
    const atype = (command.action as any)?.type;
    if (atype === 'nextRound' || atype === 'nextMatch') keepThrough = command.revision;
  }
  let matchId = 1;
  let roundId = 1;
  for (const command of commands) {
    if (command.revision > keepThrough) break;
    const atype = (command.action as any)?.type;
    if (atype === 'nextMatch') { matchId += 1; roundId = 1; }
    else if (atype === 'nextRound') { roundId += 1; }
  }
  return { keepThrough, matchId, roundId };
}

function sendJson(ws: WebSocket | null, payload: unknown): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch { /* socket closed between check and send */ }
}

function broadcast(room: Room, payload: unknown): void {
  for (const member of room.members.values()) sendJson(member.ws, payload);
  // [2026-07-23 観戦モード] broadcast は public payload のみ [lobby/stamp/ready 等] なのでそのまま流す
  for (const spectator of room.spectators.values()) sendJson(spectator.ws, payload);
}

function broadcastAction(room: Room, command: AcceptedRoomCommand): void {
  for (const member of room.members.values()) {
    sendJson(member.ws, actionRelay(command, room.snapshot, member.seat, room.authority));
  }
  // [2026-07-23 観戦モード] seat=-1 の sanitize/projection [own=null、全 private マスク]
  for (const spectator of room.spectators.values()) {
    sendJson(spectator.ws, actionRelay(command, room.snapshot, SPECTATOR_SEAT, room.authority));
  }
  // [2026-07-21 監査 L-03] 各 seat の projection に cutin を載せて配り終えたので、
  // canonical から drain して cutinQueue の無限蓄積を防ぐ [server は pop しないため]
  room.authority?.takePendingCutins();
}

function sendSync(
  ws: WebSocket | null,
  snapshot: CanonicalRoomSnapshot,
  recipientRoomSeat: number,
  authority: RoomAuthority | null,
  fullCommands?: AcceptedRoomCommand[],
  currentMembers?: Array<{ seat: number; user_id: string; username: string; is_cpu: boolean; connected?: boolean }> | null,
): void {
  // [2026-07-23 4人回し Phase3] 受信者 room seat → game seat 変換 [抜け番は観戦投影]
  const mapping = snapshot.activeMapping ?? null;
  const recipientGameSeat = recipientRoomSeat === SPECTATOR_SEAT
    ? null
    : roomToGameSeat(mapping, recipientRoomSeat);
  const projectionSeat = recipientGameSeat ?? SPECTATOR_SEAT;
  const payload = fullCommands ? { ...snapshot, commands: fullCommands } : snapshot;
  let sanitizedStart = payload.start;
  if (sanitizedStart && sanitizedStart.preShuffledPool?.length > 0) {
    const tempAuth = createRoomAuthority({ preShuffledPool: sanitizedStart.preShuffledPool, qijia: sanitizedStart.qijia });
    const blindData = captureBlindStart(tempAuth);
    sanitizedStart = {
      ...sanitizedStart,
      preShuffledPool: [],
      ...maskBlindStart(blindData, projectionSeat),
      blindStart: true,
    } as any;
  }
  const commands = (payload.commands ?? []).map((command) => ({
    ...command,
    action: sanitizeActionForSeat(command.action, projectionSeat),
  }));
  sendJson(ws, {
    type: 'sync',
    // [2026-07-23 4人回し Phase3] client の actorGameSeat 分離用 [snapshot 内の
    // activeMapping / roomChipLedger は spread でそのまま同梱される]
    recipientRoomSeat,
    recipientGameSeat,
    snapshot: {
      ...payload,
      start: sanitizedStart,
      commands,
      // [2026-07-22 Sol指摘 P1] reconnect 時に stale な start.members が
      // fresh lobby を上書きする穴。現在の members を authoritative として同梱
      currentMembers: currentMembers ?? null,
      state: authority ? captureSeatProjection(authority, projectionSeat) : null,
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
  // [2026-07-23 4人回し Phase3] client envelope の seat は room seat 契約。
  // canonical command の actorSeat は game seat 契約なのでここで写像する。
  // 抜け番 [game seat 無し] の game action はこの境界で拒否 [room control は
  // Phase4 の server control command 化で別経路になる]
  const gameSeat = roomToGameSeat(room.snapshot?.activeMapping ?? null, seat);
  if (gameSeat === null) {
    // [2026-07-23 4人回し Phase4] host の nextMatch は room control。抜け番 host でも
    // 出せるよう active game seat 0 を代行させる [nextMatch は席非依存の遷移で、
    // fromUserId=host uid が監査痕跡に残る。envelope の commandId 冪等性も維持]
    if (action.type === 'nextMatch' && uid === room.hostUserId) {
      return { actorSeat: 0, actorRoomSeat: seat, reason: null };
    }
    return { actorSeat: seat, actorRoomSeat: seat, reason: 'inactive seat cannot send game actions' };
  }
  const actorSeat = gameSeat;
  // [2026-07-21 監査 S-01 fix] client 起点の cpuRelay [host が CPU action を代理送信] を廃止。
  // host は「その CPU が選んだ action か」を証明できず、不正候補が revision を消費しない性質と
  // 合わせて隠し手牌の oracle 探索・CPU 直接操作に使えた。CPU action は権威サーバーの
  // deadline driver [turnTimeoutAction、CPU 席は 750ms] だけが生成する。
  if (action.cpuRelay === true) {
    return { actorSeat, actorRoomSeat: seat, reason: 'cpuRelay is no longer accepted; CPU actions are server-driven' };
  }
  return { actorSeat, actorRoomSeat: seat, reason: null };
}

function validateAction(room: Room, uid: string, seat: number, action: Record<string, unknown>) {
  if (typeof action.type !== 'string') return { actorSeat: seat, actorRoomSeat: seat, reason: 'missing action.type' };
  const actor = resolveActorSeat(room, uid, seat, action);
  if (actor.reason) return actor;
  if (PLAYER_FIELD_ACTIONS.has(action.type)) {
    const target = action.player ?? actor.actorSeat;
    if (target !== actor.actorSeat) {
      return { actorSeat: actor.actorSeat, actorRoomSeat: actor.actorRoomSeat, reason: `${action.type}: player ${String(target)} != actor ${actor.actorSeat}` };
    }
  }
  if (action.type === 'nextMatch' && uid !== room.hostUserId) {
    return { actorSeat: actor.actorSeat, actorRoomSeat: actor.actorRoomSeat, reason: 'nextMatch requires host' };
  }
  // [2026-07-22 リョー要望: 全員が次局へを押したら進む] client 直送の nextRound は廃止。
  // readyNextRound が全員分揃った時 [または timeout] に server だけが発行する [uid は偽装不可]
  if (action.type === 'nextRound' && uid !== SERVER_NEXT_ROUND_UID) {
    return { actorSeat: actor.actorSeat, actorRoomSeat: actor.actorRoomSeat, reason: 'nextRound advances after all players press ready' };
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
      // [2026-07-23 Sol 7周目 P1] spectator flag を落としていて観戦接続が JWT 本番経路で
      // 一切成立しなかった [payload.spectator が常に undefined → member 再検証 4403]。
      // seat と flag の整合も token 検証で強制する
      const spectator = value.spectator === true;
      if (spectator && value.seat !== -1) return null;
      // [2026-07-23 4人回し Phase3] seat は room seat 契約。rotation 部屋の4人目 [seat 3]
      // を許可 [3人部屋は app.py が 0-2 しか発行せず、接続時の member 照合でも縛られる]
      if (!spectator && !(Number.isInteger(value.seat) && value.seat >= 0 && value.seat <= 3)) return null;
      return {
        uid: value.uid,
        username: typeof value.username === 'string' ? value.username : undefined,
        seat: value.seat,
        room_id: value.room_id,
        room_instance_id: value.room_instance_id,
        is_host: value.is_host === true,
        spectator,
        iat: value.iat,
        exp: value.exp,
      };
    } catch { return null; }
  };

  const fetchRoomInfo = async (
    roomId: string,
  ): Promise<{ members: RoomMemberSnapshot[]; matchMode: 'tonpu' | 'hanchan' }> => {
    if (!internalApiSecret) return { members: [], matchMode: 'tonpu' };
    const response = await fetch(`${apiBase}/api/internal/rooms/${roomId}/members`, {
      headers: { 'X-Anmika-Internal-Secret': internalApiSecret },
    });
    if (!response.ok) throw new Error(`member authority returned ${response.status}`);
    const data = await response.json() as { members?: Array<Record<string, unknown>>; match_mode?: unknown };
    if (!Array.isArray(data.members)) throw new Error('member authority response missing members');
    const members = data.members
      .filter((member) => typeof member.user_id === 'string' && typeof member.seat === 'number')
      .map((member) => ({
        seat: member.seat as number,
        user_id: member.user_id as string,
        username: typeof member.username === 'string' ? member.username : String(member.user_id),
        is_cpu: member.is_cpu === true || String(member.user_id).startsWith('CPU_'),
      }));
    // [2026-07-23 changshu protocol] 対局形式は API の room record が SSoT
    return { members, matchMode: data.match_mode === 'hanchan' ? 'hanchan' : 'tonpu' };
  };

  const fetchMembers = async (roomId: string): Promise<RoomMemberSnapshot[]> => {
    return (await fetchRoomInfo(roomId)).members;
  };

  const getRoom = async (roomId: string, roomInstanceId: string, hostUserId: string): Promise<Room> => {
    const cached = rooms.get(roomId);
    if (cached?.snapshot.roomInstanceId === roomInstanceId) {
      // [2026-07-23 Sol 7周目 P1] 初期化中/初期化失敗の半端 room を配らない。
      // 失敗していたら map から外して接続側に投げ直させる [client は再接続 retry]
      try {
        await cached.ready;
      } catch (error) {
        if (rooms.get(roomId) === cached) rooms.delete(roomId);
        throw error;
      }
      return cached;
    }
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
    const restoredAuthority = restoreAuthority(snapshot, dbCommands);
    const upgraded = upgradeLegacySnapshotRoomLedger(snapshot, restoredAuthority);
    if (upgraded) {
      snapshot = upgraded;
      // saveSnapshot は snapshot 行のみ更新 [resetRoom は command log を全削除するので不可]
      persistence.saveSnapshot(snapshot);
    }
    const room: Room = {
      roomId,
      hostUserId,
      members: new Map(),
      authority: restoredAuthority,
      snapshot: { ...snapshot, commands: [] },
      matchMode: 'tonpu',
      spectators: new Map<string, SpectatorConn>(),
      pendingStart: null,
      generation: 0,
      queue: Promise.resolve(),
      deadlineTimer: null,
      cleanupTimer: null,
      nextRoundTimer: null,
      nextRoundReadyRevision: null,
      nextRoundReadySeats: new Set<number>(),
      chipResetVotes: new Set<number>(),
    };
    for (const member of snapshot.start?.members ?? []) {
      room.members.set(member.user_id, { ...member, ws: null, generation: 0, connected: false });
    }
    // Publish before the HTTP member lookup so simultaneous sockets share one
    // room object and therefore one command queue.
    rooms.set(roomId, room);
    // [2026-07-23 Sol 7周目 P1] 初期化を promise 化。fetch 失敗時は map から外す
    // [旧実装は半初期化 room が永久 cache され、matchMode が default tonpu のまま
    //  次接続以降 fetch を skip していた]
    room.ready = (async () => {
      const roomInfo = await fetchRoomInfo(roomId);
      room.matchMode = roomInfo.matchMode;
      for (const member of roomInfo.members) {
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
    })();
    try {
      await room.ready;
    } catch (error) {
      if (rooms.get(roomId) === room) rooms.delete(roomId);
      if (room.deadlineTimer) clearTimeout(room.deadlineTimer);
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
      if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
      throw error;
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
    actorRoomSeatHint?: number,
  ): { reason: string | null; command?: AcceptedRoomCommand; ack?: CommandAck } => {
    let previous = room.snapshot;
    const action = sanitizeIncomingAction(actionInput);
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
        // [2026-07-23 総点検 P0] 自動消化は正規 command として append/persist/broadcast する。
        // 旧実装は validateAndApply 直叩きで command log に残らず、その log は
        // 「pending 残存のまま nextMatch」という並びになり、restore/replay 時に
        // canonical nextMatch が blockingWinPipelineReason で no-op → mutation-token
        // throw → reject rollback・部屋再ロード・rewind が全部恒久失敗する時限爆弾だった
        for (let guard = 0; guard < 60; guard++) {
          const canonical = room.authority.canonicalState();
          if (!canonical.game.state?.finished) break;
          const auto = computePostWinAutoAction(canonical);
          if (!auto) break;
          const autoAccepted = acceptAction(
            room,
            auto.owner,
            SERVER_NEXT_ROUND_UID,
            auto.action,
            `srv:${room.roomId}:${room.snapshot.revision + 1}:${randomUUID()}`,
          );
          if (!autoAccepted.command) {
            warn('[anmika-ws] nextMatch fast-forward reject', autoAccepted.reason, auto.action?.type);
            break;
          }
          broadcastAction(room, autoAccepted.command);
        }
        // 自動消化で revision が進んでいるため、この nextMatch 自体の baseline を取り直す
        previous = room.snapshot;
      }
      if (action.type === 'nextMatch') {
        // [2026-07-23 リョー指示] チップリセットは全員の同意がないとできない。
        // host の checkbox 単独では発動せず、human 全席の同意 vote が揃った時だけ reset。
        // 切断中の human も「同意していない」扱い [勝手にリセットされない側に倒す]
        // [2026-07-23 Sol 4周目 P1] connected 必須: 全員 true 後に1人切断しても
        // 発動しない [仕様「切断中 human は不同意扱い」を判定式にも反映]
        const humanMembers = Array.from(room.members.values()).filter((m) => !m.is_cpu);
        const allAgreed = humanMembers.length > 0
          && humanMembers.every((m) => m.connected && room.chipResetVotes.has(m.seat));
        action.resetChip = allAgreed;
        action.finalize = action.resetChip !== true;
        // [2026-07-22 リョー要望: 回り親] 次の試合は起家を1つ回す [server 決定、Sol設計D]
        action.qijia = ((room.authority.game.state.qijia + 1) % 3) as 0 | 1 | 2;
        // [2026-07-23 4人回し Phase4] rotation 部屋は次試合の mapping を server が算出して
        // action に焼く [appendAcceptedCommand の matchId 増加で交換される唯一の境界]。
        // 新試合の cpuSeats は新 mapping で投影する [旧 mapping だと席がズレる]
        const nextMapping = previous.start ? nextMappingForMatch(previous.start, previous.matchId + 1) : null;
        if (nextMapping) action._nextMapping = nextMapping;
        const nextMatchMapping = nextMapping ?? previous.activeMapping ?? null;
        action.cpuSeats = Array.from(room.members.values())
          .filter((member) => member.is_cpu)
          .map((member) => roomToGameSeat(nextMatchMapping, member.seat))
          .filter((seat): seat is number => seat !== null);
        delete action.chipLedger;
      }
      const beforeEffects = captureBeforeAction(room.authority);
      // [2026-07-23 4人回し Phase4] nextMatch は新試合の member 投影で適用する
      const applyMembers = action.type === 'nextMatch' && action._nextMapping
        ? Array.from(room.members.values())
          .map((member) => ({ seat: roomToGameSeat(action._nextMapping as RoomSeatMapping, member.seat), is_cpu: member.is_cpu }))
          .filter((member): member is AuthorityMember => member.seat !== null)
        : membersForAuthority(room);
      const reason = room.authority.validateAndApply(actorSeat, action, applyMembers);
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
      // [2026-07-23 4人回し Phase2] canonical sink を accept 毎に必ず drain し
      // [action 跨ぎの持ち越し・restore 後の再課金を封じる]、精算があれば
      // accept 時点の mapping で room 4-way delta を command に焼く。
      // fold 自体は appendAcceptedCommand [persist と同一 snapshot 遷移] が行う。
      const chipEffects = room.authority.takeCanonicalChipEffects();
      const roomChipDelta = computeRoomChipDelta(chipEffects, previous.activeMapping ?? null);
      if (roomChipDelta) action._roomChipDelta = roomChipDelta;
    }

    const appended = appendAcceptedCommand(previous, {
      commandId,
      actorSeat,
      // [2026-07-23 4人回し Phase3] 表示/監査用の room seat [replay は actorSeat=game seat のまま]
      // [Phase4] 抜け番 host の nextMatch 代行では逆写像が host の席にならないため hint 優先
      actorRoomSeat: actorRoomSeatHint ?? gameToRoomSeat(previous.activeMapping ?? null, actorSeat),
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
        room.nextRoundReadySeats = new Set();
        // [2026-07-23] 局/試合が動いたらチップリセット同意も失効 [持ち越さない]
        room.chipResetVotes = new Set();
      }
    } catch (error) {
      room.authority = restoreAuthority(previous, persistence.loadCommands(room.roomId));
      warn(`[anmika-ws] persistence rollback room=${room.roomId}`, error);
      return { reason: 'persistence failure' };
    }
    return { reason: null, command: appended.command, ack };
  };

  // [2026-07-23 4人回し Phase3] ready 進行は active [game seat あり] の人間だけが対象。
  // 抜け番は打牌に関与しないので、次局進行を握らせると 4人部屋が永久に進まない
  const activeHumanMembers = (room: Room) =>
    Array.from(room.members.values()).filter((m) => !m.is_cpu
      && roomToGameSeat(room.snapshot.activeMapping ?? null, m.seat) !== null);

  const nextRoundReadyPayload = (room: Room) => ({
    type: 'nextRoundReady',
    revision: room.nextRoundReadyRevision,
    seats: [...room.nextRoundReadySeats].sort((a, b) => a - b),
    total: Math.max(1, activeHumanMembers(room).length),
  });

  const sendNextRoundReadyStateTo = (ws: WebSocket, room: Room) => {
    if (room.nextRoundReadyRevision !== room.snapshot.revision || room.nextRoundReadySeats.size === 0) return;
    sendJson(ws, nextRoundReadyPayload(room));
  };

  // [2026-07-23 リョー指示] チップリセットは全員の同意がないとできない
  const chipResetVotePayload = (room: Room) => ({
    type: 'chipResetVote',
    seats: [...room.chipResetVotes].sort((a, b) => a - b),
    total: Math.max(1, Array.from(room.members.values()).filter((m) => !m.is_cpu).length),
  });

  const sendChipResetVoteStateTo = (ws: WebSocket, room: Room) => {
    if (room.chipResetVotes.size === 0) return;
    sendJson(ws, chipResetVotePayload(room));
  };

  const issueServerNextRound = (room: Room, revision: number, actorRoomSeat: number, fromRole: string) => {
    room.queue = room.queue.then(async () => {
      if (room.snapshot.revision !== revision || !room.authority?.isPostWinResolved()) return;
      const action = { type: 'nextRound', from_role: fromRole };
      // [2026-07-23 4人回し Phase3] ready 集約は room seat 契約。canonical へは game seat。
      // 押下者が抜け番 [Phase4 で除外予定] でも nextRound 自体は席非依存なので active 0 で代行
      const actorGameSeat = roomToGameSeat(room.snapshot.activeMapping ?? null, actorRoomSeat) ?? 0;
      const accepted = acceptAction(
        room,
        actorGameSeat,
        SERVER_NEXT_ROUND_UID,
        action,
        `srv:${room.roomId}:${room.snapshot.revision + 1}:${randomUUID()}`,
      );
      if (accepted.command) {
        broadcastAction(room, accepted.command);
        scheduleRoomDeadline(room);
      }
    }).catch((error) => warn('[anmika-ws] next-round advance failed', error));
  };

  const maybeAdvanceAllReady = (room: Room, revision: number) => {
    if (room.nextRoundReadyRevision !== revision || room.snapshot.revision !== revision) return;
    // 切断中の人間は押せないので gate から除外 [復帰しないケースは timeout fallback が拾う]
    // [Phase3] 抜け番も gate から除外 [active human の全押しで進む]
    const required = activeHumanMembers(room)
      .filter((m) => m.connected)
      .map((m) => m.seat);
    if (required.length === 0) return;
    if (!required.every((seat) => room.nextRoundReadySeats.has(seat))) return;
    issueServerNextRound(room, revision, required[0], 'all-ready');
  };

  // [2026-07-22 リョー要望] 次局へは「全員が押したら進む」。
  // 従来の winner/host 限定 ready + 30s 自動進行を、全席 ready 集約に変更
  const markReadyForNextRound = (room: Room, actorSeat: number, revision: number): string | null => {
    if (!room.authority?.isPostWinResolved()) return 'round is not safely resolved';
    if (revision !== room.snapshot.revision) return 'version conflict';
    const member = Array.from(room.members.values()).find((m) => m.seat === actorSeat);
    if (!member || member.is_cpu) return 'only seated players can ready next round';
    // [2026-07-23 4人回し Phase3] 抜け番 [game seat 無し] は次局進行の当事者ではない
    if (roomToGameSeat(room.snapshot.activeMapping ?? null, actorSeat) === null) {
      return 'inactive seat cannot ready next round';
    }
    if (room.nextRoundReadyRevision !== revision) {
      // [2026-07-23 Sol R2で露出] 旧 revision の押下者へ nack を返して楽観押下を戻させる。
      // 流局後処理等で revision が進むと先押しの票は破棄されるが、本人の UI は
      // ack 済みの「全員待ち」のまま再押下不能になり、全員 180s timeout まで固まっていた
      for (const staleSeat of room.nextRoundReadySeats) {
        const staleMember = Array.from(room.members.values()).find((m) => m.seat === staleSeat);
        if (staleMember?.ws) {
          sendJson(staleMember.ws, { type: 'readyNextRoundNack', reason: 'superseded revision', revision });
        }
      }
      room.nextRoundReadyRevision = revision;
      room.nextRoundReadySeats = new Set();
      if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
      room.nextRoundTimer = null;
    }
    room.nextRoundReadySeats.add(actorSeat);
    broadcast(room, nextRoundReadyPayload(room));
    if (!room.nextRoundTimer) {
      room.nextRoundTimer = setTimeout(() => {
        issueServerNextRound(room, revision, actorSeat, 'timeout');
      }, nextRoundTimeoutMs);
    }
    maybeAdvanceAllReady(room, revision);
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
      const owner = memberByGameSeat(room, postWinOwner); // [Phase3] postWinOwner は game seat
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
      // [2026-07-23 総点検] 旧 H-02 fallback [押下0人でも 120s で自動 nextRound] は撤去。
      // 全員ready制 [2026-07-22 リョー要望] では「全員が押すまで進まない」が仕様で、
      // ・押下後の AFK/切断は markReadyForNextRound が張る 180s timeout が拾う
      // ・未押下メンバーの切断確定時は close handler が gate を再評価して進める
      // ・全員切断は cleanup → 復元後に再押下できる [ready 状態は sync で再配布]
      // ため、0押下自動進行という H-02 の穴埋めはもう不要 [仕様違反side effectだけが残る]
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
            const member = memberByGameSeat(room, seat); // [Phase3] reaction 候補は game seat
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
    const member = memberByGameSeat(room, current); // [Phase3] currentPlayer は game seat
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
        const liveMember = memberByGameSeat(room, current); // [Phase3] game seat 照合
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
    // [2026-07-23 changshu protocol] 対局形式は room record [API] 由来。client 数値は使わない
    const changshu = room.matchMode === 'hanchan' ? 2 : 1;
    const start = { preShuffledPool: serverShuffledPool(), qijia, members, changshu };
    room.authority = createRoomAuthority(start);
    room.snapshot = {
      ...room.snapshot,
      started: true,
      start,
      commands: [],
      revision: 0,
      updatedAt: now,
      // [2026-07-23 4人回し Phase2] room ledger / mapping の初期値。3人部屋は
      // mapping 無し [恒等写像扱い] で、fold 結果は game ledger と常に一致する
      activeMapping: (start as RoomStartSnapshot).initialMapping ?? null,
      roomChipLedger: initialRoomChipLedger(start),
    };
    persistence.resetRoom(room.snapshot);
    room.pendingStart = null;
    const blindStart = captureBlindStart(room.authority!);
    for (const member of room.members.values()) {
      // [2026-07-23 4人回し Phase3] member.seat は room seat。masking/projection は game seat
      const memberGameSeat = roomToGameSeat(room.snapshot.activeMapping ?? null, member.seat);
      const memberProjectionSeat = memberGameSeat ?? SPECTATOR_SEAT;
      sendJson(member.ws, {
        type: 'start',
        blindStart: true,
        ...maskBlindStart(blindStart, memberProjectionSeat),
        state: captureSeatProjection(room.authority!, memberProjectionSeat),
        qijia: start.qijia,
        // [2026-07-23 changshu protocol] sync 経路 [snapshot.start] だけでなく直送 start にも同梱
        changshu,
        members: start.members,
        revision: room.snapshot.revision,
        matchId: room.snapshot.matchId,
        roundId: room.snapshot.roundId,
        recipientRoomSeat: member.seat,
        recipientGameSeat: memberGameSeat,
        activeMapping: room.snapshot.activeMapping ?? null,
        roomChipLedger: room.snapshot.roomChipLedger ?? null,
      });
    }
    // [2026-07-23 観戦モード] 観戦者にも全 private マスクで start を配る
    for (const spectator of room.spectators.values()) {
      sendJson(spectator.ws, {
        type: 'start',
        blindStart: true,
        ...maskBlindStart(blindStart, SPECTATOR_SEAT),
        state: captureSeatProjection(room.authority!, SPECTATOR_SEAT),
        qijia: start.qijia,
        changshu,
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
    // [2026-07-23 リョー要望 観戦モード] 閲覧専用接続はここで分岐。
    // room.members には入れず [ゲーム進行・全員ready・cleanup 判定に不関与]、
    // 受信は resync だけ処理して action は一切 authority に触らせない
    if (payload.spectator === true) {
      const generation = ++room.generation;
      const previousSpec = room.spectators.get(payload.uid);
      if (previousSpec?.ws && previousSpec.ws !== ws) previousSpec.ws.close(4001, 'replaced by newer connection');
      room.spectators.set(payload.uid, {
        user_id: payload.uid,
        username: payload.username ?? payload.uid,
        ws,
        generation,
      });
      const membersForSync = () => Array.from(room.members.values())
        .sort((a, b) => a.seat - b.seat)
        .map(({ seat, user_id, username, is_cpu, connected }) => ({ seat, user_id, username, is_cpu, connected }));
      const specSync = () => sendSync(
        ws, room.snapshot, SPECTATOR_SEAT, room.authority,
        persistence.loadCommands(room.roomId), membersForSync(),
      );
      const handleSpectatorMessage = (data: RawData) => {
        room.queue = room.queue.then(async () => {
          let msg: unknown;
          try { msg = JSON.parse(data.toString()); } catch { return; }
          if ((msg as Record<string, unknown>)?.type === 'resync') specSync();
        }).catch((error) => warn(`[anmika-ws] spectator queue room=${room.roomId}`, error));
      };
      ws.off('message', bufferEarlyMessage);
      ws.on('message', handleSpectatorMessage);
      ws.on('close', () => {
        const current = room.spectators.get(payload.uid);
        if (current && current.generation === generation && current.ws === ws) {
          room.spectators.delete(payload.uid);
        }
      });
      sendJson(ws, lobbyPayload(room));
      if (room.snapshot.started) specSync();
      for (const data of earlyMessages) handleSpectatorMessage(data);
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
          sendSync(ws, room.snapshot, payload.seat, room.authority, persistence.loadCommands(room.roomId), Array.from(room.members.values()).sort((a, b) => a.seat - b.seat).map(({ seat, user_id, username, is_cpu, connected }) => ({ seat, user_id, username, is_cpu, connected })));
          sendNextRoundReadyStateTo(ws, room);
          sendChipResetVoteStateTo(ws, room);
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
          // [2026-07-23 総点検 P2] 拒否は typed nack で返す [client が楽観押下を戻せるように]
          if (reason) sendJson(ws, { type: 'readyNextRoundNack', reason, revision: room.snapshot.revision });
          else sendJson(ws, { type: 'readyNextRoundAck', revision: room.snapshot.revision });
          return;
        }
        if ((msg as Record<string, unknown>)?.type === 'chipResetVote') {
          // [2026-07-23 リョー指示] 各自の checkbox = 同意 vote [着席 human のみ、上書き可]。
          // 全員 [接続有無を問わず全 human 席] 揃った時だけ nextMatch でリセット発動
          const value = msg as Record<string, unknown>;
          const voteMember = Array.from(room.members.values()).find((m) => m.seat === payload.seat);
          if (!voteMember || voteMember.is_cpu) return;
          // [2026-07-23 Sol R1テストで露出] 票 frame 直後の切断で、close handler の票失効の
          // 後に queue 上の票処理が走って復活するレース。切断済み member の票は受けない
          if (!voteMember.connected) return;
          // [2026-07-23 Sol 4周目 P2] 同意は試合終了ウィンドウ限定 [旧タブ/生 frame からの
          // 事前同意を弾く。票の有効期間は nextRound/nextMatch accept clear と合わせて match 内]
          if (room.authority?.canonicalState()?.game?.state?.finished !== true) return;
          if (value.value === true) room.chipResetVotes.add(payload.seat);
          else room.chipResetVotes.delete(payload.seat);
          broadcast(room, chipResetVotePayload(room));
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
          sendSync(ws, room.snapshot, payload.seat, room.authority, persistence.loadCommands(room.roomId), Array.from(room.members.values()).sort((a, b) => a.seat - b.seat).map(({ seat, user_id, username, is_cpu, connected }) => ({ seat, user_id, username, is_cpu, connected })));
          sendNextRoundReadyStateTo(ws, room);
          sendChipResetVoteStateTo(ws, room);
          return;
        }
        if (envelope.expectedVersion !== room.snapshot.revision
          || envelope.matchId !== room.snapshot.matchId
          || envelope.roundId !== room.snapshot.roundId) {
          reject(ws, room, envelope.commandId, 'version conflict');
          sendSync(ws, room.snapshot, payload.seat, room.authority, persistence.loadCommands(room.roomId), Array.from(room.members.values()).sort((a, b) => a.seat - b.seat).map(({ seat, user_id, username, is_cpu, connected }) => ({ seat, user_id, username, is_cpu, connected })));
          sendNextRoundReadyStateTo(ws, room);
          sendChipResetVoteStateTo(ws, room);
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
          (validated as { actorRoomSeat?: number }).actorRoomSeat ?? payload.seat,
        );
        if (!accepted.command || !accepted.ack) {
          reject(ws, room, envelope.commandId, accepted.reason ?? 'action rejected');
          // [2026-07-23 総点検] 'zimo already drawn' で弾かれた client は投影が
          // 欠けて needsZimo 停止している張本人。reject だけ返すと ▶ツモ も
          // 400ms橋 も全部弾かれて詰むため、最新 projection を送って自己修復させる
          if (String(accepted.reason ?? '').includes('zimo already drawn')) {
            sendSync(ws, room.snapshot, payload.seat, room.authority, persistence.loadCommands(room.roomId), Array.from(room.members.values()).sort((a, b) => a.seat - b.seat).map(({ seat, user_id, username, is_cpu, connected }) => ({ seat, user_id, username, is_cpu, connected })));
            sendNextRoundReadyStateTo(ws, room);
            sendChipResetVoteStateTo(ws, room);
          }
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
      // [2026-07-23 Sol 4周目 P1] 切断者のチップリセット同意は失効 [不同意側に倒す]
      if (room.chipResetVotes.delete(current.seat)) broadcast(room, chipResetVotePayload(room));
      broadcast(room, lobbyPayload(room));
      // [2026-07-22 全員ready] 切断で gate 対象が減るため、待ち状態を再評価
      if (room.nextRoundReadyRevision === room.snapshot.revision && room.nextRoundReadySeats.size > 0) {
        maybeAdvanceAllReady(room, room.nextRoundReadyRevision);
      }
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
      sendSync(ws, room.snapshot, payload.seat, room.authority, persistence.loadCommands(room.roomId), Array.from(room.members.values()).sort((a, b) => a.seat - b.seat).map(({ seat, user_id, username, is_cpu, connected }) => ({ seat, user_id, username, is_cpu, connected })));
      sendNextRoundReadyStateTo(ws, room);
      sendChipResetVoteStateTo(ws, room);
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
          const evictedSeat = member?.seat;
          if (member?.ws) {
            try { member.ws.close(4410, 'evicted'); } catch (_) { /* noop */ }
          }
          room.members.delete(user_id);
          // [2026-07-23 Sol 7周目 P2] close handler は member 削除済みで early return する
          // ため、ここで ready gate / 同意票を直接整理する。旧実装は残り全員 ready 済みでも
          // 180s timeout まで待たされた
          if (typeof evictedSeat === 'number') {
            room.nextRoundReadySeats.delete(evictedSeat);
            if (room.chipResetVotes.delete(evictedSeat)) {
              broadcast(room, chipResetVotePayload(room));
            }
            if (room.nextRoundReadyRevision === room.snapshot.revision && room.nextRoundReadySeats.size > 0) {
              broadcast(room, nextRoundReadyPayload(room));
              maybeAdvanceAllReady(room, room.nextRoundReadyRevision);
            }
          }
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
    // [2026-07-23 Sol指摘 P1 TOCTOU] chip-ledger と room-events を別 HTTP で取ると
    // 間に nextMatch が滑り込み、旧 match の chip_delta + 新 match の events が混ざる。
    // 1 handler 内の同期読みで {finished, ledger, events, matchId} を単一時点 snapshot として返す
    if (req.method === 'POST' && req.url === '/internal/match-result') {
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
          res.end(JSON.stringify({ ok: true, ledger: null, events: null, finished: false }));
          return;
        }
        // ここから応答構築まで await を挟まない [event loop 1 tick 内 = 単一時点]
        const state = authority.canonicalState();
        const finished = state.game.state.finished === true;
        const matchLedger = finished ? authority.matchResultLedger() : state.game.chipLedger;
        const ledger: Record<string, number> = {};
        for (const [seat, chips] of Object.entries(matchLedger ?? {})) {
          const member = snapshot.start.members.find((m) => m.seat === Number(seat));
          if (member) ledger[member.user_id] = chips as number;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          finished,
          ledger,
          matchId: snapshot.matchId ?? null,
          roomInstanceId: snapshot.roomInstanceId ?? null,
          events: (state.game.events ?? []).slice(0, 20000),
        }));
      } catch (_) { res.writeHead(400); res.end('bad request'); }
      return;
    }
    // [2026-07-23 リョー要望 名牌譜] authoritative 牌譜: canonical game.events の全量 dump。
    // host client の POST paifu は本人視点で他家 zimo 等がマスク済みのため、
    // 再生用の完全牌譜は authority から取る [finish_match が match INSERT 時に添付]
    // [後方互換で残置。新経路は /internal/match-result]
    if (req.method === 'POST' && req.url === '/internal/room-events') {
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
        if (!authority) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, events: null }));
          return;
        }
        const state = authority.canonicalState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          finished: state.game.state.finished,
          events: (state.game.events ?? []).slice(0, 20000),
        }));
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
        const plan = computeRewindPlan(commands);
        const keepThrough = plan.keepThrough;
        const kept = commands.filter((command) => command.revision <= keepThrough);
        if (kept.length === commands.length) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'already at round head', revision: keepThrough }));
          return;
        }
        const rewoundMatchId = plan.matchId;
        const rewoundRoundId = plan.roundId;
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
          // [2026-07-23 Sol 8周目 P0] fold した ID を実際に snapshot へ配線する
          // [7周目修正で計算だけして代入し忘れ、現 matchId/roundId が残っていた]
          matchId: rewoundMatchId,
          roundId: rewoundRoundId,
          commands: kept,
          updatedAt: new Date().toISOString(),
        };
        // [2026-07-23 4人回し Phase2] spread が持ち込む現在値は捨てた command の delta を
        // 含むため、room ledger / mapping は kept 分だけを start から fold し直す
        if (snapshot.start) {
          const foldedRoom = foldRoomState(snapshot.start, kept);
          rewound.roomChipLedger = foldedRoom.roomChipLedger;
          rewound.activeMapping = foldedRoom.activeMapping;
        }
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
          // [2026-07-23 観戦モード] 巻き戻しは観戦者にも配る
          for (const spectator of room.spectators.values()) {
            sendSync(spectator.ws, rewound, SPECTATOR_SEAT, authority, kept);
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
