// norosh1.com 牌譜 → Game3 リプレイ用アダプタ [2026-09-13 yuma]
//
// 向こうの record 形式 [gameId / rounds[].initialState{gameState,wall} / actions / scoreResults / diceResults]
// を、うちの store [createGameStore] の action に変換して 1 局ずつ再生する。
// 山は positional に carve せず、向こうの tiles[] / deadWall[] をそのまま Shan3 の
// _pai [live wall、末尾 pop] / _rinshan [先頭 shift] に流し込む。
//
//   theirs                          ours
//   tiles[drawIndex..95]        →   _pai = reverse(tiles[drawIndex..95])   [pop = tiles[drawIndex]]
//   deadWall[15], [14], ...     →   _rinshan = [deadWall[15], deadWall[14], ...]
//   doraWall / uraDoraWall      →   baopai / fubaopai
//
// 向こうは配牌の華を「その player の初手番の DRAW 直後」に抜いて deadWall から補充する。
// うちは配牌時点で華が抜けている前提 [initFromDeal の huapai] なので、初手番で抜かれる
// 配牌華の補充牌を先に配牌へ入れ、その分を _rinshan から間引く [preconsume]。
//
// このモジュールは CLI ではない。tools/norosh_audit.mts から使う。
import { get } from 'svelte/store';
import { Game3 } from '../../src/lib/game3.ts';
import { Shan3, defaultSanmaRule } from '../../src/lib/shan3.ts';
import { createGameStore, applyPingjuTransition, type StoreState } from '../../src/lib/store.ts';
import { toCorePai } from '../../src/lib/helpers.ts';
import { computeSanmaBase } from '../../src/lib/game3/settlement.ts';
import type { PlayerId } from '../../src/lib/types.ts';

// ---------------------------------------------------------------------------
// their record types [必要な部分だけ]
// ---------------------------------------------------------------------------

export type TheirTile = {
  suit: 'man' | 'pin' | 'sou' | 'honor' | 'special';
  num: number;
  variant?: 'red' | 'gold';
  pocchiColor?: 'green' | 'blue' | 'red' | 'yellow';
};

export type TheirAction = {
  type: string;
  playerId?: number | null;
  tile?: TheirTile;
  tiles?: TheirTile[];
  isTsumoGiri?: boolean;
  isShuba?: boolean;
  isOpen?: boolean;
  isFever?: boolean;
  flower?: { type: 'spring' | 'summer' | 'autumn' | 'winter'; isFromDora?: boolean };
  targets?: Array<{ flower: string; effect: string }>;
  target?: [number, number];
  targetId?: number;
};

export type TheirPlayerState = {
  id: number;
  name: string;
  score: number;
  chips: number;
  hand: TheirTile[];
  drawnTile: TheirTile | null;
  flowers: TheirTile[];
  northCount: number;
  goldNorths: unknown[];
};

export type TheirRound = {
  round: number;
  honba: number;
  initialState: {
    gameState: {
      round: number;
      honba: number;
      kyotaku: number;
      currentTurn: number;
      wallCount: number;
      phase: string;
      players: Record<string, TheirPlayerState>;
      doraIndicators: TheirTile[];
      uraDoraIndicators: TheirTile[];
    };
    wall: {
      tiles: TheirTile[];
      deadWall: TheirTile[];
      doraWall: TheirTile[];
      uraDoraWall: TheirTile[];
      drawIndex: number;
      deadWallIndex: number;
      doraCount: number;
    };
  };
  actions: TheirAction[];
  scoreResults: Record<string, TheirScoreResult>;
  diceResults: Array<{ die1: number; die2: number }>;
};

export type TheirScoreResult = {
  yaku: Array<{ name: string; han: number; isYakuman: boolean; yakumanCount: number }>;
  totalHan: number;
  fu: number;
  rankName: string;
  rankLevel: number;
  baseScore: number;
  isYakuman: boolean;
  yakumanCount: number;
  natsuNatsuKinpei?: boolean;
  basicChips: Array<{ reason: string; chips: number; payment: string }>;
  bonusChips: Array<{ reason: string; chips: number; payment: string; isShubaExempt?: boolean }>;
  diceChances: Array<{ reason: string; baseChips: number; count: number; isShuba?: boolean }>;
};

export type TheirGame = {
  gameId: string;
  recordedAt: string;
  rule: { version: string; options?: { ruleSet?: any } };
  players: Record<string, string>;
  rounds: TheirRound[];
};

// ---------------------------------------------------------------------------
// tile / seat mapping
// ---------------------------------------------------------------------------

const FLOWER_KEY: Record<string, string> = { spring: 'f1', summer: 'f2', autumn: 'f3', winter: 'f4' };

/** their tile → our physical key [gp / gs / gN / z5b.. / f1-4]. 虹牌はうちだけなので出ない */
export function tileKey(t: TheirTile): string {
  if (t.suit === 'special') return 'z5' + (t.pocchiColor ?? 'b')[0];
  if (t.suit === 'honor') {
    if (t.num === 4) return t.variant === 'gold' ? 'gN' : 'z4';
    if (t.num >= 8) return `f${t.num - 7}`;
    return `z${t.num}`;
  }
  const c = t.suit[0];
  if (t.num === 5 && t.variant === 'red') return `${c}0`;
  if (t.num === 5 && t.variant === 'gold') return `g${c}`;
  return `${c}${t.num}`;
}

/** their seat [1..3] → our PlayerId。手番順 1→2→3 が うちの 0→2→1 [反時計] に対応 */
export const SEAT_TO_OURS: Record<number, PlayerId> = { 1: 0, 2: 2, 3: 1 };
export const SEAT_TO_THEIRS: Record<PlayerId, number> = { 0: 1, 2: 2, 1: 3 };

export const isFlower = (k: string | null | undefined): boolean => !!k && /^f[1-4]$/.test(k);
export const isNorth = (k: string | null | undefined): k is 'z4' | 'gN' => k === 'z4' || k === 'gN';

// ---------------------------------------------------------------------------
// their-side model [tile resolver]
// ---------------------------------------------------------------------------

export type SeatModel = {
  hand: Map<string, number>;
  /** 手牌中の華/北の出所 [dealt = 配牌および配牌華の補充連鎖、 live = 山ツモおよびその連鎖] */
  origin: Map<string, { dealt: number; live: number }>;
  drawn: string | null;
  drawnOrigin: 'dealt' | 'live' | null;
  flowers: string[];
  north: number;
  gnorth: number;
  melds: Array<{ kind: 'pon' | 'ankan' | 'kakan' | 'daiminkan'; tiles: string[] }>;
  riichi: boolean;
  fever: boolean;
  hadTurn: boolean;
  discards: string[];
  /** 未打牌のツモ/補充/副露を持つ [打牌できる状態]。false の時の DISCARD は向こうの client の再送 [記録に残る拒否済要求] */
  canAct: boolean;
  /** 直近の自分の action 種別 [PASS 除く]。TSUMO/RON/KAN の再送検出用 */
  lastAction: string | null;
  /** 直近の副露/暗槓/加槓の牌 [再送検出用] */
  lastMeld: string[] | null;
};

export type NormEvent =
  | { i: number; type: 'DRAW'; seat: number; tile: string }
  | { i: number; type: 'DRAW_EMPTY'; seat: number }
  | { i: number; type: 'DRAW_UNRESOLVED'; seat: number }
  | { i: number; type: 'DRAW_FLOWER'; seat: number; flower: string; source: 'drawn' | 'hand'; replacement: string | null; deadIdx: number; firstTurn: boolean }
  | { i: number; type: 'DRAW_NORTH'; seat: number; gold: boolean; replacement: string | null; deadIdx: number }
  | { i: number; type: 'DUP'; seat: number; what: string }
  | { i: number; type: 'DISCARD'; seat: number; tile: string; riichi: null | { shuba: boolean; open: boolean; fever: boolean }; tsumogiri: boolean }
  | { i: number; type: 'STRAY_DISCARD'; seat: number; tile: string }
  | { i: number; type: 'PON'; seat: number; tiles: string[]; from: number; called: string }
  | { i: number; type: 'KAN_CLOSED'; seat: number; tiles: string[]; replacement: string | null }
  | { i: number; type: 'KAN_ADDED'; seat: number; tile: string; replacement: string | null }
  | { i: number; type: 'KAN_OPEN'; seat: number; tile: string; from: number; replacement: string | null }
  | { i: number; type: 'PASS' }
  | { i: number; type: 'TSUMO'; seat: number; tile: string | null }
  | { i: number; type: 'RON'; seat: number; from: number; tile: string | null }
  | { i: number; type: 'GOLD_NORTH'; seat: number; targets: Array<{ flower: string; effect: string }> }
  | { i: number; type: 'WINTER'; seat: number; activate: boolean }
  | { i: number; type: 'DECLARE_DICE_TARGET'; seat: number; target: [number, number] }
  | { i: number; type: 'ROLL_DICE'; seat: number; confirm: boolean; dice: [number, number] | null }
  | { i: number; type: 'CONTINUE'; seat: number }
  | { i: number; type: 'NEXT_ROUND' }
  | { i: number; type: 'END' }
  | { i: number; type: 'OTHER'; raw: string };

export type WalkResult = {
  events: NormEvent[];
  seats: Record<number, SeatModel>;
  warnings: string[];
  problems: string[];
  /** deadWall index → their seat: 初手番の配牌華補充として消費された王牌 [配牌へ先入れする] */
  preconsumed: Array<{ deadIdx: number; seat: number; tile: string }>;
  /** live wall を使い切った後に更に DRAW が続いた [フィーバー継続。記録の山から牌を解決できない] */
  postWallDraws: number;
  winners: number[];
  /** action index → その時点の向こうの手牌 [ツモ込み] 多重集合 [DRAW / DRAW_FLOWER / DRAW_NORTH 後] */
  handSnaps: Map<number, Map<string, number>>;
};

export function walkRound(round: TheirRound, opts: { ignore?: Set<number> } = {}): WalkResult {
  const gs = round.initialState.gameState;
  const w = round.initialState.wall;
  const tiles = w.tiles.map(tileKey);
  const dead = w.deadWall.map(tileKey);
  let di = w.drawIndex;
  let dd = w.deadWallIndex;
  /** 山の終端 [exclusive]。向こうはカンのドラ表示で山を縮めない [カンありの流局も山を最後まで引く] */
  // 山の長さは卓の牌構成で変わる [tiles.length = 96 / 100 / 102 / 108 / 112。7 牌 8 枚卓や金北 4 枚卓は長い]。96 固定にすると
  // 長い卓の局は後半 16 ツモを再現できず、フィーバー継続や河底が全部「山切れ」に見える
  const liveEnd = tiles.length;
  const seats: Record<number, SeatModel> = {};
  for (const p of [1, 2, 3]) {
    const pl = gs.players[String(p)];
    const hand = new Map<string, number>();
    for (const t of pl.hand) {
      const k = tileKey(t);
      hand.set(k, (hand.get(k) ?? 0) + 1);
    }
    const origin = new Map<string, { dealt: number; live: number }>();
    for (const [k, n] of hand) if (isFlower(k) || isNorth(k)) origin.set(k, { dealt: n, live: 0 });
    seats[p] = {
      hand,
      origin,
      drawn: pl.drawnTile ? tileKey(pl.drawnTile) : null,
      drawnOrigin: pl.drawnTile ? 'live' : null,
      flowers: [],
      north: 0,
      gnorth: 0,
      melds: [],
      riichi: false,
      fever: false,
      hadTurn: false,
      discards: [],
      canAct: !!pl.drawnTile,
      lastAction: null,
      lastMeld: null,
    };
  }
  const events: NormEvent[] = [];
  const handSnaps = new Map<number, Map<string, number>>();
  const warnings: string[] = [];
  const problems: string[] = [];
  const preconsumed: WalkResult['preconsumed'] = [];
  const winners: number[] = [];
  let turn = gs.currentTurn;
  let lastDiscarder: number | null = null;
  let lastDiscard: string | null = null;
  let postWallDraws = 0;
  let wallEmptyHit = false;
  // dice [their model]: DECLARE 後、ゾロ目以外 4 回で確定。次の ROLL_DICE は確認 [出目消費なし]
  let diceIdx = 0;
  let diceNonZoro = -1; // -1 = no active chance
  const has = (s: SeatModel, k: string) => (s.hand.get(k) ?? 0) > 0;
  const take = (s: SeatModel, k: string): boolean => {
    const n = s.hand.get(k) ?? 0;
    if (n <= 0) return false;
    s.hand.set(k, n - 1);
    return true;
  };
  /** 手牌 [ツモ込み] に ts の多重集合が全て揃っているか */
  const hasAll = (s: SeatModel, ts: string[]): boolean => {
    const need = new Map<string, number>();
    for (const t of ts) need.set(t, (need.get(t) ?? 0) + 1);
    for (const [k, n] of need) {
      const have = (s.hand.get(k) ?? 0) + (s.drawn === k ? 1 : 0);
      if (have < n) return false;
    }
    return true;
  };
  const sameTiles = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
  /** 直前の action [PASS 除く] */
  let lastGlobal: { type: string; seat: number } | null = null;
  const originOf = (s: SeatModel, k: string) => {
    let o = s.origin.get(k);
    if (!o) {
      o = { dealt: 0, live: 0 };
      s.origin.set(k, o);
    }
    return o;
  };
  const settleDrawn = (s: SeatModel) => {
    if (s.drawn) {
      s.hand.set(s.drawn, (s.hand.get(s.drawn) ?? 0) + 1);
      if (isFlower(s.drawn) || isNorth(s.drawn)) originOf(s, s.drawn)[s.drawnOrigin ?? 'live'] += 1;
      s.drawn = null;
      s.drawnOrigin = null;
    }
  };
  /** 手牌から華/北を 1 枚取り、その出所を返す [dealt 優先。どちらでも最終手牌は同じ] */
  const takeTracked = (s: SeatModel, k: string): 'dealt' | 'live' | null => {
    if (!take(s, k)) return null;
    const o = originOf(s, k);
    if (o.dealt > 0) {
      o.dealt -= 1;
      return 'dealt';
    }
    if (o.live > 0) {
      o.live -= 1;
      return 'live';
    }
    return 'dealt';
  };
  const deadDraw = (s: SeatModel, origin: 'dealt' | 'live'): { tile: string | null; idx: number } => {
    const idx = dd;
    if (dd < 0) return { tile: null, idx };
    const t = dead[dd];
    dd -= 1;
    settleDrawn(s);
    s.drawn = t;
    s.drawnOrigin = origin;
    return { tile: t, idx };
  };

  for (let i = 0; i < round.actions.length; i++) {
    const a = round.actions[i];
    const seat = typeof a.playerId === 'number' ? a.playerId : 0;
    const s = seats[seat];
    if (opts.ignore?.has(i)) {
      // うちのエンジンが拒否した要求 [リーチ後の待ち変化カン等]。向こうの server も拒否したとみなして無視する
      warnings.push(`#${i} ${a.type} by ${seat} treated as a rejected request [our engine refused it, record continues as if not applied]`);
      events.push({ i, type: 'DUP', seat, what: `rejected:${a.type}` });
      s.lastAction = `REJECTED:${a.type}`;
      s.lastMeld = a.tiles ? a.tiles.map(tileKey) : a.tile ? [tileKey(a.tile)] : null;
      continue;
    }
    switch (a.type) {
      case 'DRAW': {
        if (wallEmptyHit) {
          postWallDraws += 1;
          events.push({ i, type: 'DRAW_UNRESOLVED', seat });
          break;
        }
        if (di >= liveEnd) {
          wallEmptyHit = true;
          events.push({ i, type: 'DRAW_EMPTY', seat });
          break;
        }
        const t = tiles[di];
        di += 1;
        settleDrawn(s);
        s.drawn = t;
        s.drawnOrigin = 'live';
        s.canAct = true;
        s.lastAction = 'DRAW';
        turn = seat;
        events.push({ i, type: 'DRAW', seat, tile: t });
        handSnaps.set(i, theirHandMultiset(s));
        break;
      }
      case 'DRAW_FLOWER': {
        let f = FLOWER_KEY[a.flower?.type ?? ''] ?? 'f1';
        let origin: 'dealt' | 'live';
        // 記録のラベル順に従う: ツモ牌がラベルの華ならツモ牌、手牌 [配牌] にラベルの華があれば手牌から、
        // どちらにも無ければツモ牌の華 [ラベル違い] → 別種の手牌華 → それも無ければ再送 [DUP]
        if (s.drawn && isFlower(s.drawn) && s.drawn === f) {
          origin = s.drawnOrigin ?? 'live';
          s.drawn = null;
          s.drawnOrigin = null;
        } else if (has(s, f)) {
          origin = takeTracked(s, f) ?? 'dealt';
        } else if (s.drawn && isFlower(s.drawn)) {
          warnings.push(`#${i} DRAW_FLOWER label ${f} but drawn ${s.drawn} [no ${f} in hand]`);
          f = s.drawn;
          origin = s.drawnOrigin ?? 'live';
          s.drawn = null;
          s.drawnOrigin = null;
        } else {
          const alt = ['f1', 'f2', 'f3', 'f4'].find((x) => has(s, x));
          if (alt) {
            warnings.push(`#${i} DRAW_FLOWER label ${f} but hand has ${alt}`);
            f = alt;
            origin = takeTracked(s, f) ?? 'dealt';
          } else {
            warnings.push(`#${i} duplicate DRAW_FLOWER ${f} ignored [request echo]`);
            events.push({ i, type: 'DUP', seat, what: 'DRAW_FLOWER' });
            break;
          }
        }
        s.flowers.push(f);
        s.canAct = true;
        s.lastAction = 'DRAW_FLOWER';
        const rep = deadDraw(s, origin);
        const firstTurn = !s.hadTurn;
        // 配牌華 [とその補充連鎖] の補充牌はうちの配牌へ先入れする。山ツモ由来の華はうちの zimo が自動で抜く
        const source: 'drawn' | 'hand' = origin === 'dealt' ? 'hand' : 'drawn';
        // ポン等で初ツモ前に手番が回った player は配牌華をその後の DRAW で抜く。補充位置は記録通りなので同じく先入れする
        if (origin === 'dealt' && rep.tile) preconsumed.push({ deadIdx: rep.idx, seat, tile: rep.tile });
        if (origin === 'dealt' && !firstTurn) warnings.push(`#${i} info: dealt flower ${f} extracted at a later turn [ポン等で初ツモ前に手番が回った。補充牌は記録の王牌位置から先入れ]`);
        events.push({ i, type: 'DRAW_FLOWER', seat, flower: f, source, replacement: rep.tile, deadIdx: rep.idx, firstTurn });
        handSnaps.set(i, theirHandMultiset(s));
        break;
      }
      case 'DRAW_NORTH': {
        let gold: boolean;
        let origin: 'dealt' | 'live';
        if (s.drawn && isNorth(s.drawn)) {
          gold = s.drawn === 'gN';
          origin = s.drawnOrigin ?? 'live';
          s.drawn = null;
          s.drawnOrigin = null;
        } else if (has(s, 'z4')) {
          gold = false;
          origin = takeTracked(s, 'z4') ?? 'dealt';
        } else if (has(s, 'gN')) {
          gold = true;
          origin = takeTracked(s, 'gN') ?? 'dealt';
        } else {
          warnings.push(`#${i} duplicate DRAW_NORTH ignored [request echo]`);
          events.push({ i, type: 'DUP', seat, what: 'DRAW_NORTH' });
          break;
        }
        if (gold) s.gnorth += 1;
        else s.north += 1;
        s.canAct = true;
        s.lastAction = 'DRAW_NORTH';
        // 北の補充はうちも nukiBei → nukizimo で王牌から取る [北が配牌でも補充は live]
        void origin;
        const rep = deadDraw(s, 'live');
        events.push({ i, type: 'DRAW_NORTH', seat, gold, replacement: rep.tile, deadIdx: rep.idx });
        handSnaps.set(i, theirHandMultiset(s));
        break;
      }
      case 'DISCARD':
      case 'RIICHI': {
        const t = a.tile ? tileKey(a.tile) : '';
        if (wallEmptyHit) {
          // 記録の山を使い切った後の打牌 [山に無い牌が続く記録]。整合性エラーではなく未対応として扱う
          events.push({ i, type: 'STRAY_DISCARD', seat, tile: t });
          break;
        }
        if (!s.canAct) {
          // 打牌済で未ツモの席からの DISCARD = client の再送 [同じ牌の追認]。向こうの server は拒否している
          const lastOwn = s.discards.length > 0 ? s.discards[s.discards.length - 1] : null;
          if (lastOwn === t) {
            events.push({ i, type: 'DUP', seat, what: a.type });
          } else {
            warnings.push(`#${i} ${a.type} by ${seat} (${t}) without a draw ignored [last own discard ${lastOwn ?? '-'}]`);
            events.push({ i, type: 'STRAY_DISCARD', seat, tile: t });
          }
          break;
        }
        if (seat !== turn) warnings.push(`#${i} ${a.type} by ${seat} (${t}) while turn=${turn} [accepted: seat holds an undischarged draw]`);
        let tsumogiri = false;
        if (s.drawn === t) {
          s.drawn = null;
          tsumogiri = true;
        } else if (!has(s, t) && s.drawn !== t) {
          // 手牌に無い牌の打牌要求 [向こうの server は拒否したはず]。無視して続け、次の DRAW の手牌照合で検証する
          warnings.push(`#${i} ${a.type} ${t} not in hand of seat ${seat}, treated as a rejected request`);
          events.push({ i, type: 'STRAY_DISCARD', seat, tile: t });
          break;
        } else {
          settleDrawn(s);
          take(s, t);
        }
        s.hadTurn = true;
        s.canAct = false;
        s.lastAction = a.type;
        s.discards.push(t);
        lastDiscarder = seat;
        lastDiscard = t;
        if (a.type === 'RIICHI') {
          s.riichi = true;
          if (a.isFever) s.fever = true;
        }
        events.push({
          i,
          type: 'DISCARD',
          seat,
          tile: t,
          tsumogiri,
          riichi: a.type === 'RIICHI' ? { shuba: !!a.isShuba, open: !!a.isOpen, fever: !!a.isFever } : null,
        });
        break;
      }
      case 'PON': {
        if (wallEmptyHit) { events.push({ i, type: 'DUP', seat, what: 'post-wall' }); break; }
        const ts = (a.tiles ?? []).map(tileKey);
        settleDrawn(s);
        if (!hasAll(s, ts)) {
          const repeat = s.lastMeld && sameTiles(s.lastMeld, ts) && (s.lastAction === 'PON' || s.lastAction === 'REJECTED:PON');
          if (!repeat) warnings.push(`#${i} PON ${ts.join(',')} tiles missing in seat ${seat}, treated as a rejected request`);
          events.push({ i, type: 'DUP', seat, what: repeat ? 'PON' : 'rejected:PON' });
          break;
        }
        settleDrawn(s);
        for (const t of ts) take(s, t);
        s.melds.push({ kind: 'pon', tiles: ts });
        s.hadTurn = true;
        s.canAct = true;
        s.lastAction = 'PON';
        s.lastMeld = ts;
        turn = seat;
        events.push({ i, type: 'PON', seat, tiles: ts, from: lastDiscarder ?? 0, called: lastDiscard ?? '' });
        break;
      }
      case 'KAN_CLOSED': {
        if (wallEmptyHit) { events.push({ i, type: 'DUP', seat, what: 'post-wall' }); break; }
        const ts = (a.tiles ?? []).map(tileKey);
        {
          const repeat = !!s.lastMeld && sameTiles(s.lastMeld, ts) && ((s.lastAction === 'KAN_CLOSED' && !hasAll(s, ts)) || s.lastAction === 'REJECTED:KAN_CLOSED');
          if (repeat) {
            // 暗槓の再送 [記録に同じ KAN_CLOSED が連続する] / 拒否済み要求の連打
            events.push({ i, type: 'DUP', seat, what: 'KAN_CLOSED' });
            break;
          }
          if (!hasAll(s, ts)) {
            warnings.push(`#${i} KAN_CLOSED ${ts.join(',')} tiles missing in seat ${seat}, treated as a rejected request`);
            events.push({ i, type: 'DUP', seat, what: 'rejected:KAN_CLOSED' });
            s.lastAction = 'REJECTED:KAN_CLOSED';
            s.lastMeld = ts;
            break;
          }
        }
        settleDrawn(s);
        for (const t of ts) take(s, t);
        s.melds.push({ kind: 'ankan', tiles: ts });
        s.lastAction = 'KAN_CLOSED';
        s.lastMeld = ts;
        s.canAct = true;
        const rep = deadDraw(s, 'live');
        events.push({ i, type: 'KAN_CLOSED', seat, tiles: ts, replacement: rep.tile });
        break;
      }
      case 'KAN_ADDED': {
        if (wallEmptyHit) { events.push({ i, type: 'DUP', seat, what: 'post-wall' }); break; }
        const t = a.tile ? tileKey(a.tile) : '';
        {
          const repeat = !!s.lastMeld && sameTiles(s.lastMeld, [t]) && ((s.lastAction === 'KAN_ADDED' && !hasAll(s, [t])) || s.lastAction === 'REJECTED:KAN_ADDED');
          if (repeat) {
            events.push({ i, type: 'DUP', seat, what: 'KAN_ADDED' });
            break;
          }
          if (!hasAll(s, [t])) {
            warnings.push(`#${i} KAN_ADDED ${t} missing in seat ${seat}, treated as a rejected request`);
            events.push({ i, type: 'DUP', seat, what: 'rejected:KAN_ADDED' });
            s.lastAction = 'REJECTED:KAN_ADDED';
            s.lastMeld = [t];
            break;
          }
        }
        if (s.drawn === t) s.drawn = null;
        else {
          settleDrawn(s);
          take(s, t);
        }
        s.melds.push({ kind: 'kakan', tiles: [t] });
        s.lastAction = 'KAN_ADDED';
        s.lastMeld = [t];
        s.canAct = true;
        const rep = deadDraw(s, 'live');
        events.push({ i, type: 'KAN_ADDED', seat, tile: t, replacement: rep.tile });
        break;
      }
      case 'KAN_OPEN': {
        if (wallEmptyHit) { events.push({ i, type: 'DUP', seat, what: 'post-wall' }); break; }
        const t = lastDiscard ?? '';
        settleDrawn(s);
        if (!hasAll(s, [t, t, t])) {
          warnings.push(`#${i} KAN_OPEN ${t} tiles missing in seat ${seat}, treated as a rejected request`);
          events.push({ i, type: 'DUP', seat, what: 'rejected:KAN_OPEN' });
          break;
        }
        for (let k = 0; k < 3; k++) take(s, t);
        s.melds.push({ kind: 'daiminkan', tiles: [t, t, t, t] });
        s.hadTurn = true;
        s.canAct = true;
        s.lastAction = 'KAN_OPEN';
        s.lastMeld = [t, t, t, t];
        turn = seat;
        const rep = deadDraw(s, 'live');
        events.push({ i, type: 'KAN_OPEN', seat, tile: t, from: lastDiscarder ?? 0, replacement: rep.tile });
        break;
      }
      case 'PASS':
        events.push({ i, type: 'PASS' });
        break;
      case 'TSUMO':
        if (s.lastAction === 'TSUMO' && lastGlobal?.type === 'TSUMO' && lastGlobal.seat === seat) {
          events.push({ i, type: 'DUP', seat, what: 'TSUMO' });
          break;
        }
        winners.push(seat);
        events.push({ i, type: 'TSUMO', seat, tile: s.drawn });
        // フィーバー継続時、向こうは和了牌を消費 [consumedWinTiles] して手牌 13 枚に戻る。うちも continueFever で切る
        s.drawn = null;
        s.drawnOrigin = null;
        s.canAct = false;
        s.lastAction = 'TSUMO';
        break;
      case 'RON':
        if (s.lastAction === 'RON' && lastGlobal?.type === 'RON' && lastGlobal.seat === seat) {
          events.push({ i, type: 'DUP', seat, what: 'RON' });
          break;
        }
        winners.push(seat);
        events.push({ i, type: 'RON', seat, from: a.targetId ?? lastDiscarder ?? 0, tile: lastDiscard });
        s.lastAction = 'RON';
        break;
      case 'GOLD_NORTH':
        events.push({ i, type: 'GOLD_NORTH', seat, targets: a.targets ?? [] });
        break;
      case 'WINTER_ACTIVATE':
      case 'WINTER_SKIP':
        events.push({ i, type: 'WINTER', seat, activate: a.type === 'WINTER_ACTIVATE' });
        break;
      case 'DECLARE_DICE_TARGET':
        diceNonZoro = 0;
        events.push({ i, type: 'DECLARE_DICE_TARGET', seat, target: [a.target?.[0] ?? 1, a.target?.[1] ?? 2] });
        break;
      case 'ROLL_DICE': {
        if (diceNonZoro < 0 || diceNonZoro >= 4) {
          diceNonZoro = -1;
          events.push({ i, type: 'ROLL_DICE', seat, confirm: true, dice: null });
          break;
        }
        const d = round.diceResults[diceIdx];
        diceIdx += 1;
        if (!d) {
          events.push({ i, type: 'ROLL_DICE', seat, confirm: false, dice: null });
          break;
        }
        if (d.die1 !== d.die2) diceNonZoro += 1;
        events.push({ i, type: 'ROLL_DICE', seat, confirm: false, dice: [d.die1, d.die2] });
        break;
      }
      case 'CONTINUE':
        events.push({ i, type: 'CONTINUE', seat });
        break;
      case 'NEXT_ROUND':
        events.push({ i, type: 'NEXT_ROUND' });
        break;
      case 'END':
        events.push({ i, type: 'END' });
        break;
      default:
        events.push({ i, type: 'OTHER', raw: a.type });
    }
    if (a.type !== 'PASS') lastGlobal = { type: a.type, seat };
  }
  return { events, seats, warnings, problems, preconsumed, postWallDraws, winners, handSnaps };
}

// ---------------------------------------------------------------------------
// Game3 / store construction
// ---------------------------------------------------------------------------

export type RoundSetup = {
  game: Game3;
  store: ReturnType<typeof createGameStore>;
  state: StoreState;
  dealer: PlayerId;
  initialDefen: Record<PlayerId, number>;
  initialChips: Record<PlayerId, number>;
  goldNorthCount: number;
};

/**
 * 向こうの追加ドラ表示 [カン / 秋] は山の最深スタック 上段 = tiles[94] が表、下段 = tiles[95] が裏
 * [実データ 137 局のフィット]。うちの Shan3 は _pai[0] から順に表・裏を shift するので、
 * _pai の深い側を [tiles[94], tiles[95], tiles[92], tiles[93], ...] の並びで持ち、
 * ツモ [末尾 pop] だけは元の山順 [tiles[drawIndex] から昇順] を返すように pop を差し替える。
 * 冬めくり [applyFuyuChip] も _pai[0] を上段として扱うので同じ並びで整合する。
 */
export function wrapWall(arr: string[], orig: number[]): string[] {
  const a = arr as any;
  a.__orig = orig;
  a.pop = function (): string | undefined {
    const o: number[] = this.__orig;
    if (this.length === 0) return undefined;
    let best = this.length - 1;
    for (let k = this.length - 2; k >= Math.max(0, this.length - 3); k--) if (o[k] < o[best]) best = k;
    o.splice(best, 1);
    return Array.prototype.splice.call(this, best, 1)[0];
  };
  a.shift = function (): string | undefined {
    if (this.length === 0) return undefined;
    this.__orig.splice(0, 1);
    return Array.prototype.shift.call(this);
  };
  a.splice = function (start: number, deleteCount?: number, ...items: string[]): string[] {
    const dc = deleteCount === undefined ? this.length - start : deleteCount;
    this.__orig.splice(start, dc, ...items.map(() => -1));
    return Array.prototype.splice.call(this, start, dc, ...items);
  };
  a.push = function (...items: string[]): number {
    // 華 skip の補充牌は次の pop で必ず返す
    for (const _ of items) this.__orig.push(-1);
    return Array.prototype.push.call(this, ...items);
  };
  a.unshift = function (...items: string[]): number {
    this.__orig.unshift(...items.map(() => -1));
    return Array.prototype.unshift.call(this, ...items);
  };
  return arr;
}

export class NoroshShan extends Shan3 {
  // カンのドラ表示 [tiles[94] 表 / tiles[95] 裏 = 最深スタック] は向こうでは山から抜けない [カンありの流局も
  // 山を最後まで引く] ので、局中は覗くだけ [_peeked] にして山の長さを保つ。和了時の追加表示 [秋] と
  // 冬めくりは覗いた牌の次から始まるので、その直前に覗いた分を物理に抜く [flushPeeked]
  _peeked = 0;
  snapshot(): ReturnType<Shan3['snapshot']> {
    const snap = super.snapshot();
    (snap as any).noroshOrig = [...(((this as any)._pai as any).__orig ?? [])];
    (snap as any).noroshPeeked = this._peeked;
    return snap;
  }
  restore(snap: ReturnType<Shan3['snapshot']>): void {
    super.restore(snap);
    const orig = (snap as any).noroshOrig as number[] | undefined;
    const pai = (this as any)._pai as string[];
    wrapWall(pai, orig && orig.length === pai.length ? [...orig] : pai.map((_, k) => k));
    this._peeked = Number((snap as any).noroshPeeked ?? 0);
  }
  /** カン後のドラ表開示: 山から抜かずに覗く */
  kaigang(): void {
    const self = this as any;
    if (!self._weikaigang) throw new Error('not pending kaigang');
    const pai = self._pai as string[];
    const need = self._rule.fudora ? 2 : 1;
    if (pai.length - this._peeked < need) throw new Error('not enough wall tiles for kan dora');
    self._baopai.push(pai[this._peeked]);
    this._peeked += 1;
    if (self._fubaopai) {
      self._fubaopai.push(pai[this._peeked]);
      this._peeked += 1;
    }
    self.kanDoraCount += 1;
    self._weikaigang = false;
    this.commitDoraReveal();
  }
  flushPeeked(): void {
    if (this._peeked > 0) {
      ((this as any)._pai as string[]).splice(0, this._peeked);
      this._peeked = 0;
    }
  }
  /** 秋の追加表示 [和了時]: 覗き済みを抜いてから通常どおり先頭を抜く */
  drawNewDora(isFu: boolean): string | null {
    this.flushPeeked();
    return super.drawNewDora(isFu);
  }
}

/** live wall を [深い側 = 上段/下段ペア順, 末尾 = 次ツモ] で構築する。orig は tiles[] の index */
export function buildLiveWall(tiles: string[], liveStart: number): { pai: string[]; orig: number[] } {
  // 深い側から 2 枚ずつ [even index = 上段, odd = 下段] の順に並べる。末尾側は liveStart。山の長さは tiles.length [卓により 96〜112]
  const n = tiles.length;
  const idx: number[] = [];
  for (let k = n - 2; k >= liveStart; k -= 2) {
    // ペア (k, k+1): 上段 k を先に
    idx.push(k);
    if (k + 1 <= n - 1) idx.push(k + 1);
  }
  // liveStart が奇数の時、(liveStart-1, liveStart) のペアの上段 liveStart-1 は配牌済み → 末尾に liveStart だけ残る
  const set = new Set(idx);
  const orig = idx.filter((k) => k >= liveStart);
  if (!set.has(liveStart)) orig.push(liveStart);
  return { pai: orig.map((k) => tiles[k]), orig };
}


/** 局開始状態を Game3 + store に構築する。walk 済みの結果 [preconsumed] を使う */
export function setupRound(round: TheirRound, walk: WalkResult, ruleSet: any): RoundSetup {
  const gs = round.initialState.gameState;
  const w = round.initialState.wall;
  const tiles = w.tiles.map(tileKey);
  const dead = w.deadWall.map(tileKey);
  const dealerTheirs = gs.currentTurn;
  const dealer = SEAT_TO_OURS[dealerTheirs];
  if (dealer === undefined) throw new Error(`bad currentTurn ${dealerTheirs}`);

  // hands: their dealt 13 [+ drawnTile は含めない] から華を抜き、preconsumed 補充牌を足す
  const hands: Record<PlayerId, string[]> = { 0: [], 1: [], 2: [] };
  const huapai: Record<PlayerId, string[]> = { 0: [], 1: [], 2: [] };
  const goldHand: Record<PlayerId, { p: number; s: number; z: number }> = {
    0: { p: 0, s: 0, z: 0 }, 1: { p: 0, s: 0, z: 0 }, 2: { p: 0, s: 0, z: 0 },
  };
  const pochiHand: Record<PlayerId, Record<'blue' | 'red' | 'green' | 'yellow', number>> = {
    0: { blue: 0, red: 0, green: 0, yellow: 0 },
    1: { blue: 0, red: 0, green: 0, yellow: 0 },
    2: { blue: 0, red: 0, green: 0, yellow: 0 },
  };
  const preconsumedIdx = new Set(walk.preconsumed.map((p) => p.deadIdx));
  for (const p of [1, 2, 3]) {
    const ours = SEAT_TO_OURS[p];
    const dealt = gs.players[String(p)].hand.map(tileKey);
    const extra = walk.preconsumed.filter((x) => x.seat === p).map((x) => x.tile);
    // preconsumed 補充牌が華なら、それも配牌華として抜けている [連鎖]
    for (const k of [...dealt, ...extra]) {
      if (isFlower(k)) huapai[ours].push(k);
      else hands[ours].push(k);
    }
  }
  for (const p of [0, 1, 2] as PlayerId[]) {
    if (hands[p].length !== 13) {
      throw new Error(`seat ${SEAT_TO_THEIRS[p]} initial hand has ${hands[p].length} tiles after flower resolution [${hands[p].join(' ')}] huapai=${huapai[p].join(' ')}`);
    }
    for (const k of hands[p]) {
      if (k === 'gp') goldHand[p].p += 1;
      else if (k === 'gs') goldHand[p].s += 1;
      else if (k === 'gN') goldHand[p].z += 1;
      else if (k.startsWith('z5')) {
        const c = ({ b: 'blue', r: 'red', g: 'green', y: 'yellow' } as const)[k[2] as 'b' | 'r' | 'g' | 'y'];
        if (c) pochiHand[p][c] += 1;
      }
    }
  }

  const game = new Game3({ qijia: dealer, changshu: 1, shanRule: defaultSanmaRule() });
  game.state.jushu = 0;
  game.state.changbang = 0;
  game.state.benbang = round.honba;
  game.state.lizhibang = gs.kyotaku;
  game.state.lunban = 0;
  const initialDefen: Record<PlayerId, number> = { 0: 0, 1: 0, 2: 0 };
  const initialChips: Record<PlayerId, number> = { 0: 0, 1: 0, 2: 0 };
  for (const p of [1, 2, 3]) {
    const ours = SEAT_TO_OURS[p];
    initialDefen[ours] = gs.players[String(p)].score;
    initialChips[ours] = gs.players[String(p)].chips;
  }
  game.state.defen = { ...initialDefen };
  game.chipLedger = { ...initialChips };

  // live wall [pop 順 = tiles[drawIndex..]] と 王牌 [shift 順 = deadWall[15], [14], ...]
  // phase=discarding の局は親の初ツモ [tiles[drawIndex-1]] が既に drawnTile に出ている。
  // うちは drawNext で引かせるので、その 1 枚を pop 側 [末尾] に戻す
  let liveStart = w.drawIndex;
  const dealerDrawn = gs.players[String(dealerTheirs)]?.drawnTile;
  if (dealerDrawn) {
    const k = tileKey(dealerDrawn);
    if (w.drawIndex > 0 && tiles[w.drawIndex - 1] === k) liveStart = w.drawIndex - 1;
    else throw new Error(`dealer drawnTile ${k} is not tiles[${w.drawIndex - 1}]`);
  }
  const wall = buildLiveWall(tiles, liveStart);
  const rinshan: string[] = [];
  for (let idx = w.deadWallIndex; idx >= 0; idx--) {
    if (preconsumedIdx.has(idx)) continue;
    rinshan.push(dead[idx]);
  }
  const baopai = w.doraWall.map(tileKey);
  const fubaopai = w.uraDoraWall.map(tileKey);
  const shan = new NoroshShan(defaultSanmaRule());
  game.shan = shan;
  shan.restore({
    ...({ noroshOrig: wall.orig } as any),
    pai: wall.pai,
    rinshan,
    rinshanUsed: (15 - w.deadWallIndex) + walk.preconsumed.length,
    lastDrawnHuapai: [],
    lastZimoGold: false,
    lastZimoPochi: null,
    kanDoraCount: 0,
    weikaigang: false,
    baopai,
    fubaopai,
    committedBaopaiLen: baopai.length,
    committedFubaopaiLen: fubaopai.length,
    blindQueue: [],
    blindDoraQueue: [],
    blindPaishu: 0,
    fuyuRevealed: [],
  });
  (shan as any)._initialPai = [...tiles, ...dead, ...baopai, ...fubaopai];
  game.initFromDeal({ hands, huapai, goldHand, pochiHand });
  // 冬めくり [applyChipsOnHule → applyFuyuChip] は _pai 先頭を直接 splice するので、その前に覗き済みを抜く
  const origApplyChips = game.applyChipsOnHule.bind(game);
  game.applyChipsOnHule = (...args: Parameters<Game3['applyChipsOnHule']>) => {
    shan.flushPeeked();
    return origApplyChips(...args);
  };

  const store = createGameStore();
  store.setCpuSeats([]);
  const state = get(store) as StoreState;
  state.game = game;
  state.lastZimo = null;
  state.lastDapai = null;
  state.lastWinner = null;
  state.lastHuleResult = null;
  state.awaitingRonDecision = false;
  state.awaitingFulou = false;
  state.ronPassedPlayers = [];
  state.ronDeclaredPlayers = [];
  state.ronResults = [];
  state.ponCandidates = [];
  state.kanCandidates = [];
  state.roundEnded = false;
  state.pendingPingju = false;
  state.message = null;
  state.cpu = { 0: false, 1: false, 2: false };
  state.lizhiPending = null;
  state.pendingKinpei = null;
  state.pendingFuyu = null;
  state.pendingKamiPochi = null;
  state.pendingPochiSwap = null;
  state.pendingFeverContinue = null;
  state.pendingQianggang = null;
  state.pendingNukiBei = null;
  state.pendingSaiKoro = null;
  // リーチ者の自動ツモ切り [autoLizhiInline] を止める。向こうの記録通りに 1 手ずつ流すため
  state._onlineMode = true;
  const goldNorthCount = Number(ruleSet?.tileSet?.goldNorthCount ?? 1);
  return { game, store, state, dealer, initialDefen, initialChips, goldNorthCount };
}

// ---------------------------------------------------------------------------
// driver
// ---------------------------------------------------------------------------

export type CapturedWin = {
  seat: PlayerId;
  theirSeat: number;
  isRon: boolean;
  result: any;
  hand: string;
  /** この和了に属する game.chipEffects の範囲 [フィーバー複数和了は最後の和了だけ比較する] */
  effectsStart: number;
  effectsEnd: number;
};

function handOf(s: StoreState, p: PlayerId): string {
  const sp: any = s.game.shoupai.get(p);
  const g = s.game;
  return `${sp?.toString?.() ?? ''} hua=${(g.huapai[p] ?? []).join('')} kita=${g.nukidora[p]}+${g.nukidoraGold[p]} dora=${[...g.shan.baopai].join(',')} ura=${[...(g.shan.fubaopai ?? [])].join(',')}`;
}

export type DriveResult = {
  status: 'ok' | 'replay_error' | 'unsupported' | 'rejected_action';
  /** status=rejected_action: 向こうの記録にあるがうちのエンジンが拒否した action の index。呼び出し側は walkRound に ignore で渡して再生し直す */
  rejectedIndex: number | null;
  reason: string | null;
  wins: CapturedWin[];
  notes: string[];
  eventsApplied: number;
  pingju: boolean;
  diceBreakdown: Array<{ label: string; base: number; multiplier: number; total: number; winner: number }>;
  chipEffects: any[];
};

class ReplayError extends Error {
  constructor(msg: string) { super(msg); }
}

export function driveRound(setup: RoundSetup, walk: WalkResult, opts: { trace?: (line: string) => void } = {}): DriveResult {
  const { store } = setup;
  const trace = opts.trace ?? (() => {});
  let rejectedIndex: number | null = null;
  const S = (): StoreState => get(store) as StoreState;
  const notes: string[] = [];
  const wins: CapturedWin[] = [];
  const capturedWinners = new Set<string>();
  /** 和了宣言時点の chipEffects 長 [和了ごとの effect 範囲を切るため] */
  const winMarks: Array<{ seat: PlayerId; start: number }> = [];
  const markWin = (seat: PlayerId) => {
    const len = S().game.chipEffects?.length ?? 0;
    winMarks.push({ seat, start: len });
  };
  const effectRange = (seat: PlayerId): { start: number; end: number } => {
    const total = S().game.chipEffects?.length ?? 0;
    let idx = -1;
    for (let k = winMarks.length - 1; k >= 0; k--) if (winMarks[k].seat === seat) { idx = k; break; }
    if (idx < 0) return { start: 0, end: total };
    const start = winMarks[idx].start;
    let end = total;
    for (let k = idx + 1; k < winMarks.length; k++) if (winMarks[k].start > start) { end = winMarks[k].start; break; }
    return { start, end };
  };
  let applied = 0;
  let roundOver = false;
  let feverWinner: PlayerId | null = null;
  const pendingKey = (s: StoreState): string | null => {
    if (s.pendingFuyu) return 'fuyu';
    if (s.pendingKinpei) return 'kinpei';
    if (s.pendingKamiPochi) return 'kamipochi';
    if (s.pendingPochiSwap) return 'pochiswap';
    if (s.pendingSaiKoro) return 'saikoro';
    if (s.pendingFeverContinue) return 'fevercontinue';
    return null;
  };
  const currentPlayer = (s: StoreState): PlayerId => s.game.lunbanToPlayerId(s.game.state.lunban);
  const checkHand = (s: StoreState, p: PlayerId, i: number, label: string) => {
    const theirs = walk.handSnaps.get(i);
    if (!theirs) return;
    // 向こうの手牌に未抜きの配牌華が残る間 [初手番の抜き途中] は、うちは補充牌に置換済みなので比較しない
    if ([...theirs.keys()].some((k) => isFlower(k))) return;
    const ours = ourHandMultiset(s.game.shoupai.get(p));
    const d = multisetDiff(theirs, ours);
    if (d) throw new ReplayError(`hand mismatch after ${label} #${i} [theirs/ours] ${d}`);
  };
  const zimoOf = (s: StoreState, p: PlayerId): string | null => {
    const sp = s.game.shoupai.get(p);
    const z = sp?._anmikaZimo ?? sp?._zimo ?? null;
    return typeof z === 'string' && z.length <= 3 ? z : null;
  };
  const captureWins = () => {
    const s = S();
    if (s.ronResults.length > 0) {
      for (const rr of s.ronResults) {
        const key = `ron:${rr.player}`;
        if (capturedWinners.has(key)) continue;
        capturedWinners.add(key);
        const range = effectRange(rr.player as PlayerId);
        wins.push({ seat: rr.player as PlayerId, theirSeat: SEAT_TO_THEIRS[rr.player as PlayerId], isRon: true, result: rr.result, hand: handOf(s, rr.player as PlayerId), effectsStart: range.start, effectsEnd: range.end });
      }
    } else if (s.lastWinner !== null && s.lastHuleResult) {
      const key = `tsumo:${s.lastWinner}:${s.game.events.length}`;
      if (!capturedWinners.has(key)) {
        capturedWinners.add(key);
        const range = effectRange(s.lastWinner as PlayerId);
        wins.push({ seat: s.lastWinner as PlayerId, theirSeat: SEAT_TO_THEIRS[s.lastWinner as PlayerId], isRon: false, result: s.lastHuleResult, hand: handOf(s, s.lastWinner as PlayerId), effectsStart: range.start, effectsEnd: range.end });
      }
    }
  };
  const resolveReactions = (label: string) => {
    for (let guard = 0; guard < 8; guard++) {
      const s = S();
      if (!(s.awaitingRonDecision || s.awaitingFulou || s.pendingQianggang || s.pendingNukiBei)) return;
      if (pendingKey(s)) return; // 和了者の判断が先
      const before = tokenOf(s);
      store.pass();
      if (tokenOf(S()) === before) {
        throw new ReplayError(`${label}: pass made no progress [${S().message ?? ''}]`);
      }
    }
    throw new ReplayError(`${label}: reaction window did not close`);
  };
  /** 冬の判断: 向こうの記録に WINTER_* があればそれ、無ければ「フィーバーが続く [次が live event] なら保留、
   *  局が終わる [NEXT_ROUND / END / 山切れ] なら発動」。向こうは winterActivationDisabled 卓や自動設定で
   *  WINTER action を記録しないので、旧実装の「無ければ発動」は継続中のフィーバーをうちだけ終わらせていた */
  const decideFuyu = (fromIdx: number, winnerSeat: PlayerId | null): boolean => {
    let sawNextRound = false;
    for (let k = fromIdx; k < walk.events.length; k++) {
      const e = walk.events[k];
      if (e.type === 'WINTER' && (winnerSeat === null || SEAT_TO_OURS[e.seat] === winnerSeat)) {
        (e as any).consumed = true;
        return e.activate;
      }
      if (e.type === 'CONTINUE') return false;
      if (e.type === 'NEXT_ROUND') { sawNextRound = true; continue; }
      if (e.type === 'END' || e.type === 'DRAW_EMPTY' || e.type === 'DRAW_UNRESOLVED') return true;
      if (e.type === 'DRAW' || e.type === 'DRAW_FLOWER' || e.type === 'DRAW_NORTH' || e.type === 'DISCARD' || e.type === 'PON' || e.type === 'KAN_CLOSED' || e.type === 'KAN_ADDED' || e.type === 'KAN_OPEN' || e.type === 'TSUMO' || e.type === 'RON') {
        // NEXT_ROUND の後の DRAW は次局の初ツモ [記録の境界ずれ] なので継続とは見ない
        return sawNextRound;
      }
    }
    return true;
  };
  const autoResolvePendings = (why: string, fromIdx: number) => {
    for (let guard = 0; guard < 32; guard++) {
      const s = S();
      const k = pendingKey(s);
      if (!k) return;
      const before = tokenOf(s);
      if (k === 'fuyu') {
        const winner = (s.pendingFuyu?.winner ?? null) as PlayerId | null;
        const use = decideFuyu(fromIdx, winner);
        notes.push(`auto selectFuyu(${use}) [${why}: ${use ? 'their record ends the round' : 'their fever continues without WINTER'}]`);
        store.selectFuyu(use);
      } else if (k === 'kinpei') {
        // 向こうの記録に GOLD_NORTH が無いまま次へ進む = 強化なし。うちは保留 [null] を試し、
        // 拒否 [非フィーバー時は選択必須] なら打点に響かない順で選ぶ
        const avail = s.pendingKinpei?.availableHuapai ?? s.game.effectiveHuapaiAtHule(s.pendingKinpei!.winner as PlayerId);
        store.selectKinpei(null);
        if (S().pendingKinpei) {
          const pick = pickKinpeiTarget(avail, null);
          notes.push(`auto selectKinpei(${pick}) [${why}: their record has no GOLD_NORTH, hold rejected]`);
          store.selectKinpei(pick);
        } else {
          notes.push(`auto selectKinpei(null) [${why}: their record has no GOLD_NORTH]`);
        }
      } else if (k === 'pochiswap') {
        const target = s.pendingPochiSwap?.candidates?.[0]?.target;
        notes.push(`auto selectPochiSwap(${target}) [${why}]`);
        if (target) store.selectPochiSwap(target);
      } else if (k === 'kamipochi') {
        const target = s.pendingKamiPochi?.candidates?.[0];
        notes.push(`auto selectKamiPochi(${target}) [${why}]`);
        if (target) store.selectKamiPochi(target, s.pendingKamiPochi?.occurrenceKey);
      } else if (k === 'saikoro') {
        const ps = s.pendingSaiKoro!;
        if (ps.finalized) store.advanceSaiKoro();
        else {
          if (!ps.selectedCombo) store.selectSaiKoroCombo(1, 2);
          store.rollSaiKoroDice([3, 4]); // 宣言 [1,2] に対して常に外れ
        }
        if (guard === 0) notes.push(`auto dice (no hit) for our-only chance [${why}]`);
      } else if (k === 'fevercontinue') {
        return; // 続行は live event 側で扱う
      }
      if (tokenOf(S()) === before) throw new ReplayError(`auto-resolve ${k} made no progress [${S().message ?? ''}]`);
    }
    throw new ReplayError('auto-resolve loop did not converge');
  };
  const ensureLiveReady = (label: string, fromIdx: number) => {
    for (let guard = 0; guard < 16; guard++) {
      const s = S();
      trace(`   [ensure ${label}] pend=${pendingKey(s) ?? '-'} feverCont=${!!s.pendingFeverContinue} msg=${(s.message ?? '').slice(0, 80)}`);
      if (pendingKey(s) && pendingKey(s) !== 'fevercontinue') {
        autoResolvePendings(`before ${label}`, fromIdx);
        continue;
      }
      if (s.pendingFeverContinue) {
        const before = tokenOf(s);
        store.continueFever();
        if (tokenOf(S()) === before) throw new ReplayError(`${label}: continueFever made no progress [${S().message ?? ''}]`);
        continue;
      }
      return;
    }
    throw new ReplayError(`${label}: pending decisions did not settle [${pendingKey(S()) ?? '-'} feverCont=${!!S().pendingFeverContinue} ${(S().message ?? '').slice(0, 80)}]`);
  };

  const events = walk.events;
  try {
    for (let ei = 0; ei < events.length; ei++) {
      const ev = events[ei];
      if (ev.type === 'END') break;
      if (ev.type === 'DRAW_UNRESOLVED') {
        // 記録の山を使い切った後も向こうの進行が続く [牌が記録に無い]。以降は再現不能
        return finish('unsupported', `their play continued past the recorded wall [${walk.postWallDraws} post-wall draws not resolvable from the record]`);
      }
      if (roundOver) {
        // 和了後 [フィーバー継続なし] / 流局後の残り [次局の初ツモ等] は無視
        if (ev.type === 'DRAW' || ev.type === 'DRAW_EMPTY' || ev.type === 'DRAW_UNRESOLVED' || ev.type === 'DISCARD') continue;
      }
      const seat = 'seat' in ev ? SEAT_TO_OURS[ev.seat] : null;
      {
        const st = S();
        trace(`   [pre] cur=p${currentPlayer(st)} zimo=${zimoOf(st, currentPlayer(st))} lastDapai=${st.lastDapai ? `p${st.lastDapai.player}:${st.lastDapai.pai}` : '-'} ron=${st.awaitingRonDecision} fulou=${st.awaitingFulou} pend=${pendingKey(st) ?? '-'} nuki=${!!st.pendingNukiBei} qg=${!!st.pendingQianggang} ended=${st.roundEnded} paishu=${st.game.shan.paishu} msg=${(st.message ?? '').slice(0, 60)} hands=${([0, 1, 2] as PlayerId[]).map((p) => `p${p}:${(st.game.shoupai.get(p) as any)?.toString?.() ?? ''}`).join(' ')}`);
      }
      trace(`#${ev.i} ${ev.type} ${'seat' in ev ? `their${ev.seat}/our${seat}` : ''} ${JSON.stringify({ ...ev, i: undefined, type: undefined, seat: undefined })}`);
      switch (ev.type) {
        case 'DRAW_UNRESOLVED':
          return finish('unsupported', `their play continued past the recorded wall [${walk.postWallDraws} post-wall draws not resolvable from the record]`);
        case 'DRAW_EMPTY': {
          // 向こう: 山なしの DRAW = 流局トリガ。うちは直前の pass 時点で zimo が null → pingju 済のはず
          {
            // 河底の打牌に対するロンは向こうでは DRAW [空] の後に記録される。先に流局させない
            const nxt = events.slice(ei + 1, ei + 4).find((e) => e.type !== 'PASS' && e.type !== 'DUP' && e.type !== 'STRAY_DISCARD');
            if (nxt && nxt.type === 'RON') break;
          }
          ensureLiveReady('DRAW_EMPTY', ei);
          const s = S();
          if (!(s.pendingPingju || s.roundEnded)) {
            if (s.game.shan.paishu === 0) {
              store.drawNext();
            } else {
              // 向こうは山を 1〜2 枚残して流局にする局がある [カン/秋の表示牌ぶん]。うちも流局へ
              notes.push(`their wall ended with ${s.game.shan.paishu} tile(s) left on our side, forced ryukyoku`);
              applyPingjuTransition(s, '🌀 [norosh] 向こうの山切れに合わせて流局:');
            }
            if (!(S().pendingPingju || S().roundEnded)) {
              throw new ReplayError(`their wall exhausted but our engine still live [paishu=${S().game.shan.paishu}]`);
            }
          }
          roundOver = true;
          break;
        }
        case 'DRAW': {
          ensureLiveReady('DRAW', ei);
          const s = S();
          if (s.roundEnded || s.pendingPingju) {
            // 判定材料: リーチ者の手牌とうちの待ち [フィーバー待ち枯れ判定の突き合わせ用]
            const lz = ([0, 1, 2] as PlayerId[]).filter((p) => s.game.lizhi.has(p)).map((p) => {
              let ting: string[] = [];
              try { ting = s.game.getTingpaiList(p); } catch { /* ignore */ }
              return `p${p}:${(s.game.shoupai.get(p) as any)?.toString?.() ?? ''} ting=${ting.join(',')} live=${[...((s.game.shan as any)._pai ?? [])].join('')}`;
            });
            throw new ReplayError(`their DRAW #${ev.i} but our round already ended [${s.message ?? ''}] {${lz.join(' | ')}}`);
          }
          const cur = currentPlayer(s);
          if (cur !== seat) throw new ReplayError(`turn mismatch at DRAW #${ev.i}: theirs seat${ev.seat} (our ${seat}) vs our current p${cur}`);
          if (zimoOf(s, cur) === null) {
            store.drawNext();
          }
          const s2 = S();
          if (s2.roundEnded || s2.pendingPingju) throw new ReplayError(`our engine ended round on DRAW #${ev.i} [${s2.message ?? ''}]`);
          // 華連鎖: 向こうは DRAW(華) の後 DRAW_FLOWER で補充、うちは zimo 内で自動抜き。
          // 北 [DRAW_NORTH] も同じ手番内で補充されるので、手牌全体 [ツモ込み] の多重集合で照合する
          if (!isFlower(ev.tile) && !isNorth(ev.tile)) checkHand(s2, seat!, ev.i, 'DRAW');
          applied += 1;
          break;
        }
        case 'DRAW_FLOWER': {
          // phase=discarding の局は親の初 DRAW が無いので、ここで引かせる
          if (!roundOver) ensureLiveReady('DRAW_FLOWER', ei);
          {
            const s0 = S();
            const cur = currentPlayer(s0);
            if (cur === seat && zimoOf(s0, cur) === null && s0.game.shoupai.get(cur)?._zimo == null && !s0.roundEnded) store.drawNext();
          }
          const s = S();
          const hua = s.game.huapai[seat!];
          if (!hua.includes(ev.flower)) {
            throw new ReplayError(`flower ${ev.flower} not extracted on our side for seat${ev.seat} #${ev.i} [ours huapai=${hua.join(',')}]`);
          }
          if (ev.replacement && !isFlower(ev.replacement) && !isNorth(ev.replacement)) checkHand(s, seat!, ev.i, 'DRAW_FLOWER');
          break;
        }
        case 'DRAW_NORTH': {
          ensureLiveReady('DRAW_NORTH', ei);
          const s = S();
          const cur = currentPlayer(s);
          if (cur !== seat) throw new ReplayError(`turn mismatch at DRAW_NORTH #${ev.i}: theirs seat${ev.seat} vs our p${cur}`);
          if (zimoOf(s, cur) === null) store.drawNext();
          const before = tokenOf(S());
          store.nukiBei({ gold: ev.gold });
          const s2 = S();
          if (tokenOf(s2) === before) throw new ReplayError(`nukiBei rejected #${ev.i} [gold=${ev.gold}] [${s2.message ?? ''}]`);
          if (!s2.awaitingRonDecision && !s2.pendingNukiBei && ev.replacement && !isFlower(ev.replacement) && !isNorth(ev.replacement)) {
            checkHand(s2, seat!, ev.i, 'DRAW_NORTH');
          }
          applied += 1;
          break;
        }
        case 'NEXT_ROUND': {
          // 局終了フェーズの進行。フィーバー続行 [CONTINUE が続く] 以外は局終了とみなし、以降の DRAW [次局の初ツモ] は無視
          let k = ei + 1;
          let cont = false;
          for (; k < events.length; k++) {
            const t = events[k].type;
            if (t === 'CONTINUE') { cont = true; break; }
            if (t === 'DRAW' || t === 'DISCARD' || t === 'END' || t === 'DRAW_EMPTY' || t === 'TSUMO' || t === 'RON') break;
          }
          if (!cont && !S().pendingFeverContinue) roundOver = true;
          break;
        }
        case 'DUP':
        case 'STRAY_DISCARD':
        case 'OTHER':
          break;
        case 'PASS': {
          const s = S();
          if (roundOver) break;
          if (pendingKey(s)) break; // 和了直後の PASS [他候補見送り] は post-win 処理側で吸収
          resolveReactions(`PASS #${ev.i}`);
          applied += 1;
          break;
        }
        case 'DISCARD': {
          ensureLiveReady('DISCARD', ei);
          const s = S();
          if (s.awaitingRonDecision || s.awaitingFulou) resolveReactions(`before DISCARD #${ev.i}`);
          const cur = currentPlayer(S());
          if (cur !== seat) throw new ReplayError(`turn mismatch at DISCARD #${ev.i}: theirs seat${ev.seat} vs our p${cur}`);
          if (zimoOf(S(), cur) === null && S().game.shoupai.get(cur)?._zimo == null) {
            // ポン直後は _zimo に mianzi が入るので null ではない。ここに来るのは未ツモ
            store.drawNext();
          }
          if (ev.riichi) {
            store.lizhi({ shuvari: ev.riichi.shuba, open: ev.riichi.open, fever: ev.riichi.fever });
            if (S().lizhiPending !== cur) throw new ReplayError(`lizhi rejected #${ev.i} [${S().message ?? ''}]`);
            if (ev.riichi.fever) feverWinner = cur;
          }
          const before = tokenOf(S());
          store.discard(ev.tile, discardMeta(ev.tile));
          const s2 = S();
          if (tokenOf(s2) === before || (s2 as any)._lastDapaiFailed) {
            throw new ReplayError(`discard ${ev.tile} rejected #${ev.i} [${s2.message ?? ''}]`);
          }
          applied += 1;
          break;
        }
        case 'PON': {
          const s = S();
          if (s.awaitingRonDecision) {
            // ロン候補は全員見送り [向こうはロンしていない] → 副露 stage へ
            store.pass();
          }
          const s2 = S();
          if (!s2.awaitingFulou) throw new ReplayError(`PON #${ev.i}: our engine has no fulou window [${s2.message ?? ''}]`);
          const cand = s2.ponCandidates.find((c) => c.player === seat);
          if (!cand) throw new ReplayError(`PON #${ev.i}: seat${ev.seat} not a pon candidate on our side`);
          const mianzi = pickPonMianzi(cand.mianzi, ev.tiles, ev.called);
          store.pon(seat!, mianzi);
          const s3 = S();
          if (s3.awaitingFulou || currentPlayer(s3) !== seat) throw new ReplayError(`pon ${mianzi} rejected #${ev.i} [${s3.message ?? ''}]`);
          applied += 1;
          break;
        }
        case 'KAN_OPEN': {
          const s = S();
          if (s.awaitingRonDecision) store.pass();
          const s2 = S();
          if (!s2.awaitingFulou) throw new ReplayError(`KAN_OPEN #${ev.i}: no fulou window [${s2.message ?? ''}]`);
          const cand = s2.kanCandidates.find((c) => c.player === seat);
          if (!cand) throw new ReplayError(`KAN_OPEN #${ev.i}: seat${ev.seat} not a daimingang candidate`);
          store.damingang(seat!, cand.mianzi[0]);
          const s3 = S();
          if (s3.awaitingFulou || currentPlayer(s3) !== seat) throw new ReplayError(`damingang rejected #${ev.i} [${s3.message ?? ''}]`);
          applied += 1;
          break;
        }
        case 'KAN_CLOSED':
        case 'KAN_ADDED': {
          ensureLiveReady(ev.type, ei);
          const s = S();
          const cur = currentPlayer(s);
          if (cur !== seat) throw new ReplayError(`turn mismatch at ${ev.type} #${ev.i}: theirs seat${ev.seat} vs our p${cur}`);
          if (zimoOf(s, cur) === null && s.game.shoupai.get(cur)?._zimo == null) store.drawNext();
          const cands = S().game.getKanCandidates(cur);
          const base = ev.type === 'KAN_CLOSED' ? ev.tiles[0] : ev.tile;
          const mianzi = pickKanMianzi(cands, base, ev.type === 'KAN_ADDED');
          if (!mianzi) {
            // リーチ後の待ち変化カン等、向こうの server も拒否した要求が記録に残る [同じ KAN が連打され、その後同じ牌を打牌している]
            rejectedIndex = ev.i;
            return finish('rejected_action', `${ev.type} #${ev.i}: no matching kan candidate for ${base} [cands=${cands.join(',')}]`);
          }
          const before = tokenOf(S());
          store.declareKan(mianzi);
          const s2 = S();
          if (tokenOf(s2) === before) {
            rejectedIndex = ev.i;
            return finish('rejected_action', `declareKan ${mianzi} rejected #${ev.i} [${s2.message ?? ''}]`);
          }
          applied += 1;
          break;
        }
        case 'TSUMO': {
          ensureLiveReady('TSUMO', ei);
          const s = S();
          const cur = currentPlayer(s);
          if (cur !== seat) throw new ReplayError(`turn mismatch at TSUMO #${ev.i}: theirs seat${ev.seat} vs our p${cur}`);
          if (zimoOf(s, cur) === null) store.drawNext();
          const before = tokenOf(S());
          markWin(cur);
          store.tsumo();
          const s2 = S();
          if (tokenOf(s2) === before) throw new ReplayError(`tsumo rejected #${ev.i} [${s2.message ?? ''}]`);
          applied += 1;
          finishWinLater(ei, cur);
          break;
        }
        case 'RON': {
          const s = S();
          if (!s.awaitingRonDecision) throw new ReplayError(`RON #${ev.i}: our engine has no ron window [${s.message ?? ''}]`);
          const before = tokenOf(s);
          markWin(seat!);
          store.ron(seat!);
          const s2 = S();
          if (tokenOf(s2) === before || !(s2.ronDeclaredPlayers.includes(seat!) || pendingKey(s2) || s2.ronResults.some((r) => r.player === seat))) {
            throw new ReplayError(`ron rejected #${ev.i} [${s2.message ?? ''}]`);
          }
          applied += 1;
          // 後続の PASS で残候補を閉じる。次 event が RON なら継続 [ダブロン]
          const next = events[ei + 1];
          if (!next || next.type !== 'RON') {
            // 向こうの PASS 相当をここで先に処理 [pending modal の前に候補窓を閉じる]
            if (S().awaitingRonDecision && !pendingKey(S())) resolveReactions(`after RON #${ev.i}`);
            finishWinLater(ei, seat!);
          }
          break;
        }
        case 'GOLD_NORTH': {
          const s = S();
          const w = seat!;
          if (s.pendingFuyu) {
            // 向こうは GOLD_NORTH → WINTER の順、うちは冬 → 金北。先読みして冬を先に決める
            const use = decideFuyu(ei + 1, w);
            notes.push(`fuyu decided before GOLD_NORTH: ${use}`);
            store.selectFuyu(use);
          }
          const s2 = S();
          if (s2.pendingKinpei) {
            const avail = s2.pendingKinpei.availableHuapai ?? s2.game.effectiveHuapaiAtHule(s2.pendingKinpei.winner as PlayerId);
            const pick = pickKinpeiTarget(avail, ev.targets);
            if (ev.targets.length > 1) notes.push(`their GOLD_NORTH has ${ev.targets.length} targets [${ev.targets.map((t) => t.effect).join('/')}], ours supports one (${pick})`);
            if (ev.targets.length === 0) notes.push(`their GOLD_NORTH targets=[] , ours selected ${pick}`);
            const before = tokenOf(s2);
            store.selectKinpei(pick);
            if (tokenOf(S()) === before) {
              throw new ReplayError(`selectKinpei(${pick}) rejected #${ev.i} [${S().message ?? ''}]`);
            }
          } else {
            notes.push(`their GOLD_NORTH [${ev.targets.map((t) => t.effect).join('/') || 'none'}] but no kinpei choice pending on our side`);
          }
          applied += 1;
          break;
        }
        case 'WINTER': {
          if ((ev as any).consumed) break;
          const s = S();
          if (s.pendingFuyu) {
            store.selectFuyu(ev.activate);
            applied += 1;
          } else {
            notes.push(`their WINTER_${ev.activate ? 'ACTIVATE' : 'SKIP'} but no fuyu choice pending on our side`);
          }
          break;
        }
        case 'DECLARE_DICE_TARGET': {
          const s = S();
          if (s.pendingKinpei || s.pendingFuyu) autoResolvePendings('before dice', ei);
          const s2 = S();
          if (s2.pendingSaiKoro) {
            if (s2.pendingSaiKoro.finalized) store.advanceSaiKoro();
            if (S().pendingSaiKoro) store.selectSaiKoroCombo(ev.target[0], ev.target[1]);
            applied += 1;
          } else {
            notes.push(`their dice chance declared but none pending on our side`);
          }
          break;
        }
        case 'ROLL_DICE': {
          const s = S();
          if (!s.pendingSaiKoro) break;
          const ps = s.pendingSaiKoro;
          if (ev.confirm) {
            if (!ps.finalized) {
              // 向こうは確定済、うちはまだ → 残りを外れ目で埋める
              notes.push('dice roll count differs [ours needed more rolls]');
              for (let g = 0; g < 8 && !S().pendingSaiKoro!.finalized; g++) store.rollSaiKoroDice([3, 4]);
            }
            store.advanceSaiKoro();
          } else if (ev.dice) {
            if (ps.finalized) {
              notes.push('dice roll count differs [ours finalized earlier]');
              break;
            }
            if (!ps.selectedCombo) store.selectSaiKoroCombo(1, 2);
            store.rollSaiKoroDice(ev.dice);
          }
          applied += 1;
          break;
        }
        case 'CONTINUE': {
          const s = S();
          if (s.pendingFeverContinue) {
            autoResolvePendings('before CONTINUE', ei);
            store.continueFever();
            applied += 1;
          }
          break;
        }
      }
    }
    // 局末: 残 pending を既定で解決し、和了を回収
    autoResolvePendings('end of actions', events.length);
    captureWins();
    const s = S();
    if (s.pendingFeverContinue) {
      notes.push('pendingFeverContinue left at end of actions');
    }
    return finish('ok', null);
  } catch (e: any) {
    if (e instanceof ReplayError) return finish('replay_error', e.message);
    return finish('replay_error', `exception: ${e?.message ?? String(e)}`);
  }

  function finishWinLater(ei: number, winner: PlayerId) {
    // 和了直後: 向こうの post-win action [GOLD_NORTH / WINTER / dice] を event loop が処理する。
    // フィーバー継続でなければ局終了扱い。冬/金北の modal 中は lastWinner が未確定なので和了者は event の席で見る
    const s = S();
    const inFever = s.game.feverActive[winner] || feverWinner === winner;
    if (!inFever) roundOver = true;
    void ei;
  }

  function finish(status: DriveResult['status'], reason: string | null): DriveResult {
    try {
      captureWins();
    } catch { /* ignore */ }
    const s = S();
    const effects = [...(s.game.chipEffects ?? [])];
    const dice = effects.filter((e: any) => e.kind === 'dice')
      .map((e: any) => ({ label: e.label, base: e.base, multiplier: e.multiplier, total: e.perPayer, winner: e.winner }));
    return {
      status,
      reason,
      rejectedIndex,
      wins,
      notes,
      eventsApplied: applied,
      pingju: !!s.pendingPingju,
      diceBreakdown: dice,
      chipEffects: effects,
    };
  }
}

/** うちの手牌 [ツモ込み] を物理 key の多重集合 [key → 枚数] にする */
export function ourHandMultiset(sp: any): Map<string, number> {
  const out = new Map<string, number>();
  const add = (k: string, n: number) => { if (n > 0) out.set(k, (out.get(k) ?? 0) + n); };
  const bp = sp?._bingpai ?? {};
  const ex = bp.__anmika ?? {};
  for (const suit of ['m', 'p', 's'] as const) {
    const arr: number[] = bp[suit] ?? [];
    for (let n = 1; n <= 9; n++) {
      let c = arr[n] ?? 0;
      if (n === 5) {
        const gold = suit === 'p' ? (ex.gp ?? 0) : suit === 's' ? (ex.gs ?? 0) : 0;
        const red = (arr[0] ?? 0) - gold;
        add(`g${suit}`, gold);
        add(`${suit}0`, red);
        c -= (arr[0] ?? 0);
      }
      if (n === 3 && suit !== 'm') {
        const niji = ex[`n${suit}3`] ?? 0;
        add(`n${suit}3`, niji);
        c -= niji;
      }
      add(`${suit}${n}`, c);
    }
  }
  const z: number[] = bp.z ?? [];
  for (let n = 1; n <= 7; n++) {
    let c = z[n] ?? 0;
    if (n === 4) { add('gN', ex.gN ?? 0); c -= ex.gN ?? 0; }
    if (n === 5) {
      for (const k of ['z5b', 'z5r', 'z5g', 'z5y']) { add(k, ex[k] ?? 0); c -= ex[k] ?? 0; }
    }
    if (n === 3) { add('nz3', ex.nz3 ?? 0); c -= ex.nz3 ?? 0; }
    add(`z${n}`, c);
  }
  return out;
}

export function theirHandMultiset(m: SeatModel): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, n] of m.hand) if (n > 0) out.set(k, (out.get(k) ?? 0) + n);
  if (m.drawn) out.set(m.drawn, (out.get(m.drawn) ?? 0) + 1);
  return out;
}

export function multisetDiff(a: Map<string, number>, b: Map<string, number>): string | null {
  const keys = new Set([...a.keys(), ...b.keys()]);
  const parts: string[] = [];
  for (const k of [...keys].sort()) {
    const x = a.get(k) ?? 0;
    const y = b.get(k) ?? 0;
    if (x !== y) parts.push(`${k}:${x}/${y}`);
  }
  return parts.length ? parts.join(' ') : null;
}

/** state 変化検出用の軽量 token [RoomAuthority.canonicalMutationToken の縮小版] */
export function tokenOf(s: StoreState): string {
  const g = s.game;
  const hands = ([0, 1, 2] as PlayerId[]).map((p) => {
    const sp: any = g.shoupai.get(p);
    return `${sp?.toString?.() ?? ''}|${sp?._zimo ?? ''}|${(sp?._fulou ?? []).join(',')}`;
  });
  return JSON.stringify([
    g.state.lunban, g.state.defen, g.events.length, g.shan.paishu, g.chipLedger, [...g.lizhi],
    s.lastZimo, s.lastDapai, s.lastWinner, s.roundEnded, s.awaitingRonDecision, s.awaitingFulou,
    s.ronPassedPlayers, s.ronDeclaredPlayers, s.ponCandidates, s.kanCandidates, s.lizhiPending,
    !!s.pendingFuyu, !!s.pendingKinpei, !!s.pendingKamiPochi, !!s.pendingPochiSwap,
    s.pendingSaiKoro ? [s.pendingSaiKoro.currentIdx, s.pendingSaiKoro.rolls.length, s.pendingSaiKoro.finalized, s.pendingSaiKoro.selectedCombo] : null,
    !!s.pendingFeverContinue, !!s.pendingQianggang, !!s.pendingNukiBei, s.pendingPingju, hands,
  ]);
}

const KINPEI_EFFECT: Record<string, 'haru' | 'natsu' | 'aki' | 'fuyu'> = {
  extra_spring: 'haru',
  double_rank_to_4x: 'natsu',
  extra_autumn: 'aki',
  upper_lower: 'fuyu',
};
const KINPEI_FLOWER: Record<'haru' | 'natsu' | 'aki' | 'fuyu', string> = { haru: 'f1', natsu: 'f2', aki: 'f3', fuyu: 'f4' };

export function pickKinpeiTarget(available: string[], targets: Array<{ flower: string; effect: string }> | null): 'haru' | 'natsu' | 'aki' | 'fuyu' | null {
  if (targets) {
    for (const t of targets) {
      const k = KINPEI_EFFECT[t.effect];
      if (k && available.includes(KINPEI_FLOWER[k])) return k;
    }
  }
  // 向こうに選択記録が無い [強化なし] 時: うちは強制選択なので打点に響かない順 [春 → 冬 → 秋 → 夏] で選ぶ
  for (const k of ['haru', 'fuyu', 'aki', 'natsu'] as const) {
    if (available.includes(KINPEI_FLOWER[k])) return k;
  }
  return null;
}

/** 打牌の物理指定: 金 5 は gold=true、赤 5 は gold=false [無指定だと直前ツモが金なら金を切ってしまう]、ぽっちは色 */
export function discardMeta(tile: string): { gold?: boolean; pochi?: 'blue' | 'red' | 'green' | 'yellow' } | undefined {
  if (tile === 'gp' || tile === 'gs') return { gold: true };
  if (tile === 'p0' || tile === 's0') return { gold: false };
  if (/^z5[brgy]$/.test(tile)) return { pochi: ({ b: 'blue', r: 'red', g: 'green', y: 'yellow' } as const)[tile[2] as 'b' | 'r' | 'g' | 'y'] };
  return undefined;
}

/** ポン候補 [majiang-core mianzi 例 's555+' / 's505+'] から 向こうの手牌 2 枚 [赤/金の有無] に合う物を選ぶ */
export function pickPonMianzi(cands: string[], theirTiles: string[], called: string): string {
  const wantZeros = theirTiles.filter((t) => /^[ps]0$|^g[ps]$/.test(t)).length;
  const calledZero = /^[ps]0$|^g[ps]$/.test(called) ? 1 : 0;
  for (const m of cands) {
    const zeros = (m.match(/0/g) ?? []).length - calledZero;
    if (zeros === wantZeros) return m;
  }
  return cands[0];
}

export function pickKanMianzi(cands: string[], base: string, kakan: boolean): string | null {
  const core = toCorePai(base);
  const suit = core[0];
  const n = core[1] === '0' ? '5' : core[1];
  for (const m of cands) {
    const isKakan = /[+=\-]\d$/.test(m);
    if (isKakan !== kakan) continue;
    if (m[0] !== suit) continue;
    const d = (m[1] === '0' ? '5' : m[1]);
    if (d === n) return m;
  }
  return null;
}

// ---------------------------------------------------------------------------
// comparison
// ---------------------------------------------------------------------------

const YAKU_MAP: Array<[string, RegExp]> = [
  ['double_riichi', /^(ダブリー|両立直|ダブル立直)/],
  ['open_riichi', /^オープン立直(?! 押し出し)/],
  ['riichi', /^立直/],
  ['ippatsu', /^一発/],
  ['tsumo', /^門前清自摸和/],
  ['pinfu', /^平和/],
  ['tanyao', /^断幺九/],
  ['iipeiko', /^一盃口/],
  ['ryanpeiko', /^二盃口/],
  ['sanshoku', /^三色同順/],
  ['sanshoku_douko', /^三色同刻/],
  ['sanrenkou', /^三連刻/],
  ['ittsu', /^一気通貫/],
  ['toitoi', /^対々和/],
  ['sananko', /^三暗刻/],
  ['sankantsu', /^三槓子/],
  ['shosangen', /^小三元/],
  ['honitsu', /^混一色/],
  ['chinitsu', /^清一色/],
  ['chanta', /^(チャンタ|混全帯幺九)/],
  ['junchanta', /^(純チャンタ|純全帯幺九)/],
  ['honroto', /^混老頭/],
  ['american_chiitoitsu', /^アメリカ/],
  ['chiitoitsu', /^七対子/],
  ['rinshan', /^嶺上開花/],
  ['haitei', /^海底摸月/],
  ['houtei', /^河底撈魚/],
  ['chankan', /^槍槓/],
  ['yakuhai', /^(場風|自風|翻牌|役牌|白|發|中)/],
  ['dora', /^ドラ/],
  ['reddora', /^赤ドラ/],
  ['uradora', /^裏ドラ/],
  // うちの「北ドラ [西indicator]」[表示牌が西で抜き北がドラ扱い] は向こうでは dora に数える
  ['dora', /^北ドラ \[/],
  ['kitadora', /^(北ドラ|抜きドラ)/],
  ['mahazan', /^嵌八萬/],
  ['sanshoku', /^789 三色/],
  ['kokushi', /^国士無双/],
  ['suanko', /^四暗刻/],
  ['daisangen', /^大三元/],
  ['tsuiso', /^字一色/],
  ['chinroto', /^清老頭/],
  ['ryuiso', /^緑一色/],
  ['churenpoton', /^九蓮宝燈/],
  ['daisushi', /^大四喜/],
  ['shosushi', /^小四喜/],
  ['sukantsu', /^四槓子/],
  ['tenho', /^天和/],
  ['chiho', /^地和/],
  ['renho', /^人和/],
  ['karasu', /^カラス/],
  ['sanpuu', /^三風/],
  ['daichiirin', /^大車輪/],
  ['mahonitsu', /^萬子混一色/],
  ['rasta_single', /^裸単騎/],
  ['hachirensho', /^八連荘/],
  ['nagashi', /^流し/],
  ['surenkou', /^四連刻/],
];

/** their yaku key → 比較用 category [golddora は うちの ドラ に折り込まれる] */
export function theirYakuCategory(name: string): string {
  // 向こうの golddora [金5 = 1翻] はうちでは 赤ドラ entry に乗る [countRedDora + 補正]
  if (name === 'golddora') return 'reddora';
  if (name === 'mahazan_ron' || name === 'mahazan_tsumo') return 'mahazan';
  if (name === 'suanko_tanki') return 'suanko';
  if (name === 'churenpoton_pure') return 'churenpoton';
  if (name === 'nagashi_mangan') return 'nagashi';
  return name;
}

export function ourYakuCategory(name: string): string | null {
  for (const [k, re] of YAKU_MAP) if (re.test(name)) return k;
  return null;
}

export type YakuSummary = { han: Record<string, number>; yakuman: Record<string, number>; totalHan: number | null; fu: number | null; base: number | null; damanguan: number };

export function summarizeTheirs(r: TheirScoreResult): YakuSummary {
  const han: Record<string, number> = {};
  const yakuman: Record<string, number> = {};
  for (const y of r.yaku) {
    const k = theirYakuCategory(y.name);
    if (y.isYakuman) yakuman[k] = (yakuman[k] ?? 0) + Math.max(1, y.yakumanCount || 1);
    else if (y.han > 0) han[k] = (han[k] ?? 0) + y.han;
  }
  return { han, yakuman, totalHan: r.totalHan, fu: r.fu, base: r.baseScore, damanguan: r.isYakuman ? Math.max(1, r.yakumanCount) : 0 };
}

export function summarizeOurs(result: any): YakuSummary {
  const han: Record<string, number> = {};
  const yakuman: Record<string, number> = {};
  for (const h of result?.hupai ?? []) {
    const name = String(h?.name ?? '');
    const k = ourYakuCategory(name);
    if (!k) continue;
    if (h.fanshu === '*' || h.fanshu === '**') yakuman[k] = (yakuman[k] ?? 0) + (h.fanshu === '**' ? 2 : 1);
    else if (typeof h.fanshu === 'number' && h.fanshu > 0) han[k] = (han[k] ?? 0) + h.fanshu;
  }
  const base = result ? computeSanmaBase(result) : null;
  // 夏 [打点ランクアップ] はうちでは翻数に足し込む形で実装されている。向こうは totalHan に含めず rank だけ上げるので、比較用に除く
  const natsuBoost = (result?.hupai ?? [])
    .filter((h: any) => typeof h?.name === 'string' && /^夏/.test(h.name) && /ランクアップ/.test(h.name) && typeof h.fanshu === 'number')
    .reduce((acc: number, h: any) => acc + h.fanshu, 0);
  return {
    han,
    yakuman,
    totalHan: typeof result?.fanshu === 'number' ? result.fanshu - natsuBoost : null,
    fu: typeof result?.fu === 'number' ? result.fu : null,
    base,
    damanguan: Number(result?.damanguan ?? 0),
  };
}

/** their bonus/basic reason → chip category */
export function theirChipCategory(reason: string): string {
  if (/^北/.test(reason)) return 'kita';
  if (/^裏ドラ/.test(reason)) return 'uradora';
  if (/^金ドラ/.test(reason)) return 'gold5';
  if (/^赤ドラ/.test(reason)) return 'red5';
  if (reason === '一発') return 'ippatsu';
  if (reason === '冬') return 'fuyu';
  if (/^春|^金北→春/.test(reason)) return 'haru';
  if (/^[門面]前(混一色|清一色)|二盃口/.test(reason)) return 'menzen';
  if (/^(三倍満|役満|五倍満|六倍満|数え役満)/.test(reason)) return 'rank';
  if (/超過ハン/.test(reason)) return 'excess_han';
  if (/^秋秋金北/.test(reason)) return 'akiaki_kinpei';
  if (/トビ/.test(reason)) return 'tobi';
  return `other:${reason}`;
}

export function ourChipCategory(label: string): string {
  if (/^抜きドラ/.test(label)) return 'kita';
  if (/^裏ドラ/.test(label)) return 'uradora';
  if (/^金 5/.test(label)) return 'gold5';
  if (/^赤 5/.test(label)) return 'red5';
  if (label === '一発') return 'ippatsu';
  if (/^冬/.test(label)) return 'fuyu';
  if (/^春/.test(label)) return 'haru';
  if (/^ホンイツ等 面前役/.test(label)) return 'menzen';
  if (/13翻超過/.test(label)) return 'excess_han';
  if (/^(3 倍満|役満|5 倍満|6 倍満|本役満)/.test(label)) return 'rank';
  if (/^トビ賞/.test(label)) return 'tobi';
  if (/^虹/.test(label)) return 'niji';
  if (/^面前満貫/.test(label)) return 'mangan29';
  if (/^🎲/.test(label)) return 'dice';
  if (label === '?') return 'akiaki_kinpei';
  return `other:${label}`;
}

export type ChipSummary = Record<string, number>; // category → winner receipt [倍率前]

export function chipSummaryTheirs(r: TheirScoreResult): ChipSummary {
  const out: ChipSummary = {};
  for (const c of [...(r.basicChips ?? []), ...(r.bonusChips ?? [])]) {
    const k = theirChipCategory(c.reason);
    const receipt = c.payment === 'ron_only' ? c.chips : c.chips * 2;
    out[k] = (out[k] ?? 0) + receipt;
  }
  return out;
}

/** うちの祝儀内訳: game.chipEffects [winner 付き確定 effect] から集計する。
 *  result.chipBreakdown は applyHule 時点の写しで、冬の神ぽっち再開やサイコロなど後から乗る分が落ちる */
export function chipSummaryOurs(effects: any[], winner: PlayerId): ChipSummary {
  const out: ChipSummary = {};
  for (const e of effects ?? []) {
    if (e.winner !== winner || e.kind === 'dice') continue;
    const k = ourChipCategory(String(e.label ?? '?'));
    // トビ賞は向こうの scoreResults に出ない [半荘末精算] ので除外
    if (k === 'dice' || k === 'tobi') continue;
    const receipt = e.form === 'oall' ? e.base * 2 : e.base;
    out[k] = (out[k] ?? 0) + receipt;
  }
  return out;
}

export function chipEffectLines(effects: any[], winner: PlayerId): string[] {
  return (effects ?? []).filter((e) => e.winner === winner).map((e) => `${e.label}:${e.base}x${e.multiplier}=${e.perPayer}:${e.form}`);
}

const DICE_MAP: Array<[string, RegExp]> = [
  ['四華四北', /四華四北/],
  ['八華四北', /八華四北/],
  ['八華', /^八華/],
  ['四華', /^四華/],
  ['四北', /^四北/],
  ['間八萬', /嵌八萬/],
  ['ぽっち即ツモ', /白ぽっち即ツモ/],
  ['祝儀0枚ぽっちツモ', /祝儀 0 枚/],
  ['白暗カン', /白暗カン/],
  ['オールスター', /^オールスター/],
  ['三連刻', /^三連刻/],
  ['三色同刻', /^三色同刻/],
  ['でかぽっち', /でかぽっち/],
  ['役満', /本役満アガリ|^(カラス|八連荘|天和|地和|人和|流し役満)/],
];

export function theirDiceCategory(reason: string): string {
  if (/^(四暗刻|大三元|国士|字一色|清老頭|緑一色|九蓮|大四喜|小四喜|四槓子|三風|大車輪|萬子混一色|裸単騎|四連刻|天和|地和|人和|カラス|八連荘|流し)/.test(reason)) return '役満';
  return reason;
}
export function ourDiceCategory(name: string): string {
  for (const [k, re] of DICE_MAP) if (re.test(name)) return k;
  return `other:${name}`;
}

export function diceSummaryTheirs(r: TheirScoreResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of r.diceChances ?? []) {
    const k = `${theirDiceCategory(d.reason)}@${d.baseChips}`;
    out[k] = (out[k] ?? 0) + Math.max(1, d.count);
  }
  return out;
}
export function diceSummaryOurs(result: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of result?.saiKoroChances ?? []) {
    const k = `${ourDiceCategory(String(c.name ?? ''))}@${c.baseChip}`;
    out[k] = (out[k] ?? 0) + Math.max(1, Number(c.count ?? 1));
  }
  return out;
}
