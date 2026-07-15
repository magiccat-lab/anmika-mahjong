
// Svelte store wrapper for Game3
import { writable, get } from 'svelte/store';
import { Game3, buildShoupai, isGoldPai, pochiColorFromPai } from './game3';
import type { PlayerId } from './types';
import { dlog, toCorePai } from './helpers';
import { resolveNukiBeiMeta } from './game3/bei';
import { buildStateFromPaifu } from './store/paifuIo';
import { buildDebugState } from './store/debug';
import { cpuStepImpl, autoAdvanceImpl } from './store/cpuActions';
import { generateTilePool, defaultSanmaRule } from './shan3';
import { declareKanImpl, ponImpl, damingangImpl } from './store/fulouActions';
import { hasGoldKita } from './game3/gold';
import {
  advanceSaiKoroStage,
  appendSaiKoroChances,
  blockingWinPipelineReason,
  clearFeverContinueStage,
  clearFuyuStage,
  clearKinpeiStage,
  clearQianggangStage,
  clearReactionStage,
  continueRonDecisionStage,
  enterFulouStage,
  enterFuyuStage,
  enterKinpeiStage,
  enterQianggangStage,
  enterRonDecisionStage,
  finishRonDecisionStage,
  replaceReactionCandidates,
  replaceSaiKoroChances,
  settleRonResultsInKamichaOrder,
  settleAfterWin,
  sortRonResultsByKamicha,
  type PendingFeverContinue,
  type PendingFuyu,
  type PendingKinpei,
  type PendingQianggang,
  type PendingSaiKoro,
  type ReactionCandidate,
} from './store/winPipeline';

/** 12 種スタンプ ID [テキスト frame で先行、 後追いで画像差替予定]
 *  game state 副作用なし、 純粋 cosmetic [_action_log にも入らない、 reload 復元なし] */
// リョー指示 2026-05-15: 段階的に復活、 現 6 種有効。
// 他は image 残置で 後で復活可能、 STAMP_IDS から外すだけで pallet / popup から消える
export const STAMP_IDS = [
  'shunkashutou', 'kita4', 'konmika', 'shubapotsumo',
  'doko', 'gyakushubatsumo', 'plus', 'saikoro',
] as const;
export type StampId = typeof STAMP_IDS[number];
export const STAMP_LABELS: Record<StampId, string> = {
  shunkashutou: '春夏秋冬揃いました',
  kita4: '4北揃いました',
  konmika: '期待値の皆さ〜ん こんミカ〜！',
  shubapotsumo: 'シュバポツモ',
  doko: 'どっから切っとんねーん',
  gyakushubatsumo: '逆シュバツモ',
  plus: '急にプラ転',
  saikoro: 'サイコロチャンス！',
};
const _STAMP_ID_SET: Set<string> = new Set(STAMP_IDS);
/** スタンプ表示の自動 fade-out [ms] */
export const STAMP_DURATION_MS = 1500;
export const CUTIN_DURATION_MS = 1800;
export type CutinId = 'reach' | 'ron' | 'tsumo' | 'fever';
export type CutinPayload = { id: CutinId; ts: number; seat?: PlayerId };

export interface StoreState {
  game: Game3;
  lastZimo: string | null;
  lastDapai: { player: number; pai: string } | null;
  lastWinner: number | null;     // 直近の和了者 [次局移行用]
  lastHuleResult: any | null;    // 直近の hule 結果 [局結果 panel 表示用]
  awaitingRonDecision: boolean;  // 打牌後、 他家の ロン 判定待ち
  // 2026-05-14 R3 P0 #2 fix: ロン候補で pass 済 player を保持、 deadlock 防止
  ronPassedPlayers: number[];
  // 2026-05-14 R3 follow-up [#29 ダブロン UI]: ron 宣言済 player を保持、
  // 複数人ロンで 各 human 候補に判断 UI を出すため。 全候補 [declared + passed = canRon 集合]
  // を満たすまで finalize しない
  ronDeclaredPlayers: number[];
  ronResults: Array<{ player: number; result: any }>;
  awaitingFulou: boolean;        // 副露 [pon / 大明槓] 判定待ち
  ponCandidates: ReactionCandidate[];
  kanCandidates: ReactionCandidate[]; // 大明槓候補
  roundEnded: boolean;           // 局終了 [次局ボタン表示用]
  message: string | null;        // 状況メッセージ [和了表示等]
  cpu: { 0: boolean; 1: boolean; 2: boolean };  // 各 player が CPU か
  lizhiPending: number | null;   // リーチ宣言済 / 宣言牌待機中
  // R4 P1 #10 fix: ダブロン後の 金北再選択で CPU 他 winner 分の hule 適用が消える bug 対応。
  // pendingKinpei に otherWinners を保持して、 selectKinpei で restoreSnapshot 後に
  // 全 winner [winner + otherWinners] を再 hule + applyHule する
  // R8 P0 #1 fix: 冬modal → 金北 modal 経由で humanOthers [人間ダブロン候補] も保持、
  // selectKinpei finalize で 残 human 候補が居れば awaitingRonDecision 維持
  pendingKinpei: PendingKinpei | null;
  // R7 P0 #3 fix: 冬 modal 経由でも human ダブロン候補を保持、 selectFuyu で 救済可能に
  pendingFuyu: PendingFuyu | null;
  pendingFeverContinue: PendingFeverContinue | null; // フィーバー中 アガリ後の 「続行」 ボタン待ち
  pendingPingju: boolean; // 流局成立、 「次局へ」 で 判定フェーズ [流し役満 / tenpai 罰符] を apply 待ち [リョー指示 2026-05-11]
  // R9 P1 #7 fix: 加槓 後の 槍槓 ron window 中の deferred state、 全員 pass で declareKan 実行
  pendingQianggang: PendingQianggang | null;
  /** サイコロチャンス [出目当て] modal 表示中 [MVP、 アガリ時の saiKoroChances を順に処理]
   *  chances: result.saiKoroChances [push 順]、 currentIdx: 現在処理中 index、
   *  selectedCombo: 宣言した出目 [小さい方 / 大きい方]、 rolls: 4 回ぶんの結果 */
  pendingSaiKoro: PendingSaiKoro | null;
  /** スタンプ popup [seat ごと最新 1 つ、 ts で fade 判定]
   *  game state 副作用なし、 reload で復元しない [_action_log にも入らない] */
  stamps: Record<PlayerId, { id: StampId; ts: number } | null>;
  /** カットイン演出 [全画面 1 枚、 queue で順次再生] */
  cutin: CutinPayload | null;
  cutinQueue: CutinPayload[];
}

function formatFanshu(f: any): string {
  // 役満マーカー [*=13翻、 **=26翻 etc] を翻数表記に変換
  if (typeof f === 'string') {
    if (f === '*') return '13';
    if (f === '**') return '26';
    return f;
  }
  return String(f ?? 0);
}

export function formatHuleResult(result: any): string {
  if (!result) return '';
  const fanshu = result.fanshu ?? 0;
  const fu = result.fu ?? 0;
  const damanguan = result.damanguan ?? 0;
  const defen = result.defen3 ?? result.defen ?? 0;
  const yaku = (result.hupai ?? []).map((h: any) => `${h.name}(${formatFanshu(h.fanshu)})`).join(',');
  if (damanguan) return `役満×${damanguan} ${defen}点 / ${yaku}`;
  return `${fu}符${fanshu}翻 ${defen}点 / ${yaku}`;
}

function mergeRonResults(
  prev: Array<{ player: number; result: any }> = [],
  next: Array<{ player: number; result: any }> = [],
): Array<{ player: number; result: any }> {
  const byPlayer = new Map<number, { player: number; result: any }>();
  for (const r of prev) byPlayer.set(r.player, r);
  for (const r of next) byPlayer.set(r.player, r);
  return Array.from(byPlayer.values());
}

function formatRonResults(results: Array<{ player: number; result: any }>): string {
  return results.map(r => `p${r.player}: ${formatHuleResult(r.result)}`).join(' / ');
}

function winnerByOya(game: Game3, results: Array<{ player: number; result: any }>): number | null {
  if (results.length === 0) return null;
  const oya = game.currentOya;
  return results.find(r => r.player === oya)?.player ?? results[results.length - 1].player;
}

function saveHuleSnapshot(game: Game3): void {
  if (game.snapshotLocked) return;
  game.saveSnapshot();
}

export function enqueueCutinState(s: StoreState, id: CutinId, seat?: PlayerId): StoreState {
  const payload: CutinPayload = { id, ts: Date.now() + Math.random(), seat };
  s.cutinQueue = [...(s.cutinQueue ?? []), payload];
  // 2026-05-16 fix: 旧 codex 2 周目で 「enqueue だけで cutin が表示されない」 状態だった
  // [App.svelte に playNextCutin 呼出 wire なし]、 enqueue 時に cutin 空なら即 pop
  if (!s.cutin) {
    const [next, ...rest] = s.cutinQueue;
    s.cutin = next ?? null;
    s.cutinQueue = rest;
  }
  return s;
}

export function createGameStore() {
  const game = new Game3();
  game.qipai();
  const firstPai = game.zimo();
  const initial: StoreState = {
    game,
    lastZimo: firstPai,
    lastDapai: null,
    lastWinner: null,
    lastHuleResult: null,
    awaitingRonDecision: false,
      ronPassedPlayers: [],
      ronDeclaredPlayers: [],
      ronResults: [],
    awaitingFulou: false,
    ponCandidates: [],
    kanCandidates: [],
    roundEnded: false,
    message: null,
    cpu: { 0: false, 1: false, 2: false },
    lizhiPending: null,
    pendingKinpei: null,
    pendingFuyu: null,
    pendingFeverContinue: null,
    pendingPingju: false,
      pendingQianggang: null,
    pendingSaiKoro: null,
    stamps: { 0: null, 1: null, 2: null },
    cutin: null,
    cutinQueue: [],
  };
  // 2026-05-14 fix: store 自体を named ref で持つ。 旧コードの `get(store)` は
  // game = Game3 instance を svelte get に渡して TypeError [e.subscribe is not a function]
  // を投げてた、 Round 2 gate コード全体が dead branch だった
  const store = writable(initial);
  const { subscribe, set, update } = store;

  // ---- オンライン対戦 [リョー指示 2026-05-13、 relay モード WS、 single UI そのまま] ----
  let onlineWs: WebSocket | null = null;
  let onlineMode = false;
  let isApplyingRemote = false;
  // 2026-05-14 codex review P0 fix: 自席 / host gate 用、 initOnlineGame で set される
  let myOnlineSeat: 0 | 1 | 2 | null = null;
  let iAmHost = false;
  // 2026-05-14 R3 P0 #1: applyOnlineRemoteAction で cpuRelay 検証用、 host seat を保持
  let hostSeat: 0 | 1 | 2 | null = null;
  let onlineRevision = 0;
  let onlineMatchId = 1;
  let onlineRoundId = 1;
  let commandSequence = 0;
  /** send 前 gate: online で 自席が action 主体 [現手番 or 候補] かを check、 不正は false で send 抑止 */
  function checkOnlineGate(action: any, requiredSeat: 'currentPlayer' | 'me' | 'winner' | 'host' | 'lastWinner' | 'oya'): boolean {
    if (!onlineMode) return true; // single mode は通す
    if (isApplyingRemote) return true; // remote 適用中は中継、 check しない
    if (myOnlineSeat === null) {
      dlog('[gate-skip] myOnlineSeat null', { action: action?.type });
      return true; // 不明なら 中継許容、 receive 側 で 弾く
    }
    const s = get(store) as StoreState;
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    switch (requiredSeat) {
      case 'currentPlayer':
        if (myOnlineSeat !== cur) { dlog('[gate-block]', { reason: 'not currentPlayer', action: action?.type, my: myOnlineSeat, cur }); return false; }
        return true;
      case 'me':
        return true; // 常に自分の発信、 個別 case で個別 check
      case 'winner':
      case 'lastWinner': {
        const w = s.lastWinner;
        if (w === null || myOnlineSeat !== w) { dlog('[gate-block]', { reason: 'not winner', action: action?.type, my: myOnlineSeat, w }); return false; }
        return true;
      }
      case 'host':
        if (!iAmHost) { dlog('[gate-block]', { reason: 'not host', action: action?.type, my: myOnlineSeat }); return false; }
        return true;
      case 'oya': {
        // 2026-05-14 Round 2 codex fix P1: state.qijia 固定 → currentOya (qijia - jushu) で現親
        const oya = s.game.currentOya;
        if (myOnlineSeat !== oya) { dlog('[gate-block]', { reason: 'not oya', action: action?.type, my: myOnlineSeat, oya }); return false; }
        return true;
      }
    }
  }
  function sendOnlineAction(action: any): boolean {
    if (!onlineMode || isApplyingRemote) return false;
    // 接続断中に local reducer へ fall through すると、再接続前に盤面が分岐する。
    // onlineMode 中は socket が閉じていても操作を消費し、sync 復元を待つ。
    if (!onlineWs || onlineWs.readyState !== WebSocket.OPEN) return true;
    try {
      const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${(++commandSequence).toString(36)}`;
      onlineWs.send(JSON.stringify({
        type: 'action',
        commandId: `cli:${myOnlineSeat ?? 'x'}:${randomPart}`,
        expectedVersion: onlineRevision,
        matchId: onlineMatchId,
        roundId: onlineRoundId,
        action,
      }));
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    subscribe,
    /** オンライン対戦 接続 & game init: preShuffledPool 受信時に呼ぶ */
    initOnlineGame(opts: { ws: WebSocket; preShuffledPool: string[]; qijia: 0|1|2; cpuSeats?: number[]; mySeat?: 0|1|2; isHost?: boolean; hostSeat?: 0|1|2; revision?: number; matchId?: number; roundId?: number }) {
      onlineWs = opts.ws;
      onlineMode = true;
      myOnlineSeat = opts.mySeat ?? null;
      iAmHost = opts.isHost ?? false;
      hostSeat = opts.hostSeat ?? null;
      onlineRevision = opts.revision ?? 0;
      onlineMatchId = opts.matchId ?? 1;
      onlineRoundId = opts.roundId ?? 1;
      if (typeof window !== 'undefined') (window as any).__anmikaOnline = true;
      const ng = new Game3({ qijia: opts.qijia, preShuffledPool: opts.preShuffledPool });
      ng.qipai();
      const fp = ng.zimo();
      // CPU member は ロン / ポン / カン 等を自動判断させる、 そうしないと CPU 番で awaitFulou 待機して loop
      // [リョー指摘 2026-05-13: 「CPU の 2s ロン止まる」 = CPU が human 扱いで wait してた]
      const cpuFlags: Record<0|1|2, boolean> = { 0: false, 1: false, 2: false };
      for (const s of opts.cpuSeats ?? []) {
        if (s === 0 || s === 1 || s === 2) cpuFlags[s] = true;
      }
      set({
        game: ng,
        lastZimo: fp,
        lastDapai: null,
        lastWinner: null,
        lastHuleResult: null,
        awaitingRonDecision: false,
      ronPassedPlayers: [],
      ronDeclaredPlayers: [],
      ronResults: [],
        awaitingFulou: false,
        ponCandidates: [],
        kanCandidates: [],
        roundEnded: false,
        message: 'online start',
        cpu: cpuFlags,
        lizhiPending: null,
        pendingKinpei: null,
        pendingFuyu: null,
        pendingFeverContinue: null,
        pendingPingju: false,
      pendingQianggang: null,
        pendingSaiKoro: null,
        stamps: { 0: null, 1: null, 2: null },
        cutin: null,
        cutinQueue: [],
      });
    },
    setOnlineProtocolState(opts: { ws?: WebSocket; revision: number; matchId: number; roundId: number }) {
      if (opts.ws) onlineWs = opts.ws;
      onlineRevision = opts.revision;
      onlineMatchId = opts.matchId;
      onlineRoundId = opts.roundId;
    },
    getOnlineProtocolState() {
      return { revision: onlineRevision, matchId: onlineMatchId, roundId: onlineRoundId };
    },
    /** Server-side canonical replay can update CPU ownership without rebuilding the game. */
    setCpuSeats(cpuSeats: number[]) {
      const next: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false };
      for (const seat of cpuSeats) {
        if (seat === 0 || seat === 1 || seat === 2) next[seat] = true;
      }
      update((state) => ({ ...state, cpu: next }));
    },
    /** オンライン: 自分以外の seat の action [server から relay 受信] を local apply
     *  2026-05-14 codex review #1 fix: from_seat と action.player / 現在手番 / 候補者 の
     *  整合 check を追加、 不正 seat からの proxy action [他人の宣言/打牌 横取り] を reject */
    applyOnlineRemoteAction(from_seat: number, action: any) {
      // スタンプ [cosmetic、 game state 副作用なし]: 全 validation skip、
      // from_seat の stamps slot に set + STAMP_DURATION_MS 後に null に戻す
      if (action?.type === 'stamp') {
        const sid = action.stampId;
        if (typeof sid !== 'string' || !_STAMP_ID_SET.has(sid)) return;
        if (from_seat !== 0 && from_seat !== 1 && from_seat !== 2) return;
        const seat = from_seat as PlayerId;
        const ts = Date.now();
        update((st) => { st.stamps = { ...st.stamps, [seat]: { id: sid as StampId, ts } }; return st; });
        setTimeout(() => {
          update((st) => {
            const cur = st.stamps[seat];
            if (cur && cur.ts === ts) { st.stamps = { ...st.stamps, [seat]: null }; }
            return st;
          });
        }, STAMP_DURATION_MS);
        return;
      }
      // sender 検証 helper
      const s = get(store) as StoreState;
      const currentPlayer = s.game.lunbanToPlayerId(s.game.state.lunban);
      const isPonCand = (p: number) => (s.ponCandidates ?? []).some((c: any) => c.player === p);
      const isKanCand = (p: number) => (s.kanCandidates ?? []).some((c: any) => c.player === p);
      const winner = s.lastWinner;
      // 2026-05-14 Round 2 codex fix P1: 現親判定 [子アガリ後 親流れ 反映]
      const oya = s.game.currentOya;
      void oya; // 既存 callsite は s.game.currentOya 直参照に変更、 ここは 参照のみ
      const reject = (reason: string) => {
        dlog('[remote-reject]', { from_seat, type: action?.type, reason });
        return;
      };
      isApplyingRemote = true;
      try {
        switch (action.type) {
          // 現手番 action: discard / lizhi / tsumo / declareKan / nukiBei / tsumokiri は
          // sender が現在手番でない 限り reject
          // 2026-05-14 Round 2 codex fix P0 #2: cpuRelay=true なら host から CPU 代理、 from_seat 検証緩和
          case 'discard':
          case 'lizhi':
          case 'tsumo':
          case 'declareKan':
          case 'nukiBei':
          case 'tsumokiri':
          case 'drawNext': {
            // 2026-05-14 R3 P0 #1 fix: cpuRelay は host から の CPU 代理 限定。
            // (1) cpuSeat と currentPlayer 整合、 (2) cpuSeat が CPU member [s.cpu]、
            // (3) from_seat が host seat [hostSeat] の 3 条件全部 満たすこと。
            // server 側 でも cpuRelay は host のみ pass する gate を持つが、 client も二重防御
            if (action.cpuRelay === true && action.cpuSeat !== undefined) {
              const cpuSeatOk = action.cpuSeat === currentPlayer
                && s.cpu[action.cpuSeat as 0 | 1 | 2] === true
                && (hostSeat === null || from_seat === hostSeat);
              if (!cpuSeatOk) return reject(`${action.type}: cpuRelay invalid [cpuSeat=${action.cpuSeat} cur=${currentPlayer} from=${from_seat} hostSeat=${hostSeat}]`);
              break;
            }
            if (from_seat !== currentPlayer) return reject(`${action.type}: from_seat ${from_seat} ≠ currentPlayer ${currentPlayer}`);
            break;
          }
          // ron は ronCandidates に from_seat が含まれている事、 action.player と一致 必須
          case 'ron': {
            const targetP = action.player ?? from_seat;
            if (from_seat !== targetP) return reject(`ron: from_seat ${from_seat} ≠ action.player ${targetP}`);
            // ron 候補の妥当性は ron() 内で再 check されるが、 ここでは明確な proxy を弾く
            break;
          }
          // pon / damingang は action.player === from_seat、 副露候補に from_seat 含まれる事
          // R4 P0 #7 fix: action.mianzi が候補配列内 mianzi と一致する事も必須化、
          // 不正 mianzi で declarePon false → 状態破綻を防ぐ
          case 'pon': {
            const targetP = action.player ?? from_seat;
            if (from_seat !== targetP) return reject(`pon: from_seat ${from_seat} ≠ action.player ${targetP}`);
            if (!isPonCand(targetP)) return reject(`pon: ${targetP} not in ponCandidates`);
            const ponMianzi = s.ponCandidates.filter((c: any) => c.player === targetP).flatMap((c: any) => c.mianzi);
            if (action.mianzi !== undefined && !ponMianzi.includes(action.mianzi)) {
              return reject(`pon: mianzi ${action.mianzi} not in candidates ${JSON.stringify(ponMianzi)}`);
            }
            break;
          }
          case 'damingang': {
            const targetP = action.player ?? from_seat;
            if (from_seat !== targetP) return reject(`damingang: from_seat ${from_seat} ≠ action.player ${targetP}`);
            if (!isKanCand(targetP)) return reject(`damingang: ${targetP} not in kanCandidates`);
            const kanMianzi = s.kanCandidates.filter((c: any) => c.player === targetP).flatMap((c: any) => c.mianzi);
            if (action.mianzi !== undefined && !kanMianzi.includes(action.mianzi)) {
              return reject(`damingang: mianzi ${action.mianzi} not in candidates ${JSON.stringify(kanMianzi)}`);
            }
            break;
          }
          // pass は awaitingRonDecision / awaitingFulou 中、 候補に from_seat 含まれる事
          // R6 P2 #9 fix: action.player と from_seat の一致を必須化、 候補者 A が player: B
          // を送って B の候補を落とす攻撃を防ぐ
          case 'pass': {
            const inRon = s.awaitingRonDecision;
            const inFulou = s.awaitingFulou;
            if (!inRon && !inFulou) return reject('pass: not awaiting');
            const targetP = action.player ?? from_seat;
            if (from_seat !== targetP) return reject(`pass: from_seat ${from_seat} ≠ action.player ${targetP}`);
            const ronCand = s.lastDapai
              ? ([0, 1, 2] as const).filter((p) => p !== s.lastDapai!.player && s.game.canRon(p as any, s.lastDapai!.pai, s.lastDapai!.player as any))
              : [];
            const passOk = ronCand.includes(from_seat as 0|1|2) || isPonCand(from_seat) || isKanCand(from_seat);
            if (!passOk) return reject(`pass: ${from_seat} not in any candidate list`);
            break;
          }
          // winner 限定 action: selectFuyu / selectKinpei / continueFever / agariyame
          case 'selectFuyu':
          case 'selectKinpei':
          case 'continueFever':
          case 'agariyame': {
            // R6 P2 #11 fix: continueFever は pendingFeverContinue.winner で gate
            const expected = action.type === 'selectFuyu' ? s.pendingFuyu?.winner
              : action.type === 'selectKinpei' ? s.pendingKinpei?.winner
              : action.type === 'continueFever' ? s.pendingFeverContinue?.winner
              : winner;
            if (expected === undefined || expected === null) return reject(`${action.type}: no expected winner`);
            if (from_seat !== expected) return reject(`${action.type}: from_seat ${from_seat} ≠ winner ${expected}`);
            // agariyame は親アガリ前提、 現親限定 [Round 2 codex fix P1: state.qijia → currentOya]
            if (action.type === 'agariyame' && from_seat !== s.game.currentOya) return reject(`agariyame: ${from_seat} ≠ currentOya ${s.game.currentOya}`);
            break;
          }
          // host 限定 action: nextRound、 sai 関連 [winner と host 重複 case 多い]
          case 'nextRound': {
            // Server authority accepts the winner or the host. Every client
            // must replay the same host-issued command even when a human guest
            // won; rejecting it here split the room at the next round.
            if (winner !== null) {
              if (from_seat !== winner && (hostSeat === null || from_seat !== hostSeat)) {
                return reject(`nextRound: ${from_seat} is neither winner ${winner} nor host ${hostSeat}`);
              }
            } else {
              if (hostSeat !== null && from_seat !== hostSeat) return reject(`nextRound: 流局 nextRound は host [seat ${hostSeat}] のみ、 from=${from_seat}`);
            }
            break;
          }
          case 'selectSaiKoroCombo':
          case 'rollSaiKoroDice':
          case 'advanceSaiKoro': {
            // R5 P1 #2 fix: current chance の owner を gate 基準にする、 ダブロン queue で
            // 2 人目 winner の操作権が 1 人目 winner に固定されてた bug 解消
            const ps = s.pendingSaiKoro;
            if (!ps) return reject(`${action.type}: no saiKoro winner`);
            const curChance = ps.chances[ps.currentIdx];
            const saiWinner = ((curChance as any)?.winner ?? ps.winner);
            if (saiWinner === undefined || saiWinner === null) return reject(`${action.type}: no chance owner`);
            if (from_seat !== saiWinner) return reject(`${action.type}: from_seat ${from_seat} ≠ chanceOwner ${saiWinner}`);
            // 2026-05-14 Round 2 codex fix P0 #3: rollSaiKoroDice 出目 範囲検証 [1-6 integer]、
            // winner が任意 override 改ざんできないよう sanitize
            // R3 P1 #9 fix: remote rollSaiKoroDice は override 必須、 未指定だと 各 client
            // ローカル Math.random で出目決定 = desync。 override なし remote は reject
            if (action.type === 'rollSaiKoroDice') {
              if (!Array.isArray(action.override) || action.override.length !== 2) {
                return reject(`rollSaiKoroDice: override 必須 [remote action]`);
              }
              const [d1, d2] = action.override;
              const valid = (n: any) => Number.isInteger(n) && n >= 1 && n <= 6;
              if (!valid(d1) || !valid(d2)) return reject(`rollSaiKoroDice: invalid override ${JSON.stringify(action.override)}`);
            }
            break;
          }
        }
        switch (action.type) {
          case 'discard': (this as any).discard(action.pai, action.meta); break;
          case 'lizhi': (this as any).lizhi(action.opts ?? {}); break;
          case 'tsumo': (this as any).tsumo(); break;
          case 'ron': (this as any).ron(action.player ?? from_seat); break;
          case 'pass': (this as any).pass(action.player ?? from_seat); break;
          case 'declareKan': (this as any).declareKan(action.mianzi); break;
          case 'nukiBei': (this as any).nukiBei(action.meta); break;
          case 'tsumokiri': (this as any).tsumokiri(); break;
          case 'drawNext': (this as any).drawNext(); break;  // R4 P1 #18
          case 'selectFuyu': (this as any).selectFuyu(action.use); break;
          case 'selectKinpei': (this as any).selectKinpei(action.target); break;
          case 'continueFever': (this as any).continueFever(); break;
          case 'nextRound': (this as any).nextRound(action.preShuffledPool); break;
          case 'nextMatch': (this as any).nextMatch({ finalize: action.finalize, resetChip: action.resetChip, preShuffledPool: action.preShuffledPool, qijia: action.qijia, cpuSeats: action.cpuSeats }); break;
          case 'selectSaiKoroCombo': (this as any).selectSaiKoroCombo(action.small, action.large); break;
          case 'rollSaiKoroDice': (this as any).rollSaiKoroDice(action.override); break;
          case 'advanceSaiKoro': (this as any).advanceSaiKoro(); break;
          case 'agariyame': (this as any).agariyame(); break;
          case 'pon': (this as any).pon(action.player, action.mianzi); break;
          case 'damingang': (this as any).damingang(action.player, action.mianzi); break;
        }
      } finally {
        isApplyingRemote = false;
      }
    },
    /** オンライン mode 解除
     *  2026-05-14 Round 2 codex fix P2 #10: __anmikaOnline / __anmikaIsHost を clear、
     *  旧: window flag が残り 単独回しで fever 強制ツモ切り / autoLizhi が skip される副作用。
     *  __game / __gameStore は App.svelte 側の $:reactive が onlineGameStarted で 自動 re-publish するため触らない */
    disconnectOnline() {
      onlineMode = false;
      onlineWs = null;
      isApplyingRemote = false;
      myOnlineSeat = null;
      iAmHost = false;
      hostSeat = null;
      onlineRevision = 0;
      onlineMatchId = 1;
      onlineRoundId = 1;
      if (typeof window !== 'undefined') {
        (window as any).__anmikaOnline = false;
        (window as any).__anmikaIsHost = false;
      }
    },
    /** オンライン flag 確認 */
    isOnline(): boolean { return onlineMode; },
    enqueueCutin(id: CutinId, seat?: PlayerId) {
      update((st) => enqueueCutinState(st, id, seat));
    },
    playNextCutin() {
      update((st) => {
        if (st.cutin || (st.cutinQueue ?? []).length === 0) return st;
        const [next, ...rest] = st.cutinQueue;
        st.cutin = next ?? null;
        st.cutinQueue = rest;
        return { ...st };
      });
    },
    finishCutin(ts: number) {
      update((st) => {
        if (st.cutin?.ts === ts) st.cutin = null;
        return { ...st };
      });
    },
    /** スタンプ送信 [cosmetic]: local state を即更新 + online なら ws send。
     *  オフライン [単体プレイ] でも 自分の操作で 表示はする [WS は send しない、 local popup のみ]。
     *  seat 偽装防止のため server 側で from_seat を上書きする。 */
    sendStamp(seat: PlayerId, stampId: StampId) {
      if (!_STAMP_ID_SET.has(stampId)) return;
      const ts = Date.now();
      update((st) => { st.stamps = { ...st.stamps, [seat]: { id: stampId, ts } }; return st; });
      setTimeout(() => {
        update((st) => {
          const cur = st.stamps[seat];
          if (cur && cur.ts === ts) { st.stamps = { ...st.stamps, [seat]: null }; }
          return st;
        });
      }, STAMP_DURATION_MS);
      // online は server に送る [server で from_seat 上書き]、 offline は local 表示のみ
      if (onlineMode && onlineWs && onlineWs.readyState === WebSocket.OPEN) {
        try { onlineWs.send(JSON.stringify({ type: 'action', action: { type: 'stamp', stampId } })); } catch (_) { /* noop */ }
      }
    },
    /** 打牌 → ロン / ポン候補判定 [CPU 自動応答込み]、 meta で河の色記録 */
    discard(pai: string, meta?: { gold?: boolean; pochi?: 'blue' | 'red' | 'green' | 'yellow' }) {
      if (!checkOnlineGate({ type: 'discard' }, 'currentPlayer')) return;
      if (sendOnlineAction({ type: 'discard', pai, meta })) return;
      update((s) => {
        // リーチ pending 中なら 宣言牌候補チェック + リーチ確定
        if (s.lizhiPending !== null) {
          const player = s.game.lunbanToPlayerId(s.game.state.lunban);
          if (player !== s.lizhiPending) {
            s.message = `リーチ pending 中: player ${s.lizhiPending} の打牌待ち`;
            return { ...s };
          }
          const cands = s.game.getLizhiCandidates(player);
          const norm = (p: string) => p.replace(/_$/, '');
          if (!cands.some((c) => norm(c) === pai)) {
            s.message = `${pai} はリーチ宣言牌じゃない、 赤枠の牌から選んで`;
            return { ...s };
          }
          // [2026-05-16 bug 8 wiring] フィーバー宣言時、 dapai 別 fever 可否を check。
          //   feverCandidatesByDapai は fever OK な dapai のみ Map に含む。
          //   選択 pai が fever 不可なら 「9s 切れば fever、 他は通常リーチ」 仕様に従い fever を落として通常リーチに自動降格。
          let isFeverDecl = !!(s as any)._lizhiFever;
          let feverCheckForDeclare: { ok: boolean; tiles: string[]; tier: 1 | 2 | 3 } | undefined;
          if (isFeverDecl) {
            const feverMap = s.game.feverCandidatesByDapai(player);
            feverCheckForDeclare = feverMap.get(pai);
            if (!feverCheckForDeclare) {
              isFeverDecl = false;
              (s as any)._lizhiFever = false;
              const lpf = (s as any).lizhiPendingFlags;
              if (lpf) (s as any).lizhiPendingFlags = { ...lpf, fever: false };
              s.message = `${pai} は フィーバー成立条件 [7 暗刻] を満たさない、 通常リーチで宣言`;
            }
          }
          // リーチ確定 [defen -1000、 供託 +1、 lizhi.add]
          if (!s.game.declareLizhi({ open: !!(s as any)._lizhiOpen, shuvari: !!(s as any)._lizhiShuvari, fever: isFeverDecl, feverCheck: feverCheckForDeclare, feverDapai: isFeverDecl ? pai : undefined })) {
            s.message = 'リーチ確定失敗';
            s.lizhiPending = null;
            return { ...s };
          }
          s.lizhiPending = null;
          (s as any)._lizhiOpen = false;
          (s as any)._lizhiShuvari = false;
          (s as any)._lizhiFever = false;
          s = enqueueCutinState(s, isFeverDecl ? 'fever' : 'reach', player as PlayerId);
          // フィーバー宣言時、 待ち牌全消失で 1 人テンパイ流局 [ルール 5-2、 P0-1 後半]
          //   spec: 宣言通っても待ちがその段階でなかったら fever 成立 + 1 人テンパイ流局 [2026-05-11]
          if (isFeverDecl && s.game.isFeverWaitExhausted(player)) {
            // 2026-05-14 codex review P2 fix: 流局 path で applyPingjuTransition を経由、
            // 罰符 / 流し役満 / defen 移動 を きちんと apply してから pendingPingju
            s = applyPingjuTransition(s, `🔥 フィーバー立直成立、 待ち牌全消失で 1 人テンパイ流局 [「次局へ」 で確定]`);
            return { ...s };
          }
        }
        return innerDiscard(s, pai, meta);
      });
    },
    /** ロン宣言 */
    ron(player: number) {
      // 2026-05-14 codex review P0: 自席限定、 player === myOnlineSeat
      if (onlineMode && !isApplyingRemote && myOnlineSeat !== null && myOnlineSeat !== player) {
        dlog('[gate-block]', { type: 'ron', my: myOnlineSeat, player });
        return;
      }
      if (sendOnlineAction({ type: 'ron', player })) return;
      update((s) => {
        // R3 follow-up #29: ダブロン UI 対応で lastWinner null guard を緩和。
        // awaitingRonDecision 中 [humans 判断待ち] の 別 player ron を accept、
        // 同 player 重複は ronDeclaredPlayers で弾く
        // R7 P0 #2 fix: 局面妥当性 [awaitingRonDecision + canRon] 必須、
        // 不正 client が pending を作る攻撃を防ぐ
        if (s.roundEnded) return { ...s };
        if ((s.ronDeclaredPlayers ?? []).includes(player)) return { ...s };
        // R14 P0 #4 fix: ronPassedPlayers chk 漏れ。 ダブロン候補中に一度 pass した
        // player が、 他人の判断待ち中に後からロン宣言できる bug。 ronPassedPlayers に
        // 既出なら無効。 UI ronCandidates 側の表示除外は別途 [App.svelte:5961]
        if ((s.ronPassedPlayers ?? []).includes(player)) {
          dlog('[ron] reject: 既 pass 済 player');
          return { ...s };
        }
        if (s.lastWinner !== null && !s.awaitingRonDecision) return { ...s };
        if (!s.lastDapai) return { ...s };
        if (!s.awaitingRonDecision) return { ...s };
        // R12 P2 #10 fix + R13 P0 #3 緩和: pending modal 中の ron 割り込み 拒否、 但し
        // ダブロン awaitingRonDecision 中は除外。 1 人目 ron で立った modal は finalize 時に
        // 適用されるべきで、 2 人目 ron 判断段階では block しちゃダメ
        if (!s.awaitingRonDecision && (s.pendingKinpei || s.pendingFuyu || s.pendingFeverContinue || s.pendingSaiKoro)) {
          dlog('[ron] reject: pending modal 中');
          return { ...s };
        }
        if (!s.game.canRon(player as any, s.lastDapai.pai, s.lastDapai.player as any)) return { ...s };
        // P0-1: 宣言牌 ron → フィーバー不正立 [リョー指示 2026-05-11]
        //   宣言牌の discarder が feverDeclareDapaiPlayer なら、 fever を undo してから ron 処理
        //   [lizhi 自体は通常通り成立、 ron も通常進行、 fever 倍率のみ消える]
        const fdp = s.game.feverDeclareDapaiPlayer;
        if (fdp !== null && fdp === s.lastDapai.player) {
          s.game.feverActive[fdp] = false;
          s.game.feverTier[fdp] = 1;
          s.game.feverDeclareDapaiPlayer = null;
          dlog('[fever undone] 宣言牌 ron、 player=', fdp);
        }
        // フィーバー中 + 冬持ち + 自家 → 冬使う / 保留 modal
        if (s.game.feverActive[player as 0|1|2] && s.game.effectiveHuapaiAtHule(player as PlayerId).includes('f4') && !s.cpu[player as 0|1|2]) {
          // [2026-05-15 機能 11] 待ち残山 0 → modal skip で 自動冬使用 [user 選択不要]
          if (s.game.isFeverWaitExhausted(player as 0|1|2)) {
            s.game.fuyuConsumed[player as 0|1|2] = true;
            s.game.feverActive[player as 0|1|2] = false;
            // fall through で 通常 ron path に
          } else {
            // 2026-05-14 codex review P1 fix: pendingFuyu 化前に saveSnapshot
            saveHuleSnapshot(s.game);
            // R7 P0 #3 fix: 冬 modal 経由でも human ダブロン候補 を保持して selectFuyu で 救済
            const _ld = s.lastDapai;
            const humanOthers = ([0,1,2] as const).filter(p =>
              p !== player && p !== _ld.player && !s.cpu[p as 0|1|2]
              && !(s.ronDeclaredPlayers ?? []).includes(p)
              && s.game.canRon(p as any, _ld.pai, _ld.player as any)
            );
            enterFuyuStage(s, {
              winner: player,
              isRon: true,
              ronfrom: s.lastDapai.player,
              availableHuapai: s.game.effectiveHuapaiAtHule(player as PlayerId),
              humanOthers,
            });
            s.ronDeclaredPlayers = [...(s.ronDeclaredPlayers ?? []), player];
            s.message = `❄️ フィーバー中、 冬を使う？ [使う = アリス発動 + フィーバー終了 / 保留 = 継続]`;
            return { ...s };
          }
        }
        // フィーバー + 払い状態 [pochiPaymentMode] では 金北 強化先 modal をスキップ、 自動確定
        // [リョー仕様 2026-05-12: 赤/黄ツモ後 青/緑ツモまでの間は player 任意選択ナシ]
        const isFeverPayAuto_ron =
          s.game.feverActive[player as 0|1|2] && s.game.pochiPaymentMode[player as 0|1|2];
        // snapshot 保存 [後で金北変更時に巻き戻し]
        saveHuleSnapshot(s.game);
        // ダブロン対応
        // R6 P0 #2 fix: ronDeclaredPlayers も除外、 P2 ロン後 P1 [既宣言済] が humanOthers に
        // 再投入されて 「P1 判断待ち」 で詰む bug 解消
        const otherCands = ([0,1,2] as const).filter(p => p !== player && p !== s.lastDapai!.player && !(s.ronDeclaredPlayers ?? []).includes(p) && s.game.canRon(p as any, s.lastDapai!.pai, s.lastDapai!.player as any));
        let result = s.game.hule(player as any, s.lastDapai.pai, s.lastDapai.player as any);
        dlog('[ron] player=', player, 'pai=', s.lastDapai.pai, 'fromPlayer=', s.lastDapai.player, 'result=', result, 'lizhi=', s.game.lizhi.has(player as any), 'fever=', s.game.feverActive[player as 0|1|2], 'feverWinCount=', s.game.feverWinCount[player as 0|1|2]);
        if (!result) {
          s.message = `player ${player} はロンできない [役なし or majiang-core 拒否]`;
          return { ...s };
        }
        // 秋効果で新たに冬が表示された場合も、和了時に抜いた扱いとして冬選択へ戻す。
        if (s.game.feverActive[player as 0|1|2]
          && !s.game.fuyuConsumed[player as 0|1|2]
          && s.game.effectiveHuapaiAtHule(player as PlayerId).includes('f4')
          && !s.cpu[player as 0|1|2]) {
          const ld = s.lastDapai!;
          const humanOthers = ([0,1,2] as const).filter(p =>
            p !== player && p !== ld.player && !s.cpu[p as 0|1|2]
            && !(s.ronDeclaredPlayers ?? []).includes(p)
            && s.game.canRon(p as any, ld.pai, ld.player as any)
          );
          const availableHuapai = s.game.effectiveHuapaiAtHule(player as PlayerId);
          s.game.restoreSnapshot();
          enterFuyuStage(s, { winner: player, isRon: true, ronfrom: ld.player, availableHuapai, humanOthers });
          s.ronDeclaredPlayers = [...(s.ronDeclaredPlayers ?? []), player];
          s.message = `❄️ 秋ドラ表示で冬、冬を使う？ [使う = アリス発動 + フィーバー終了 / 保留 = 継続]`;
          return { ...s };
        }
        // CPU / フィーバー払い中の自動選択も、秋で新たに表示された華を候補に含めて再計算する。
        if ((s.cpu[player as 0|1|2] || isFeverPayAuto_ron)
          && hasGoldKita(s.game, player as PlayerId)
          && s.game.kinpeiTarget[player as 0|1|2] === null) {
          const availableHuapai = s.game.effectiveHuapaiAtHule(player as PlayerId);
          if (availableHuapai.length > 0) {
            s.game.restoreSnapshot();
            s.game.autoResolveKinpei(player as any, availableHuapai);
            if (isFeverPayAuto_ron && s.game.kinpeiTarget[player as 0|1|2] === 'fuyu') {
              s.game.fuyuConsumed[player as 0|1|2] = true;
            }
            result = s.game.hule(player as any, s.lastDapai.pai, s.lastDapai.player as any);
            if (!result) {
              s.message = `player ${player} 金北自動選択後のロン再計算失敗`;
              return { ...s };
            }
          }
        }
        if (otherCands.length > 0) s.game.snapshotLocked = true;
        result._anmikaRonSettlementDeferred = true;
        // R3 P1 #5 fix: 人間 他候補 への 自動ロン強制 を廃止、 CPU 候補のみ auto-ron。
        // human 候補は ron / pass の判断機会を持つべき。 ron 後も awaitingRonDecision を継続させ、
        // 他人間候補の ron / pass を待つ [ronPassedPlayers に既 pass 済が居る場合は除外]
        const ronResults: Array<{ player: number; result: any }> = [{ player, result }];
        const ld = s.lastDapai!;
        const humanOthers: number[] = [];
        for (const p of otherCands) {
          if (s.cpu[p as 0|1|2]) {
            // CPU auto-ron [従来通り、 CPU は即決]
            if (hasGoldKita(s.game, p as PlayerId)) s.game.autoResolveKinpei(p as any);
            const r2 = s.game.hule(p as any, ld.pai, ld.player as any);
            if (r2) {
              r2._anmikaRonSettlementDeferred = true;
              ronResults.push({ player: p, result: r2 });
            }
          } else {
            // human 他候補: 既に pass 済 なら 除外、 そうでなければ 判断 pending 扱い
            if (!(s.ronPassedPlayers ?? []).includes(p)) {
              humanOthers.push(p);
            }
          }
        }
        let allRonResults = sortRonResultsByKamicha(
          ld.player as PlayerId,
          mergeRonResults(s.ronResults, ronResults),
        );
        s.ronResults = allRonResults;
        const isFever = s.game.feverActive[player as 0|1|2];
        const feverNote = isFever ? '🔥 [フィーバー継続中、 次局へ進まず待ち継続]' : '';
        // R13 P0 #4 fix: lastWinner を ronDeclaredPlayers 全体 + 今回 ronResults から
        // 親優先 再計算。 旧 code は今回 ronResults だけ見て、 ダブロン 2 人目 ron で
        // 既宣言 1 人目 [親含む可能性] が忘れられて 連荘情報 失う bug
        {
          const allDeclared = Array.from(new Set([
            ...(s.ronDeclaredPlayers ?? []),
            ...ronResults.map(r => r.player),
          ]));
          if (allDeclared.length > 1) {
            s.message = `🎉🎉 ダブロン! ${formatRonResults(allRonResults)} ${feverNote}`;
            s.lastWinner = winnerByOya(s.game, allRonResults) ?? allDeclared[allDeclared.length - 1];
          } else {
            s.message = `🎉 player ${player} ロン和了！ ${formatHuleResult(result)} ${feverNote}`;
            s.lastWinner = player;
          }
        }
        s.lastHuleResult = allRonResults[allRonResults.length - 1].result;
        // R3 follow-up #29: ron 宣言済 players を tracking、 humanOthers が残ってる場合は
        // awaitingRonDecision 継続 + finalize スキップ、 第 2 human の ron / pass を待つ。
        // 第 2 human が ron すれば再入で applyHule、 pass すれば pass() 経由で finalize
        s.ronDeclaredPlayers = [...(s.ronDeclaredPlayers ?? []), ...ronResults.map(r => r.player)];
        if (humanOthers.length > 0) {
          // R9 P1 #8 fix: humanOthers 残り時も pendingKinpei を 作って winner の金北選択権を保持。
          // 全 human が pass / ron した後 finalize 時に 既存 pendingKinpei を踏襲する
          if (hasGoldKita(s.game, player as PlayerId) && !s.cpu[player as 0|1|2] && !isFeverPayAuto_ron && !s.pendingKinpei) {
            const otherWinners = allRonResults.filter(r => r.player !== player).map(r => r.player);
            enterKinpeiStage(s, {
              winner: player,
              isRon: true,
              ronfrom: s.lastDapai!.player,
              availableHuapai: s.game.effectiveHuapaiAtHule(player as PlayerId),
              otherWinners,
              humanOthers,
              cutinQueued: false,
            });
          }
          continueRonDecisionStage(s);
          s.message += ` [他 human 候補 p${humanOthers.join('/')} 判断待ち]`;
          return { ...s };
        }
        allRonResults = settleRonResultsInKamichaOrder(s.game, ld.player as PlayerId, allRonResults);
        s.ronResults = allRonResults;
        s.lastHuleResult = allRonResults[allRonResults.length - 1].result;
        if (allRonResults.length > 1) {
          s.message = `🎉🎉 ダブロン! ${formatRonResults(allRonResults)} ${feverNote}`;
        } else {
          s.message = `🎉 player ${player} ロン和了！ ${formatHuleResult(result)} ${feverNote}`;
        }
        for (const rr of allRonResults) {
          if (rr.result?._anmikaRonEffectsQueued) continue;
          s = enqueueCutinState(s, 'ron', rr.player as PlayerId);
          s = triggerSaiKoroIfAny(s, rr.result, rr.player);
          rr.result._anmikaRonEffectsQueued = true;
        }
        s.game.snapshotLocked = false;
        finishRonDecisionStage(s);
        // R9 P1 #7: 槍槓 ron 成立時は pendingQianggang clear、 後段の declareKanImpl は走らない
        if (s.pendingQianggang) {
          clearQianggangStage(s);
        }
        // 金北持ち + 自家 → アガリ計算後 modal で変更可能 [リョー指示]
        // ただし フィーバー + 払い [reverse pochi] state なら 自動確定で modal スキップ
        // R7 P1 #6 fix: 金北手牌内 [goldHand.z > 0] も modal 対象、 nukidoraGold だけだと
        // 抜く前の金北で強化選択漏れ
        if (hasGoldKita(s.game, player as PlayerId) && !s.cpu[player as 0|1|2] && !isFeverPayAuto_ron) {
          // R4 P1 #10 fix: ダブロン CPU 他 winner を otherWinners に持って、 selectKinpei で 再適用する
          const otherWinners = allRonResults.filter(r => r.player !== player).map(r => r.player);
          enterKinpeiStage(s, {
            winner: player,
            isRon: true,
            ronfrom: s.lastDapai!.player,
            availableHuapai: s.game.effectiveHuapaiAtHule(player as PlayerId),
            otherWinners,
            cutinQueued: true,
          });
          s.message += ` [🎁 金北変更可能、 modal で選択]`;
        } else if (isFeverPayAuto_ron && s.game.kinpeiTarget[player as 0|1|2] === 'fuyu') {
          // 冬冬 / 冬 が選択された → 直ちに冬実行 + 局終了 [リョー仕様 2026-05-12]
          s.game.fuyuConsumed[player as 0|1|2] = true;
          s.roundEnded = true;
          s.message += ` [❄️ 冬自動実行、 局終了]`;
        }
        settleAfterWin(s, { winner: player as PlayerId, isRon: true });
        return { ...s };
      });
    },
    /** フィーバー中 冬使う / 保留 選択 */
    selectFuyu(use: boolean) {
      // gate: pendingFuyu.winner 限定
      if (onlineMode && !isApplyingRemote && myOnlineSeat !== null) {
        const s = get(store) as StoreState;
        if (s.pendingFuyu && myOnlineSeat !== s.pendingFuyu.winner) { dlog('[gate-block]', { type: 'selectFuyu', my: myOnlineSeat, w: s.pendingFuyu.winner }); return; }
      }
      if (sendOnlineAction({ type: 'selectFuyu', use })) return;
      update((s) => {
        if (!s.pendingFuyu) return { ...s };
        // R8 P0 #1 fix: pendingFuyu = null 前に humanOthers も const 退避、
        // 旧 code は null 後に s.pendingFuyu?.humanOthers を読んでて 必ず [] になってた = R7 #3 dead
        const {
          winner,
          isRon,
          ronfrom,
          otherWinners: fuyuOtherWinners = [],
          humanOthers: fuyuHumanOthers = [],
          cutinQueued: fuyuCutinQueued = false,
        } = s.pendingFuyu;
        s.game.fuyuConsumed[winner as 0|1|2] = use; // 使う = true、 保留 = false
        clearFuyuStage(s);
        // 続行: まず未強化で和了を試算し、秋で表示された華まで金北候補に含める。
        let result: any;
        if (isRon && ronfrom !== null) {
          result = s.game.hule(winner as any, s.lastDapai!.pai, ronfrom as any);
        } else {
          result = s.game.hule(winner as any);
        }
        if (!result) {
          s.message = `player ${winner} アガリ失敗 [役なし]`;
          return { ...s };
        }
        const resolvedHuapai = s.game.effectiveHuapaiAtHule(winner as PlayerId);
        if (hasGoldKita(s.game, winner as PlayerId)
          && s.game.kinpeiTarget[winner as 0|1|2] === null
          && resolvedHuapai.length > 0
          && !s.cpu[winner as 0|1|2]) {
          // R6 P1 #4 fix: 冬 modal 経由でも otherWinners [ダブロン CPU 他候補] を保存する。
          let otherWinners: number[] = [...fuyuOtherWinners];
          if (otherWinners.length === 0 && isRon && ronfrom !== null && s.lastDapai) {
            const ld = s.lastDapai;
            otherWinners = ([0,1,2] as const).filter(p =>
              p !== winner && p !== ld.player && s.cpu[p as 0|1|2] && s.game.canRon(p as any, ld.pai, ld.player as any)
            );
          }
          enterKinpeiStage(s, {
            winner,
            isRon,
            ronfrom,
            availableHuapai: resolvedHuapai,
            otherWinners,
            humanOthers: fuyuHumanOthers,
            cutinQueued: fuyuCutinQueued,
            fuyuDecisionMade: true,
          });
          s.message = `🎁 金北 強化対象を選択してください [保留も可]`;
          return { ...s };
        }
        if (s.cpu[winner as 0|1|2]
          && hasGoldKita(s.game, winner as PlayerId)
          && s.game.kinpeiTarget[winner as 0|1|2] === null
          && resolvedHuapai.length > 0) {
          s.game.restoreSnapshot();
          s.game.autoResolveKinpei(winner as any, resolvedHuapai);
          result = isRon && ronfrom !== null
            ? s.game.hule(winner as any, s.lastDapai!.pai, ronfrom as any)
            : s.game.hule(winner as any);
          if (!result) {
            s.message = `player ${winner} 金北自動選択後の再計算失敗`;
            return { ...s };
          }
        }
        s.game.applyHule(result, winner as any, isRon ? (ronfrom as any) : null);
        // R3 P1 #7 fix: ロン経路 [isRon] で 他ダブロン候補 [他 CPU 限定 自動 ron] を計算 + apply、
        // 冬 modal pass 中に失われた候補を救済。 human 他候補は P1 #5 同様 log のみ
        const ronResults: Array<{ player: number; result: any }> = [{ player: winner, result }];
        if (isRon && ronfrom !== null && s.lastDapai) {
          const ld = s.lastDapai;
          const otherCands = ([0,1,2] as const).filter(p => p !== winner && p !== ld.player && s.game.canRon(p as any, ld.pai, ld.player as any));
          for (const p of otherCands) {
            if (s.cpu[p as 0|1|2]) {
              if (hasGoldKita(s.game, p as PlayerId)) s.game.autoResolveKinpei(p as any);
              const r2 = s.game.hule(p as any, ld.pai, ld.player as any);
              if (r2) {
                s.game.applyHule(r2, p as any, ld.player as any);
                ronResults.push({ player: p, result: r2 });
              }
            } else {
              dlog('[selectFuyu ron] human 他候補 機会喪失 [冬 modal 経由 ダブロン]', { winner, p });
            }
          }
        }
        // R7 P0 #3 fix: pendingFuyu.humanOthers - ronPassedPlayers / ronDeclared でまだ残ってる
        // human 候補が居る場合は awaitingRonDecision 維持、 finalize 据え置き
        // R8 P0 #1: 退避済 fuyuHumanOthers を使う [pendingFuyu は null 化済]
        const fuyuHumans = fuyuHumanOthers.filter(p =>
          !(s.ronPassedPlayers ?? []).includes(p) && !(s.ronDeclaredPlayers ?? []).includes(p)
        );
        s.ronDeclaredPlayers = [...(s.ronDeclaredPlayers ?? []), ...ronResults.map(r => r.player).filter(p => !(s.ronDeclaredPlayers ?? []).includes(p))];
        const isFever = s.game.feverActive[winner as 0|1|2];
        const feverNote = isFever ? '🔥 [フィーバー継続中]' : '';
        s.ronResults = isRon ? mergeRonResults(s.ronResults, ronResults) : [];
        s.message = s.ronResults.length > 1
          ? `🎉🎉 ダブロン! ${formatRonResults(s.ronResults)} ${feverNote}`
          : `🎉 player ${winner} ${isRon ? 'ロン' : 'ツモ'}和了！ ${formatHuleResult(result)} ${feverNote}`;
        s.lastHuleResult = (s.ronResults.length > 0 ? s.ronResults[s.ronResults.length - 1].result : ronResults[ronResults.length - 1].result);
        s.lastWinner = s.ronResults.length > 1 ? winnerByOya(s.game, s.ronResults) : winner;
        if (fuyuHumans.length > 0) {
          continueRonDecisionStage(s);
          s.message += ` [他 human 候補 p${fuyuHumans.join('/')} 判断待ち]`;
          return { ...s };
        }
        finishRonDecisionStage(s);
        // 2026-05-14 codex review P1 fix: 冬選択経由のアガリでもサイコロチャンス trigger を check
        // R3 P1 #8: 全 winner ぶん triggerSaiKoroIfAny を 順に呼ぶ [後述 queue 化に依存]
        if (fuyuCutinQueued && s.pendingSaiKoro) {
          const winners = new Set(ronResults.map(r => r.player));
          replaceSaiKoroChances(s, s.pendingSaiKoro.chances.filter((c: any) => !winners.has(c.winner)));
        }
        for (const rr of ronResults) {
          if (!fuyuCutinQueued) s = enqueueCutinState(s, isRon ? 'ron' : 'tsumo', rr.player as PlayerId);
          s = triggerSaiKoroIfAny(s, rr.result, rr.player);
        }
        settleAfterWin(s, { winner: winner as PlayerId, isRon });
        return { ...s };
      });
    },
    /** 金北 modal で強化対象選択 [target=null は保留] */
    selectKinpei(target: 'haru' | 'natsu' | 'aki' | 'fuyu' | null) {
      // gate: pendingKinpei.winner 限定
      if (onlineMode && !isApplyingRemote && myOnlineSeat !== null) {
        const s = get(store) as StoreState;
        if (s.pendingKinpei && myOnlineSeat !== s.pendingKinpei.winner) { dlog('[gate-block]', { type: 'selectKinpei', my: myOnlineSeat, w: s.pendingKinpei.winner }); return; }
      }
      if (sendOnlineAction({ type: 'selectKinpei', target })) return;
      update((s) => {
        if (!s.pendingKinpei) return { ...s };
        // R5 P1 #1 fix: null 化前に otherWinners も退避、 旧 code は s.pendingKinpei = null 後に
        // s.pendingKinpei?.otherWinners を読んでて 必ず [] になってた = R4 #10 fix が dead
        // R8 P0 #1 fix: humanOthers も const 退避 [pendingKinpei = null 後に読まない]
        const {
          winner,
          isRon,
          ronfrom,
          availableHuapai = s.game.effectiveHuapaiAtHule(s.pendingKinpei.winner as PlayerId),
          otherWinners = [],
          humanOthers: kinpeiHumanOthers = [],
          cutinQueued = false,
          fuyuDecisionMade = false,
        } = s.pendingKinpei;
        // 2026-05-14 Round 2 codex fix P1 #8: kinpeiTarget 直代入 ではなく Game3.setKinpeiChoice
        // 経由で validation [金北保持 + 対象華保持 check]、 不正 target は reject
        s.game.restoreSnapshot();
        // bug E4 fix 2026-05-15: snapshot は kinpeiTarget を保存しないので restoreSnapshot 後も
        // 旧 target が 残ったまま。 setKinpeiChoice は 既選択時 reject なので、 modal 再選択前に
        // 必ず clear して 新 target を 受け付ける状態に戻す。
        // [これしないと 旧 target で hule 再計算 → 夏夏金北 ×4 が想定外重ね適用 / 過小適用 の bug]
        s.game.clearKinpeiChoice(winner as any);
        if (target !== null) {
          const ok = s.game.setKinpeiChoice(winner as any, target, availableHuapai);
          if (!ok) {
            s.message = `player ${winner} 金北 ${target} 選択不可 [対象華 / 金北 保持なし]`;
            // pendingKinpei は維持、 再選択させる
            return { ...s };
          }
        } else {
          // R7 P2 #9 fix: target=null [保留] は フィーバー中のみ許可
          // 2026-05-14 fix [user 報告]: 華牌なし [強化対象なし] でも null 許可、
          // 金北しか抜いてない時に modal 止まる bug 解消
          const huapaiList = availableHuapai;
          const hasAnyHua = huapaiList.some((p: string) => p === 'f1' || p === 'f2' || p === 'f3' || p === 'f4');
          if (!s.game.feverActive[winner as 0|1|2] && hasAnyHua) {
            s.message = `player ${winner} 金北 保留は フィーバー中限定`;
            return { ...s };
          }
          s.game.kinpeiTarget[winner as 0|1|2] = null;
        }
        clearKinpeiStage(s);
        // 再 hule
        let result: any;
        if (isRon && ronfrom !== null) {
          result = s.game.hule(winner as any, s.lastDapai!.pai, ronfrom as any);
        } else {
          result = s.game.hule(winner as any);
        }
        if (!result) {
          s.message = `player ${winner} 再計算失敗`;
          return { ...s };
        }
        // 秋金北の追加表示で初めて冬が出た場合も、冬選択を挟んで同じ和了を再計算する。
        if (!fuyuDecisionMade
          && s.game.feverActive[winner as 0|1|2]
          && !s.game.fuyuConsumed[winner as 0|1|2]
          && s.game.effectiveHuapaiAtHule(winner as PlayerId).includes('f4')) {
          const availableAfterKinpei = s.game.effectiveHuapaiAtHule(winner as PlayerId);
          const selectedTarget = s.game.kinpeiTarget[winner as 0|1|2];
          s.game.restoreSnapshot();
          s.game.kinpeiTarget[winner as 0|1|2] = selectedTarget;
          enterFuyuStage(s, {
            winner,
            isRon,
            ronfrom,
            availableHuapai: availableAfterKinpei,
            otherWinners,
            humanOthers: kinpeiHumanOthers,
            cutinQueued,
          });
          s.message = `❄️ 秋金北のドラ表示で冬、冬を使う？ [使う = アリス発動 + フィーバー終了 / 保留 = 継続]`;
          return { ...s };
        }
        if (otherWinners.length > 0) s.game.snapshotLocked = true;
        s.game.applyHule(result, winner as any, isRon ? (ronfrom as any) : null);
        // R4 P1 #10 fix: otherWinners [ダブロン CPU 他 winner] を 再 hule + applyHule。
        // snapshot 復元で消えた CPU ダブロンの点数・チップ・サイコロ chance を回復
        const allResults: Array<{ player: number; result: any }> = [{ player: winner, result }];
        for (const ow of otherWinners) {
          if (hasGoldKita(s.game, ow as PlayerId)) s.game.autoResolveKinpei(ow as any);
          const r2 = isRon && ronfrom !== null
            ? s.game.hule(ow as any, s.lastDapai!.pai, ronfrom as any)
            : s.game.hule(ow as any);
          if (r2) {
            s.game.applyHule(r2, ow as any, isRon ? (ronfrom as any) : null);
            allResults.push({ player: ow, result: r2 });
          }
        }
        const isFever = s.game.feverActive[winner as 0|1|2];
        const feverNote = isFever ? '🔥 [フィーバー継続中]' : '';
        const targetLabel = target ? ` [金北→${target}]` : ' [金北→保留]';
        s.message = allResults.length > 1
          ? `🎉🎉 ダブロン! ${allResults.map(r => `p${r.player}: ${formatHuleResult(r.result)}`).join(' / ')} ${feverNote}${targetLabel}`
          : `🎉 player ${winner} ${isRon ? 'ロン' : 'ツモ'}和了！ ${formatHuleResult(result)} ${feverNote}${targetLabel}`;
        s.ronResults = isRon ? allResults : [];
        s.lastHuleResult = allResults[allResults.length - 1].result;
        // R5 P1 #3 fix: lastWinner を oya 優先に [ron path と揃え、 親アガリ含むダブロン後の連荘継続]
        {
          const oya = s.game.currentOya;
          const oyaWon = allResults.find(r => r.player === oya);
          s.lastWinner = oyaWon ? oyaWon.player : allResults[allResults.length - 1].player;
        }
        // 2026-05-14 codex review P1 fix: 金北選択経由のアガリでもサイコロチャンス trigger
        // R4 P1 #10: 全 winner の chances を trigger [queue 化]
        // R13 P0 #3 緩和: ron/pass の pending modal reject を awaitingRonDecision 中除外したので
        // inline trigger で OK
        // bug E3 fix 2026-05-15: 初回 hule で 既に pendingSaiKoro が trigger 済の場合、
        // selectKinpei の 再 hule で triggerSaiKoroIfAny が append → サイコロ chance が 2 倍 に
        // 重複する bug。 selectKinpei は authoritative な再計算なので、 既存 pendingSaiKoro [この
        // hule winners 分] を clear してから 再 trigger する。 finalized 済 chance は保持
        if (s.pendingSaiKoro) {
          const winners = new Set(allResults.map(r => r.player));
          const remaining = s.pendingSaiKoro.chances.filter((c: any) => !winners.has(c.winner));
          replaceSaiKoroChances(s, remaining);
        }
        for (const rr of allResults) {
          if (!cutinQueued) s = enqueueCutinState(s, isRon ? 'ron' : 'tsumo', rr.player as PlayerId);
          s = triggerSaiKoroIfAny(s, rr.result, rr.player);
        }
        // R8 P0 #1 fix: 冬 modal 経由で持ち越した humanOthers が残ってる場合 awaitingRonDecision 維持
        s.ronDeclaredPlayers = [...(s.ronDeclaredPlayers ?? []), ...allResults.map(r => r.player).filter(p => !(s.ronDeclaredPlayers ?? []).includes(p))];
        const kinpeiRemainingHumans = kinpeiHumanOthers.filter(p =>
          !(s.ronPassedPlayers ?? []).includes(p) && !(s.ronDeclaredPlayers ?? []).includes(p)
        );
        if (kinpeiRemainingHumans.length > 0) {
          continueRonDecisionStage(s);
          s.message += ` [他 human 候補 p${kinpeiRemainingHumans.join('/')} 判断待ち]`;
          return { ...s };
        }
        s.game.snapshotLocked = false;
        finishRonDecisionStage(s);
        // fever 継続: 次家へ advance、 selectKinpei が ron/tsumo を兼ねるので両 path 対応
        settleAfterWin(s, { winner: winner as PlayerId, isRon });
        return { ...s };
      });
    },
    /** フィーバー中 アガリ後 「続行」 button 押下 → 次家ツモへ */
    /** サイコロチャンス [出目当て] - 出目宣言 [small/large 順序なし]、 MVP */
    selectSaiKoroCombo(small: number, large: number) {
      // gate: pendingSaiKoro.winner 限定
      if (onlineMode && !isApplyingRemote && myOnlineSeat !== null) {
        const s = get(store) as StoreState;
        // R5 P1 #2: current chance owner で gate
        if (s.pendingSaiKoro) {
          const cur = s.pendingSaiKoro.chances[s.pendingSaiKoro.currentIdx];
          const owner = ((cur as any)?.winner ?? s.pendingSaiKoro.winner);
          if (myOnlineSeat !== owner) { dlog('[gate-block]', { type: 'selectSaiKoroCombo', my: myOnlineSeat, w: owner }); return; }
        }
      }
      if (sendOnlineAction({ type: 'selectSaiKoroCombo', small, large })) return;
      update((s) => {
        if (!s.pendingSaiKoro) return { ...s };
        // ゾロ目宣言は無効 [small === large]、 1-6 範囲外も拒否
        if (small === large || small < 1 || small > 6 || large < 1 || large > 6) return { ...s };
        const a = Math.min(small, large);
        const b = Math.max(small, large);
        s.pendingSaiKoro.selectedCombo = [a, b];
        s.message = `🎲 出目宣言 [${a}, ${b}] 受付、 「サイコロを振る」 button を押してくれ`;
        return { ...s };
      });
    },
    /** サイコロを振る 1 回、 4 回 [ゾロ目除く] 揃ったら finalize。
     *  override で 外部 [dice-box 物理 simulator] から 出目を受け取る場合あり */
    rollSaiKoroDice(override?: [number, number]) {
      // online: pendingSaiKoro.winner [= 上がり者] のみ振る、 出目確定して broadcast、 他 client は relay 受信で同期
      // 2026-05-14 codex review P0 fix: 任意 client が振れる bug を winner 限定に
      if (onlineMode && !isApplyingRemote) {
        if (myOnlineSeat !== null) {
          const s = get(store) as StoreState;
          // R5 P1 #2: current chance owner で gate
          if (s.pendingSaiKoro) {
            const cur = s.pendingSaiKoro.chances[s.pendingSaiKoro.currentIdx];
            const owner = ((cur as any)?.winner ?? s.pendingSaiKoro.winner);
            if (myOnlineSeat !== owner) { dlog('[gate-block]', { type: 'rollSaiKoroDice', my: myOnlineSeat, w: owner }); return; }
          }
        }
        // [Phase B3 audit HIGH] online サイコロは server 側で crypto.randomInt 生成、
        // client が override を作って渡しても server がそのまま上書きする。 ここでは
        // placeholder の override を送るだけ [server 側 validation 経路を変えないため]。
        sendOnlineAction({ type: 'rollSaiKoroDice', override: [1, 1] });
        return;
      }
      update((s) => {
        if (!s.pendingSaiKoro || !s.pendingSaiKoro.selectedCombo) return { ...s };
        const ps = s.pendingSaiKoro;
        if (!ps.selectedCombo) return { ...s };
        // R18 #1 fix: finalized 後の追加 roll を reject。 旧 code は ps.finalized check ナシで
        // 4 投完了後 再 click / 再送 で finalize 処理 が再実行され applyChipOall 二重加算 → 祝儀重複
        if (ps.finalized) {
          dlog('[rollSaiKoroDice] reject: finalized 済 [追加 roll 二重加算 防止]');
          return { ...s };
        }
        const d1 = override ? override[0] : Math.floor(Math.random() * 6) + 1;
        const d2 = override ? override[1] : Math.floor(Math.random() * 6) + 1;
        const zoro = d1 === d2;
        const [a, b] = ps.selectedCombo;
        const dicePair: [number, number] = [Math.min(d1, d2), Math.max(d1, d2)];
        const hit = !zoro && dicePair[0] === a && dicePair[1] === b;
        ps.rolls.push({ dice: dicePair, hit, zoro });
        // R4 P1 #8 fix: current chance の winner で applyChipOall、 ダブロン後勝者 chip 喪失防止
        const curChance = ps.chances[ps.currentIdx];
        const chanceWinner: 0|1|2 = ((curChance as any)?.winner ?? ps.winner) as 0|1|2;
        // シュバサイのゾロ目連続特典: 宣言状態に関係なく、対象サイコロなら常時適用。
        let zoroBonusThisRoll = 0;
        const shuvariSai = curChance?.shuvariApplicable === true;
        if (zoro && shuvariSai) {
          let consec = 1;
          for (let i = ps.rolls.length - 2; i >= 0; i--) {
            if (ps.rolls[i].zoro) consec++;
            else break;
          }
          if (consec >= 2) {
            const n = d1;
            zoroBonusThisRoll = n === 1 ? 111 : n * 11;
            // サイコロチャンス: シュバは倍率に乗らない [リョー指示 2026-05-12 改定]
            // シュバの役割は 「ゾロ目連続判定の発動」 のみ、 chip 倍率は ぽっち + フィーバー だけ
            const chanceMode = (curChance as any)?.mode ?? 'tsumo';
            s.game.applyChipOall(chanceWinner, zoroBonusThisRoll, {
              bypassShuvari: true,
              bypassPochi: chanceMode === 'ron',
              bypassFever: false,
              label: `🎲 シュバゾロ連続特典 [${n},${n}] ×${consec}`,
              mode: chanceMode,
            });
            // 累積 zoroBonus [倍率込み actual chip] を summary 表示用に store
            // applyChipOall 直後の chipBreakdown 末尾 entry が今回 push 分
            const lastEntry = s.game.chipBreakdown[s.game.chipBreakdown.length - 1];
            const actualThisRoll = lastEntry?.total ?? zoroBonusThisRoll;
            (ps as any)._zoroBonusAcc = ((ps as any)._zoroBonusAcc ?? 0) + actualThisRoll;
            s.message = `🎲 シュバゾロ目連続特典 [${n},${n}] × ${consec}: chip ${zoroBonusThisRoll} オール`;
          }
        }
        // ゾロ目はリプレイ扱い [回数外]、 ゾロ目以外の振り数で 4 回到達したら finalize
        const nonZoroCount = ps.rolls.filter((r) => !r.zoro).length;
        if (nonZoroCount >= 4) {
          // chip 計算 + 適用、 finalized=true で表示維持 [user の「次へ」 click 待ち]
          const chance = ps.chances[ps.currentIdx];
          const hits = ps.rolls.filter((r) => r.hit).length;
          const baseChip = chance.baseChip;
          const chipN = baseChip * hits * chance.count;
          if (hits > 0 && chipN > 0) {
            // ぽっち倍率はツモ由来だけに適用。ロン由来サイコロでは明示 bypass。
            // シュバは サイコロ chip 倍率に乗らない [リョー指示 2026-05-12]
            s.game.applyChipOall(chanceWinner, chipN, {
              bypassShuvari: true,
              bypassPochi: (chance as any).mode === 'ron',
              bypassFever: false,
              label: `🎲 サイコロ ${chance.name} [${hits} hit × ${baseChip}]`,
              mode: (chance as any).mode ?? 'tsumo',
            });
            s.message = `🎲 サイコロチャンス ${chance.name}: ${hits} hit、 chip ${chipN} オール`;
          } else if (zoroBonusThisRoll === 0) {
            s.message = `🎲 サイコロチャンス ${chance.name}: 0 hit、 chip ナシ`;
          }
          // zoro bonus 累積 [全 rolls の中の ボーナス合計、 後で UI に出す用]
          // 概算: rolls の zoro 数 - 1 で連続中なら積算 (実装簡略、 summary に hits / chipN のみ)
          ps.finalized = true;
          // _zoroBonusAcc に rollSaiKoroDice 内で applyChipOall した累積値が入ってる
          const zoroAcc = ((ps as any)._zoroBonusAcc ?? 0);
          // chipN は表示用に倍率込み [modal の chipMultiplier と一致させる]
          const chanceFin = ps.chances[ps.currentIdx];
          // R5 P1 #6 fix: 実 ledger は常に bypassShuvari: true で適用してるので summary 倍率も揃える、
          // shuvariApplicable に依らず シュバ非適用固定 [仕様: サイコロ chip はシュバに乗らない]
          const chanceMode = (chanceFin as any).mode ?? 'tsumo';
          const mulFin = s.game.computeChipMultiplier(chanceWinner, {
            bypassShuvari: true,
            bypassPochi: chanceMode === 'ron',
            mode: chanceMode,
          });
          ps.summary = { hits, chipN: chipN * mulFin, zoroBonusTotal: zoroAcc };
        }
        return { ...s };
      });
    },
    /** サイコロチャンス 結果確認後の「次へ」 [次 chance 移行 or 全終了で close] */
    advanceSaiKoro() {
      // gate: pendingSaiKoro.winner 限定
      if (onlineMode && !isApplyingRemote && myOnlineSeat !== null) {
        const s = get(store) as StoreState;
        // R5 P1 #2: current chance owner で gate
        if (s.pendingSaiKoro) {
          const cur = s.pendingSaiKoro.chances[s.pendingSaiKoro.currentIdx];
          const owner = ((cur as any)?.winner ?? s.pendingSaiKoro.winner);
          if (myOnlineSeat !== owner) { dlog('[gate-block]', { type: 'advanceSaiKoro', my: myOnlineSeat, w: owner }); return; }
        }
      }
      if (sendOnlineAction({ type: 'advanceSaiKoro' })) return;
      update((s) => {
        if (!s.pendingSaiKoro || !s.pendingSaiKoro.finalized) return { ...s };
        // R6 P2 #10 fix: ad-hoc _zoroBonusAcc を次 chance に持ち越さない。
        advanceSaiKoroStage(s);
        return { ...s };
      });
    },
    continueFever() {
      // R6 P2 #11 fix: lastWinner ではなく pendingFeverContinue.winner で gate
      // R10 P0 #2 fix: pendingSaiKoro 残中は reject、 サイコロ未処理のまま 局面進行を防ぐ
      {
        const s = get(store) as StoreState;
        if (s.pendingSaiKoro !== null) {
          dlog('[continueFever] reject: pendingSaiKoro 存在中');
          return;
        }
      }
      if (onlineMode && !isApplyingRemote && myOnlineSeat !== null) {
        const s = get(store) as StoreState;
        if (s.pendingFeverContinue && myOnlineSeat !== s.pendingFeverContinue.winner) {
          dlog('[gate-block]', { type: 'continueFever', my: myOnlineSeat, w: s.pendingFeverContinue.winner });
          return;
        }
      }
      if (sendOnlineAction({ type: 'continueFever' })) return;
      update((s) => {
        if (!s.pendingFeverContinue) return { ...s };
        const { winner, isRon } = s.pendingFeverContinue;
        clearFeverContinueStage(s);
        if (isRon) {
          // ron 経路: winner は hand 14 [applyHule で ron pai 込み]、 skip して winner+1 へ
          // 反時計周り: 次プレイヤー = winnerPid - 1 [2026-05-13 fix]
          // 2026-05-14 fix [user 報告]: lunban 逆算で qijia 固定じゃなく currentOya 基準に。
          // 親流れ後 currentOya !== qijia な局で 別の席に ツモが渡る = 「親番より下家の捨て牌多い」
          // 「ツモ順 一個ズレ」 bug の原因。 lunbanToPlayerId が currentOya 基準なので 逆も統一
          const winnerPid = winner as 0|1|2;
          const nextPlayer = ((winnerPid - 1) + 3) % 3;
          s.game.state.lunban = (((s.game.currentOya - nextPlayer) % 3 + 3) % 3) as any;
          s.lastZimo = s.game.zimo();
          // [2026-05-21] フィーバー強制ツモ切り [fulou next-player zimo 経路]
          s = applyFeverAutoTsumokiri(s);
        } else if (s.lastZimo) {
          // tsumo 経路: アガリ牌を そのまま打牌 [dapai で lunban advance + 次家 zimo]
          s = innerDiscard(s, s.lastZimo);
        }
        const hasPendingReaction = s.awaitingRonDecision || s.awaitingFulou;
        if (!s.lastZimo) {
          s.roundEnded = true;
          s.message = (s.message ?? '') + ' [山切れで局終了]';
        }
        // アガリ表示を clear して次の操作へ
        s.lastWinner = null;
        s.lastHuleResult = null;
        if (!hasPendingReaction) {
          s.lastDapai = null;
          finishRonDecisionStage(s);
        }
        // フィーバー継続で次 hule の snapshot を fresh に [2026-05-12 リョー指示: 点数移動 が累積になる bug fix]
        saveHuleSnapshot(s.game);
        return { ...s };
      });
    },
    /** ロンしないで進む */
    pass(passingPlayer?: number) {
      // 2026-05-14 codex review #3 fix: pass を player 単位に refactor、
      // 複数候補 [P1+P2 両方ロン候補等] で 片方の見送りが他方を消す問題 fix。
      // online 中は myOnlineSeat 必須、 single 中は passingPlayer 引数なしなら 旧 behavior [全クリア]
      if (!checkOnlineGate({ type: 'pass' }, 'me')) return;
      // R12 P2 #10 fix + R13 P0 #3 緩和: pending modal 中の pass 割り込み拒否、 但し
      // ダブロン awaitingRonDecision 中は除外。 1 人目 ron で立った modal は finalize 時に
      // 適用されるべきで、 2 人目 ron 判断段階では block しちゃダメ
      {
        const s = get(store) as StoreState;
        if (!s.awaitingRonDecision && (s.pendingKinpei || s.pendingFuyu || s.pendingFeverContinue || s.pendingSaiKoro)) {
          dlog('[pass] reject: pending modal 中');
          return;
        }
      }
      // single + 引数なし: 旧互換で 全 候補一括 pass [test 後方互換]
      const isLegacyAll = !onlineMode && passingPlayer === undefined;
      const effectivePlayer = passingPlayer ?? (onlineMode ? myOnlineSeat ?? 0 : 0);
      if (sendOnlineAction({ type: 'pass', player: effectivePlayer })) return;
      if (isLegacyAll) {
        // 旧 behavior: 全 候補 一括 解除
        update((s) => {
          if (s.awaitingRonDecision && s.lastDapai) {
            const shuvariRoner = ([0,1,2] as const).find((p) =>
              p !== s.lastDapai!.player &&
              s.game.shuvariActive[p] &&
              s.game.canRon(p as any, s.lastDapai!.pai, s.lastDapai!.player as any)
            );
            if (shuvariRoner !== undefined) {
              s.message = `p${shuvariRoner} はシュバリ中、 見逃し不可。 ロン宣言してください`;
              return { ...s };
            }
          }
          const wasAwaitingRon = s.awaitingRonDecision;
          // R13 P0 #5 fix: legacy-all pass でも 副露候補 残ありなら awaitingFulou に遷移、
          // ponCandidates / kanCandidates を消さない
          const hasFulouCand = (s.ponCandidates?.length ?? 0) > 0 || (s.kanCandidates?.length ?? 0) > 0;
          if (wasAwaitingRon && hasFulouCand) {
            enterFulouStage(s, { ponCandidates: s.ponCandidates, kanCandidates: s.kanCandidates });
            s.message = `ロン全 pass、 副露可能`;
            return { ...s };
          }
          clearReactionStage(s, { clearRonTracking: false });
          if (wasAwaitingRon && s.message?.startsWith('ロン可能')) s.message = null;
          if (s.message?.startsWith('副露可能')) s.message = null;
          // R11 codex P0 #1 fix: legacy-all pass でも pendingQianggang の finalize を先に処理、
          // 槍槓不成立 [全員 見送り] で 後段 declareKanImpl 実行する
          if (s.pendingQianggang) {
            const pq = clearQianggangStage(s)!;
            s.lastDapai = null;
            s.ronPassedPlayers = [];
            s.ronDeclaredPlayers = [];
            return declareKanImpl(s, pq.mianzi);
          }
          // 2026-05-14 fix [user 報告 + codex 同定]: 候補全 skip 後の zimo は lastDapai.player の
          // 次家 [反時計 = player - 1] を確定。 dapai が事前 lunban+1 してるが ポンスキップで stale
          // 化する case あり、 ここで明示再計算して 「親より下家 捨て牌多い」 ズレ防止
          if (s.lastDapai) {
            const from = s.lastDapai.player;
            const nextPlayer = ((from - 1) + 3) % 3;
            s.game.state.lunban = (((s.game.currentOya - nextPlayer) % 3 + 3) % 3) as any;
          }
          s.lastZimo = s.game.zimo();
          if (!s.lastZimo) {
            s = applyPingjuTransition(s, '🌀 流局:');
          }
          // [2026-05-21] フィーバー強制ツモ切り [副露 reactor 経路]
          s = applyFeverAutoTsumokiri(s);
          return { ...s };
        });
        return;
      }
      update((s) => {
        // シュバリ中の player は ロン candidates にいたら 見逃し不可 [リョー指示 2026-05-11]
        if (s.awaitingRonDecision && s.lastDapai) {
          const shuvariRoner = ([0,1,2] as const).find((p) =>
            p !== s.lastDapai!.player &&
            s.game.shuvariActive[p] &&
            s.game.canRon(p as any, s.lastDapai!.pai, s.lastDapai!.player as any)
          );
          if (shuvariRoner !== undefined && shuvariRoner === effectivePlayer) {
            s.message = `p${shuvariRoner} はシュバリ中、 見逃し不可。 ロン宣言してください`;
            return { ...s };
          }
        }
        // 候補リストから effectivePlayer を除外、 残候補 なくなったら 次の state へ進む
        const newPonCands = (s.ponCandidates ?? []).filter((c: any) => c.player !== effectivePlayer);
        const newKanCands = (s.kanCandidates ?? []).filter((c: any) => c.player !== effectivePlayer);
        replaceReactionCandidates(s, { ponCandidates: newPonCands, kanCandidates: newKanCands });
        // ロン候補は state には store されてないが、 awaitingRonDecision を 全 candidate 見送り time に true→false
        // 簡略: 全 ronCandidates [from canRon] のうち effectivePlayer 除外で 残ありなら 待機継続
        // R3 P0 #2 fix: pass 済 player を ronPassedPlayers に追加、 再計算で復活しない
        if (s.awaitingRonDecision && s.lastDapai) {
          const passed = new Set<number>([...(s.ronPassedPlayers ?? []), effectivePlayer]);
          s.ronPassedPlayers = [...passed];
          // R10 P0 #1 fix: ronDeclaredPlayers も remainingRon から除外、 1 人目ロン後の
          // 2 人目 pass で 1 人目が再復活して deadlock する bug 解消
          const declared = new Set<number>(s.ronDeclaredPlayers ?? []);
          const remainingRon = ([0,1,2] as const).filter(p =>
            p !== s.lastDapai!.player &&
            !passed.has(p) &&
            !declared.has(p) &&
            s.game.canRon(p as any, s.lastDapai!.pai, s.lastDapai!.player as any)
          );
          // R3 P1 #6: 残候補が全 CPU なら 即 auto-ron 実行 [human pass 完了の trigger]
          const cpuRemaining = remainingRon.filter(p => s.cpu[p as 0|1|2]);
          const humanRemaining = remainingRon.filter(p => !s.cpu[p as 0|1|2]);
          if (humanRemaining.length === 0 && cpuRemaining.length > 0) {
            saveHuleSnapshot(s.game);
            if (cpuRemaining.length > 1 || (s.ronResults ?? []).length > 0) s.game.snapshotLocked = true;
            const ronResults: Array<{ player: number; result: any }> = [];
            for (const p of cpuRemaining) {
              // R5 P1 #4 fix: human pass 後 CPU 後発ロン でも 金北 autoResolve、 通常 path と揃える
              if (hasGoldKita(s.game, p as PlayerId)) {
                s.game.autoResolveKinpei(p as any);
              }
              const result = s.game.hule(p as any, s.lastDapai.pai, s.lastDapai.player as any);
              if (result) {
                ronResults.push({ player: p, result });
              }
            }
            if (ronResults.length > 0) {
              const allRonResults = settleRonResultsInKamichaOrder(
                s.game,
                s.lastDapai.player as PlayerId,
                mergeRonResults(s.ronResults, ronResults),
              );
              s.ronResults = allRonResults;
              s.lastWinner = winnerByOya(s.game, allRonResults);
              s.lastHuleResult = allRonResults[allRonResults.length - 1].result;
              s.message = allRonResults.length > 1
                ? `🎉🎉 ダブロン! ${formatRonResults(allRonResults)}`
                : `🎉 CPU ロン: ${ronResults.map(r => `p${r.player}`).join('/')}`;
              finishRonDecisionStage(s);
              // R18 #4 fix: pass 後 CPU ロンで fever 継続抜けてた、 winner が fever 中なら
              // pendingFeverContinue にして 通常 ロンと揃える
              const winnerSeat = s.lastWinner as PlayerId;
              settleAfterWin(s, { winner: winnerSeat, isRon: true });
              s.ronPassedPlayers = [];
              for (const rr of allRonResults) {
                s = enqueueCutinState(s, 'ron', rr.player as PlayerId);
                s = triggerSaiKoroIfAny(s, rr.result, rr.player);
              }
              s.game.snapshotLocked = false;
              return { ...s };
            }
            s.game.snapshotLocked = false;
            // ron 全失敗 [役なし]: 通常進行へ
          }
          if (humanRemaining.length > 0) {
            s.message = `p${effectivePlayer} 見逃し、 残 p${humanRemaining.join('/')} の判断待ち`;
            return { ...s };
          }
        }
        // 副露候補 残あり → 待機継続
        if (s.awaitingFulou && (newPonCands.length > 0 || newKanCands.length > 0)) {
          s.message = `p${effectivePlayer} 見逃し、 残 副露候補待ち`;
          return { ...s };
        }
        // R13 P0 #5 fix: ロン全員 pass 後 副露候補 [ponCandidates/kanCandidates] が残ってる
        // 場合 awaitingFulou に遷移、 鳴き機会を失わない。 旧 code は ron 経路で 直接 zimo に
        // 進んでて 鳴き候補消失 bug
        if (s.awaitingRonDecision && !s.awaitingFulou && (newPonCands.length > 0 || newKanCands.length > 0)) {
          enterFulouStage(s, { ponCandidates: newPonCands, kanCandidates: newKanCands });
          s.message = `ロン全 pass、 副露可能: p${[...newPonCands.map((c:any)=>c.player), ...newKanCands.map((c:any)=>c.player)].join('/')}`;
          return { ...s };
        }
        // 全 候補 消費 → 次の手番へ進む
        const wasAwaitingRon = s.awaitingRonDecision;
        clearReactionStage(s, { clearCandidates: false, clearRonTracking: false });
        // R9 P1 #7 fix: 加槓 槍槓 window で全員 pass なら 後段の declareKanImpl 実行
        if (s.pendingQianggang) {
          const pq = clearQianggangStage(s)!;
          s.lastDapai = null;
          s.ronPassedPlayers = [];
          s.ronDeclaredPlayers = [];
          return declareKanImpl(s, pq.mianzi);
        }
        // R3 follow-up #29: ron 宣言済 player が居る場合は「次の手番へ」へ進まず finalize。
        // WSA-A6: 他候補の pass 待ち中は精算を保留しているため、ここで上家順に確定する。
        if ((s.ronDeclaredPlayers ?? []).length > 0) {
          const hasDeferredSettlement = (s.ronResults ?? []).some((rr) =>
            rr.result?._anmikaRonSettlementDeferred && !rr.result?._anmikaRonSettlementApplied
          );
          if (hasDeferredSettlement && s.lastDapai) {
            s.ronResults = settleRonResultsInKamichaOrder(
              s.game,
              s.lastDapai.player as PlayerId,
              s.ronResults,
            );
            for (const rr of s.ronResults) {
              if (rr.result?._anmikaRonEffectsQueued) continue;
              s = enqueueCutinState(s, 'ron', rr.player as PlayerId);
              s = triggerSaiKoroIfAny(s, rr.result, rr.player);
              rr.result._anmikaRonEffectsQueued = true;
            }
            s.game.snapshotLocked = false;
          }
          if ((s.ronResults ?? []).length > 1) {
            s.message = `🎉🎉 ダブロン! ${formatRonResults(s.ronResults)}`;
            s.lastWinner = winnerByOya(s.game, s.ronResults);
            s.lastHuleResult = s.ronResults[s.ronResults.length - 1].result;
          }
          // fever check: 最後に宣言した winner を基準に
          const lastWinner = s.lastWinner;
          if (lastWinner !== null) {
            settleAfterWin(s, { winner: lastWinner as PlayerId, isRon: true });
          } else {
            s.roundEnded = true;
          }
          s.ronPassedPlayers = [];
          s.ronDeclaredPlayers = [];
          if (s.message?.startsWith('ロン可能') || s.message?.includes('判断待ち')) s.message = null;
          return { ...s };
        }
        s.ronPassedPlayers = [];  // R3 P0 #2: 局面遷移時 reset
        if (wasAwaitingRon && s.message?.startsWith('ロン可能')) s.message = null;
        if (s.message?.startsWith('副露可能')) s.message = null;
        // 2026-05-14 fix [user 報告 + codex 同定]: per-player pass の zimo 直前も lastDapai 基準で
        // lunban 再計算、 ポンスキップ stale lunban で ツモ順 ズレる bug 解消
        if (s.lastDapai) {
          const from = s.lastDapai.player;
          const nextPlayer = ((from - 1) + 3) % 3;
          s.game.state.lunban = (((s.game.currentOya - nextPlayer) % 3 + 3) % 3) as any;
        }
        s.lastDapai = null;
        s.lastZimo = s.game.zimo();
        if (!s.lastZimo) {
          s = applyPingjuTransition(s, '🌀 流局:');
        }
        // [2026-05-21] フィーバー中 非 fever player は強制ツモ切り [ron pass → 次 zimo path]
        s = applyFeverAutoTsumokiri(s);
        return { ...s };
      });
    },
    /** ツモ宣言 */
    tsumo() {
      if (!checkOnlineGate({ type: 'tsumo' }, 'currentPlayer')) return;
      if (sendOnlineAction({ type: 'tsumo' })) return;
      update((s) => {
        if (s.roundEnded || s.lastWinner !== null) return { ...s }; // 連打防止
        const player = s.game.lunbanToPlayerId(s.game.state.lunban);
        // R7 P0 #2 fix: canTsumo 妥当性検証必須、 不正 client が pending modal を作る攻撃防止
        if (!s.game.canTsumo(player)) return { ...s };
        if (s.game.feverActive[player] && s.game.effectiveHuapaiAtHule(player).includes('f4') && !s.cpu[player]) {
          // [2026-05-15 機能 11] フィーバー中 + 冬持ち + 待ち残山 0 → modal skip で 自動冬使用
          // [user confirm 不要、 「使う以外 ありえない」 局面なので 自動 applyFuyu(true)]
          if (s.game.isFeverWaitExhausted(player)) {
            s.game.fuyuConsumed[player] = true;
            s.game.feverActive[player] = false;
            s.message = `❄️ フィーバー中 + 待ち残山 0、 冬 自動使用 [機能 11]`;
            // fall through で 通常 tsumo path に [pendingFuyu set しない]
          } else {
            // 2026-05-14 codex review P1 fix: pendingFuyu 化前に saveSnapshot、
            // selectFuyu / selectKinpei の restoreSnapshot が stale snapshot を復元するのを防ぐ
            saveHuleSnapshot(s.game);
            enterFuyuStage(s, {
              winner: player,
              isRon: false,
              ronfrom: null,
              availableHuapai: s.game.effectiveHuapaiAtHule(player),
            });
            s.message = `❄️ フィーバー中、 冬を使う？ [使う = アリス発動 + フィーバー終了 / 保留 = 継続]`;
            return { ...s };
          }
        }
        // フィーバー + 払い state 自動: modal スキップ、秋の表示結果を見て priority で自動確定
        // 冬選択時は 局終了 [リョー仕様 2026-05-12]
        const isFeverPayAuto_tsumo = s.game.feverActive[player] && s.game.pochiPaymentMode[player];
        saveHuleSnapshot(s.game);
        let result = s.game.hule(player as any);
        if (!result) {
          s.message = `player ${player} はツモアガリできない [役なし or majiang-core 拒否]`;
          return { ...s };
        }
        // 秋効果で新たに冬が表示された場合も、表示前へ戻して冬選択後に同じ和了を再計算する。
        if (s.game.feverActive[player]
          && !s.game.fuyuConsumed[player]
          && s.game.effectiveHuapaiAtHule(player).includes('f4')
          && !s.cpu[player]) {
          const availableHuapai = s.game.effectiveHuapaiAtHule(player);
          s.game.restoreSnapshot();
          enterFuyuStage(s, { winner: player, isRon: false, ronfrom: null, availableHuapai });
          s.message = `❄️ 秋ドラ表示で冬、冬を使う？ [使う = アリス発動 + フィーバー終了 / 保留 = 継続]`;
          return { ...s };
        }
        const resolvedHuapai = s.game.effectiveHuapaiAtHule(player);
        // R7 P1 #6 + 2026-07-15: 金北手牌内も対象。秋で新たに表示された華も選択肢にする。
        if (hasGoldKita(s.game, player as PlayerId)
          && s.game.kinpeiTarget[player] === null
          && resolvedHuapai.length > 0
          && !s.cpu[player]
          && !isFeverPayAuto_tsumo) {
          enterKinpeiStage(s, {
            winner: player,
            isRon: false,
            ronfrom: null,
            availableHuapai: resolvedHuapai,
          });
          s.message = `🎁 金北 強化対象を選択してください [保留も可]`;
          return { ...s };
        }
        if ((s.cpu[player] || isFeverPayAuto_tsumo)
          && hasGoldKita(s.game, player as PlayerId)
          && s.game.kinpeiTarget[player] === null
          && resolvedHuapai.length > 0) {
          s.game.restoreSnapshot();
          s.game.autoResolveKinpei(player, resolvedHuapai);
          if (isFeverPayAuto_tsumo && s.game.kinpeiTarget[player] === 'fuyu') {
            s.game.fuyuConsumed[player] = true;
          }
          result = s.game.hule(player as any);
          if (!result) {
            s.message = `player ${player} 金北自動選択後のツモ再計算失敗`;
            return { ...s };
          }
        }
        s.game.applyHule(result, player as any, null);
        const isFever = s.game.feverActive[player as 0|1|2];
        const feverNote = isFever ? '🔥 [フィーバー継続中、 次局へ進まず待ち継続]' : '';
        s.message = `🎉 player ${player} ツモ和了！ ${formatHuleResult(result)} ${feverNote}`;
        s.lastHuleResult = result;
        s.lastWinner = player;
        s.ronResults = [];
        s = enqueueCutinState(s, 'tsumo', player as PlayerId);
        s = triggerSaiKoroIfAny(s, result, player);
        settleAfterWin(s, { winner: player as PlayerId, isRon: false });
        return { ...s };
      });
    },
    /** 北抜き [現家]
     *  R12 P2 #5 fix: meta.gold で 金北 / 通常北 を区別、 旧 code は常に 金北優先 抜きで
     *  通常北クリック時 表示と挙動 がズレる bug。 meta なし or gold=false なら 通常北
     *  優先抜き [goldHand.z>0 でも 通常北 から消費] */
    nukiBei(meta?: { gold?: boolean }) {
      if (!checkOnlineGate({ type: 'nukiBei', meta }, 'currentPlayer')) return;
      if (sendOnlineAction({ type: 'nukiBei', meta })) return;
      update((s) => {
        const player = s.game.lunbanToPlayerId(s.game.state.lunban);
        const replacement = s.game.declareNukiBei(player, meta);
        if (!replacement) {
          s.message = `player ${player} 北抜き不可`;
        } else {
          s.lastZimo = replacement;
          s.message = `player ${player} 北抜き [${s.game.nukidora[player]} 枚目]`;
        }
        return { ...s };
      });
    },
    /** 金牌消費 [打牌 / 北抜きの直前に呼ぶ、 アンミカ独自レイヤー] */
    consumeGold(player: number, kind: 'p' | 's' | 'z') {
      update((s) => {
        const gh = s.game.goldHand[player as 0 | 1 | 2];
        if (gh[kind] > 0) gh[kind] -= 1;
        return { ...s };
      });
    },
    /** 白ぽっち色消費 [打牌時] */
    consumePochi(player: number, color: 'blue' | 'red' | 'green' | 'yellow') {
      update((s) => {
        const ph = s.game.pochiHand[player as 0 | 1 | 2];
        if (ph[color] > 0) ph[color] -= 1;
        return { ...s };
      });
    },
    /** 暗槓 / 加槓 [現家、 ツモ後、 store/fulouActions.ts 委譲] */
    declareKan(mianzi: string) {
      if (!checkOnlineGate({ type: 'declareKan' }, 'currentPlayer')) return;
      if (sendOnlineAction({ type: 'declareKan', mianzi })) return;
      update((s) => {
        // R9 P1 #7 fix: 加槓 [mianzi が ^[mpsz]\d{3}[\+\=\-]\d$ pattern] は 他家ロン window を挟む。
        // ron 可能な player いれば pendingQianggang に保存 + awaitingRonDecision、 全 pass で 後段実行
        const isKakan = !!mianzi.match(/^[mpsz]\d{3}[\+\=\-]\d$/);
        if (isKakan) {
          const player = s.game.lunbanToPlayerId(s.game.state.lunban);
          // 加槓 tile = mianzi 末尾 1 桁 [例 m1110→ kakan の 4 枚目]、 ronpai として使う
          const kakanN = mianzi[mianzi.length - 1];
          const kakanPai = mianzi[0] + kakanN;
          // 他家で ron 可能か check [qianggangPending true で hule に qianggang flag が付く]
          s.game.qianggangPending = true;
          const ronCands = ([0, 1, 2] as const).filter(p => p !== player && s.game.canRon(p, kakanPai, player as any));
          // R11 codex P0 #1 fix: CPU only 候補 だと誰も押せず online で停止、 CPU は即 auto-ron
          const cpuRonCands = ronCands.filter(p => s.cpu[p as 0|1|2]);
          const humanRonCands = ronCands.filter(p => !s.cpu[p as 0|1|2]);
          if (humanRonCands.length === 0 && cpuRonCands.length > 0) {
            // CPU 槍槓 ron 即時 apply
            saveHuleSnapshot(s.game);
            s.lastDapai = { player, pai: kakanPai };
            const ronResults: Array<{ player: number; result: any }> = [];
            for (const p of cpuRonCands) {
              if (hasGoldKita(s.game, p as PlayerId)) {
                s.game.autoResolveKinpei(p as any);
              }
              const r = s.game.hule(p as any, kakanPai, player as any);
              if (r) {
                s.game.applyHule(r, p as any, player as any);
                ronResults.push({ player: p, result: r });
              }
            }
            s.game.qianggangPending = false;
            if (ronResults.length > 0) {
              const oya = s.game.currentOya;
              const oyaWon = ronResults.find(r => r.player === oya);
              s.lastWinner = oyaWon ? oyaWon.player : ronResults[ronResults.length - 1].player;
              s.lastHuleResult = ronResults[ronResults.length - 1].result;
              // R18 #4 fix: CPU 槍槓 ロンも fever 継続対応 [旧 roundEnded=true 固定で fever 抜け]
              const winnerSeatQ = s.lastWinner as PlayerId;
              settleAfterWin(s, { winner: winnerSeatQ, isRon: true });
              s.message = `🎉 CPU 槍槓 ron: ${ronResults.map(r => `p${r.player}`).join('/')}`;
              for (const rr of ronResults) {
                s = enqueueCutinState(s, 'ron', rr.player as PlayerId);
                s = triggerSaiKoroIfAny(s, rr.result, rr.player);
              }
              return { ...s };
            }
            // 全 CPU 役なしで ron 失敗 → 加槓 通常進行
          }
          if (humanRonCands.length > 0) {
            enterQianggangStage(s, { player, mianzi, kakanPai });
            s.lastDapai = { player, pai: kakanPai };
            enterRonDecisionStage(s);
            s.message = `🎯 加槓 [${mianzi}] → 槍槓 ron 候補 p${humanRonCands.join('/')} の判断待ち`;
            return { ...s };
          }
          // ron 候補なし → 通常 declareKanImpl に進む [qianggangPending は declareKan 内で再 set]
          s.game.qianggangPending = false;
        }
        return declareKanImpl(s, mianzi);
      });
    },
    /** リーチ宣言 [pending state へ、 宣言牌を打牌した時点で確定] */
    lizhi(opts: { shuvari?: boolean; fever?: boolean; open?: boolean } = {}) {
      if (!checkOnlineGate({ type: 'lizhi' }, 'currentPlayer')) return;
      if (sendOnlineAction({ type: 'lizhi', opts })) return;
      update((s) => {
        const player = s.game.lunbanToPlayerId(s.game.state.lunban);
        if (!s.game.canLizhi(player)) {
          s.message = `player ${player} リーチ不可 [聴牌じゃない / 副露あり / ツモ前]`;
          return { ...s };
        }
        if (opts.shuvari && s.game.shuvariUsed[player]) {
          s.message = `player ${player} シュバ既使用 [半荘 1 回]`;
          return { ...s };
        }
        if (opts.fever) {
          const fv = s.game.canFeverLizhi(player);
          const feverByDapai = s.game.feverCandidatesByDapai(player);
          if (!fv.ok && feverByDapai.size === 0) {
            s.message = `player ${player} フィーバー条件未達 [7p/7s 暗刻なし]`;
            return { ...s };
          }
        }
        s.lizhiPending = player;
        // 選択フラグを reactive 反映用 store 直下にも持つ [リョー指示 2026-05-12: リーチ宣言時 button 枠表示]
        (s as any).lizhiPendingFlags = { open: !!opts.open, shuvari: !!opts.shuvari, fever: !!opts.fever };
        (s as any)._lizhiOpen = !!opts.open;
        (s as any)._lizhiShuvari = !!opts.shuvari;
        (s as any)._lizhiFever = !!opts.fever;
        const labels = [];
        if (opts.shuvari) labels.push('シュバ');
        if (opts.fever) labels.push('フィバ');
        if (opts.open) labels.push('オープン');
        const tag = labels.length ? `[${labels.join('+')}]` : '[通常]';
        s.message = `player ${player} リーチ ${tag}、 宣言牌 [赤枠] を選んで切ってください`;
        return { ...s };
      });
    },
    /** [互換] 旧 openLizhi action は lizhi({open:true}) 経由 */
    openLizhi() { (this as any).lizhi({ open: true }); },
    /** 牌譜 JSON v2 から完全復元 [paifuIo.ts に委譲] */
    loadFromPaifu(paifu: any) {
      update((s) => {
        const next = buildStateFromPaifu(paifu, s.cpu);
        if (!next) {
          s.message = '牌譜 v2 形式じゃないので完全復元できない';
          return { ...s };
        }
        return next;
      });
    },
    /** 次局へ [オンライン: host のみ preShuffledPool 生成 + relay 経由共有] */
    nextRound(preShuffledPool?: string[]) {
      // R3 P2 #17 + R4 P1 #9 fix: pendingSaiKoro が non-null の間 nextRound 拒否、
      // finalize 後も queue 残 chance 飛ばし防止。 advanceSaiKoro が null にした後のみ進行可
      {
        const s = get(store) as StoreState;
        const blocking = blockingWinPipelineReason(s);
        if (blocking) {
          dlog(`[nextRound] reject: win pipeline pending [${blocking}]`);
          return;
        }
        // R12 P1 #8 fix: roundEnded / 半荘 finished 必須。 旧 code は modal だけ見てて、
        // double-click / 遅延 WS / 古いタブからの stale action で生 局が飛ぶ bug
        if (!s.roundEnded && !s.pendingPingju) {
          dlog('[nextRound] reject: 局未終了 [roundEnded=false]');
          return;
        }
        if (s.game.state?.finished) {
          dlog('[nextRound] reject: 半荘終了済 [state.finished=true]、 nextMatch を使え');
          return;
        }
      }
      if (onlineMode && !isApplyingRemote) {
        // 2026-05-14 Round 2 codex fix P0 #1: deadlock 解消
        //   旧: host 限定 send だが UI は winner、 non-host winner が click すると詰む
        //   新: winner [lastWinner] or host が send 可能、 流局時は host が send [lastWinner=null]
        // R8 P0 #2 fix: CPU 和了 [winner=CPU] の場合は host が代理で send 可能、
        // 旧 code は winner 一致 or 流局 host のみ許可で CPU winner 時 詰むので、
        // 「lastWinner が CPU member」 なら host も canSend に追加
        const s = get(store) as StoreState;
        const isWinner = s.lastWinner !== null && myOnlineSeat === s.lastWinner;
        const isHostLocal = iAmHost || !!(window as any).__anmikaIsHost;
        const winnerIsCpu = s.lastWinner !== null && s.cpu[s.lastWinner as 0|1|2] === true;
        const canSend = isWinner || (s.lastWinner === null && isHostLocal) || (winnerIsCpu && isHostLocal);
        if (!canSend) return;
        const pool = generateTilePool(defaultSanmaRule());
        const shuffled: string[] = [];
        while (pool.length) shuffled.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0] as string);
        // R21 P0 fix: from_role を 同梱、 server 側 nextRound gate で host or winner or oya 判定
        const fromRole: 'host' | 'winner' | 'oya' = isWinner ? 'winner' : 'host';
        sendOnlineAction({ type: 'nextRound', preShuffledPool: shuffled, from_role: fromRole });
        return;
      }
      update((s) => {
        // 受信側で preShuffledPool 渡す [host が relay で送ってきた山]
        const remotePool = preShuffledPool;
        // 判定フェーズ: pingju は既に applyPingjuTransition で defen 動かしてるので apply 再実行不要
        if (s.pendingPingju) {
          s.pendingPingju = false;
          // トビ check → 半荘終了
          if (s.game.isGameEnd()) {
            s.game.state.finished = true;
            const ranking = s.game.getRanking();
            s.message = '🏁 半荘終了 [流局後 トビ] ' + ranking.map(r => `${r.rank}位 p${r.player} ${r.defen}点`).join(' / ');
            s.roundEnded = true;
            return { ...s };
          }
          // そのまま次局進行 [break せず流す]
        }
        const winner = s.lastWinner;
        // tsumo 経路 [lastDapai null] かつ winner === 現親 なら 親ツモ → tobi 無視で連荘継続
        const isTsumoOyaSelfRenchan = winner !== null && s.lastDapai === null
          && winner === (((s.game.state.qijia - s.game.state.jushu) % 3 + 3) % 3);
        s.game.nextRound({ winner: winner as any, preShuffledPool: remotePool as any });
        // 半荘終了判定 [親ツモ自家のみ tobi 例外]
        if (s.game.isGameEnd(isTsumoOyaSelfRenchan ? { ignoreTobiFor: winner as any } : {})) {
          s.game.state.finished = true;
          const ranking = s.game.getRanking();
          s.message = '🏁 半荘終了 ' + ranking.map(r => `${r.rank}位 p${r.player} ${r.defen}点`).join(' / ');
          s.roundEnded = true;
          return { ...s };
        }
        s.game.qipai();
        s.lastZimo = s.game.zimo();
        s.lastDapai = null;
        s.lastWinner = null;
        s.lastHuleResult = null;
        clearReactionStage(s);
        s.roundEnded = false;
        s.message = null;
        s.lizhiPending = null;
        // [2026-05-21] 局頭 zimo でも 既に fever 残ってる時は強制ツモ切り (まれだが対応)
        s = applyFeverAutoTsumokiri(s);
        // Svelte の reactive を確実に trigger するため shallow copy
        return { ...s };
      });
    },
    /** アガリ止め [親アガリ + オーラスのみ可能] */
    agariyame() {
      if (!checkOnlineGate({ type: 'agariyame' }, 'oya')) return;
      if (sendOnlineAction({ type: 'agariyame' })) return;
      update((s) => {
        const winner = s.lastWinner;
        if (winner === null || winner === undefined) return { ...s };
        if (!s.game.canAgariyame(winner as any)) return { ...s };
        s.game.agariyame();
        const ranking = s.game.getRanking();
        s.message = '🏁 半荘終了 [アガリ止め] ' + ranking.map(r => `${r.rank}位 p${r.player} ${r.defen}点`).join(' / ');
        s.roundEnded = true;
        return { ...s };
      });
    },
    /** 次の zimo を実行 [load 後 / dapai 後の中間 state から ツモへ進める]
     *  既に zimo 済 [lastZimo 存在] なら no-op。 山切れなら roundEnded set。 */
    drawNext() {
      // R4 P1 #18 fix: online で drawNext が local 進行で desync する bug。
      // currentPlayer 限定 gate + WS broadcast に乗せて 同期させる
      if (!checkOnlineGate({ type: 'drawNext' }, 'currentPlayer')) return;
      if (sendOnlineAction({ type: 'drawNext' })) return;
      update((s) => {
        const player = s.game.lunbanToPlayerId(s.game.state.lunban);
        const sp = s.game.shoupai.get(player);
        if (sp?._zimo != null) return { ...s }; // 既にツモ済、 no-op
        const z = s.game.zimo();
        if (z == null) {
          // 2026-05-14 codex review P2 fix: applyPingjuTransition で 罰符 / 流し役満 / defen
          s = applyPingjuTransition(s, '🌀 山切れ、 流局判定:');
        } else {
          s.lastZimo = z;
          s.lastDapai = null;
        }
        // [2026-05-21] フィーバー強制ツモ切り [drawNext 経路]
        s = applyFeverAutoTsumokiri(s);
        return { ...s };
      });
    },
    /** ツモ切り */
    tsumokiri(expectedPlayer?: PlayerId) {
      if (!checkOnlineGate({ type: 'tsumokiri' }, 'currentPlayer')) return;
      if (sendOnlineAction({ type: 'tsumokiri' })) return;
      update((s) => {
        if (s.roundEnded || s.awaitingRonDecision || s.awaitingFulou
            || s.pendingFuyu || s.pendingKinpei || s.pendingSaiKoro
            || s.pendingFeverContinue || (s.lizhiPending ?? null) !== null) return { ...s };
        if (!s.lastZimo) return { ...s };
        const player = s.game.lunbanToPlayerId(s.game.state.lunban);
        if (expectedPlayer !== undefined && player !== expectedPlayer) return { ...s };
        // [2026-05-21] リーチ済 player の ツモアガリ可なら 自動 tsumokiri 停止 (ツモボタン待ち)
        if (s.game.lizhi.has(player) && s.game.canTsumo(player)) {
          s.message = `player ${player} はツモ和了可能 [自動ツモ切り停止]`;
          return { ...s };
        }
        return innerDiscard(s, s.lastZimo);
      });
    },
    /** リーチ済 player のターン自動進行 [自動カン → ツモ切り] */
    autoLizhiAction() {
      update((s) => {
        const player = s.game.lunbanToPlayerId(s.game.state.lunban);
        if (!s.game.lizhi.has(player)) return { ...s };
        if (s.roundEnded || s.awaitingRonDecision || s.awaitingFulou) return { ...s };
        // ツモ和了可ならユーザー判断待ち
        if (s.game.canTsumo(player)) return { ...s };
        // 待ち不変の暗槓候補があれば自動カン [majiang-core の rule.リーチ後暗槓許可レベル=2 で filter]
        const kanCands = s.game.getKanCandidates(player);
        if (kanCands.length > 0) {
          dlog('[auto kan]', { player, mianzi: kanCands[0] });
          const replacement = s.game.declareKan(player, kanCands[0]);
          if (replacement) {
            s.lastZimo = replacement;
            s.message = `[自動カン] player ${player} 暗槓 [${kanCands[0]}]、 嶺上 ${replacement}`;
            return { ...s };
          }
        }
        // 自動ツモ切り
        if (s.lastZimo) {
          return innerDiscard(s, s.lastZimo);
        }
        return { ...s };
      });
    },
    /** CPU トグル */
    toggleCpu(p: 0 | 1 | 2) {
      update((s) => {
        s.cpu[p] = !s.cpu[p];
        return { ...s };
      });
    },
    /** CPU 自動進行: 現家が CPU なら ツモ切り、 ループ [store/cpuActions.ts 委譲] */
    cpuStep() {
      // オンライン時は host だけが CPU 代理 discard を sendOnlineAction で送る、 local 直接 apply は禁止
      // [リョー指示 2026-05-13: host CPU 駆動が WS に乗らないと magiccat.lab 側で advance せず止まる]
      // 2026-05-14 codex review P0: 非 host は cpuStep 発火 禁止、 host 以外 client が
      // 並列 send で WS に CPU discard を多重 inject するのを防止
      if (onlineMode && !isApplyingRemote) {
        if (!iAmHost && !(window as any).__anmikaIsHost) {
          dlog('[gate-block]', { type: 'cpuStep', reason: 'not host' });
          return;
        }
        // R6 P1 #3 fix: online CPU でも ツモ和了 / 北抜き を 適切に relay。
        // 旧 code は pickBestDiscard だけ relay してて canTsumo の局面でも打牌してた
        const s = get(store) as StoreState;
        const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
        if (s.roundEnded || s.awaitingRonDecision || s.awaitingFulou) return;
        const sp = s.game.shoupai.get(cur);
        if (!sp?._zimo) return;
        // ツモ和了 [CPU]: tsumo action を cpuRelay で送る
        if (s.game.canTsumo(cur)) {
          sendOnlineAction({ type: 'tsumo', cpuRelay: true, cpuSeat: cur });
          return;
        }
        const forcedKan = s.game.getForcedLizhiKanCandidates(cur);
        if (forcedKan.length > 0) {
          sendOnlineAction({ type: 'declareKan', mianzi: forcedKan[0], cpuRelay: true, cpuSeat: cur });
          return;
        }
        // z4 ツモ → 北抜き [人間 path と同様の優先順]
        if (toCorePai(sp._zimo) === 'z4' && s.game.canNukiBei(cur)) {
          sendOnlineAction({ type: 'nukiBei', cpuRelay: true, cpuSeat: cur });
          return;
        }
        // 通常打牌
        let pai: string | null = null;
        try { pai = s.game.pickBestDiscard(cur) ?? (sp._zimo as string); } catch (_e) { pai = sp._zimo as string; }
        if (typeof (import.meta as any)?.env?.DEV === 'boolean' && (import.meta as any).env.DEV) dlog('[cpuStep-online] cur=', cur, 'pai=', pai);
        if (pai) {
          const sent = sendOnlineAction({ type: 'discard', pai, cpuRelay: true, cpuSeat: cur });
          if (typeof (import.meta as any)?.env?.DEV === 'boolean' && (import.meta as any).env.DEV) dlog('[cpuStep-online] sendOnlineAction returned=', sent);
        }
        return;
      }
      update((s) => cpuStepImpl(s));
    },
    /** 自動進行: ツモ切り loop で局終了 or 何かイベント発生まで進める [store/cpuActions.ts 委譲] */
    autoAdvance() {
      update((s) => autoAdvanceImpl(s));
    },
    /** debug: qipai を呼ばず直接構築 [store/debug.ts に委譲]
     *  opts.goldNbei: 金北 1 枚抜き済状態 [goldHand.z=1, nukidora=1] */
    resetDebug(forceP0: string[], forceHua: string[] = [], opts: { goldNbei?: boolean; forceShan?: string[] } = {}) {
      set(buildDebugState(forceP0, forceHua, opts));
    },
    /** test: pendingSaiKoro を直接 inject [サイコロ modal 表示 sync テスト用] */
    _testInjectSaiKoro(payload: { winner: 0|1|2; chances: any[]; rolls?: any[] }) {
      update((s) => ({
        ...s,
        pendingSaiKoro: {
          winner: payload.winner,
          chances: payload.chances,
          currentIdx: 0,
          selectedCombo: [1, 2] as [number, number],
          rolls: payload.rolls ?? [],
          finalized: false,
          summary: null,
        },
      }));
    },
    /** test: pendingSaiKoro.rolls に 1 件 push [WS sync 模擬] */
    _testPushSaiKoroRoll(roll: { dice: [number, number]; hit: boolean; zoro: boolean }) {
      update((s) => {
        if (!s.pendingSaiKoro) return s;
        return { ...s, pendingSaiKoro: { ...s.pendingSaiKoro, rolls: [...s.pendingSaiKoro.rolls, roll] } };
      });
    },
    /** 半荘終了 → 次の試合へ [全 client broadcast 用 wrapper]
     *  - 任意 member から発火 [online: host のみ preShuffledPool 生成、 非 host は host fallback action 送付]
     *  - finalize=true [default]: 半荘終了 chip 精算 [chipBase + uma + topN + tontonbu] を
     *    chipLedger に書き戻してから reset、 次試合に最終精算を持ち越し
     *  - R12 P0 #1 fix: preShuffledPool / qijia / cpuSeats を action 同梱 → remote 全 client が
     *    同じ山 / qijia / CPU 席で start [リョー報告: 次試合 全 client 別山 desync]
     *  - R12 P0 #2 fix: cpuSeats を保持、 reset 後 CPU 駆動が消えない
     *  [リョー報告 2026-05-14: 押した本人だけ画面遷移 + 115/-27/-88 が 46/0/-46 に reset bug] */
    nextMatch(opts: { finalize?: boolean; resetChip?: boolean; preShuffledPool?: string[]; qijia?: 0|1|2; cpuSeats?: number[] } = {}) {
      const finalize = opts.finalize !== false;
      const resetChip = opts.resetChip === true;
      // R12 P1 #8 fix: state.finished 必須。 double-click / 遅延 WS / 古いタブからの stale action で
      // 生 局が飛ぶ bug。 remote apply [isApplyingRemote] でも 同じ条件を要求
      {
        const s = get(store) as StoreState;
        if (!s.game.state?.finished) {
          dlog('[nextMatch] reject: 半荘 未終了 [state.finished=false]');
          return;
        }
        const blocking = blockingWinPipelineReason(s);
        if (blocking) {
          dlog(`[nextMatch] reject: win pipeline pending [${blocking}]`);
          return;
        }
      }
      if (onlineMode && !isApplyingRemote) {
        // R15 P0 #4 fix: nextMatch は host 限定。 旧 code は任意 client が山生成して送れて、
        // ゲストが先に押すと 別山で次試合へ進めて host の試合結果 POST も飛ばせる
        if (!iAmHost) {
          dlog('[nextMatch] reject: online 中は host のみ');
          return;
        }
        const pool = generateTilePool(defaultSanmaRule());
        const shuffled: string[] = [];
        while (pool.length) shuffled.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0] as string);
        const curState = get(store) as StoreState;
        const cpuSeats = ([0, 1, 2] as const).filter((p) => curState.cpu[p]);
        // qijia は次半荘で 同じ qijia [連続 半荘で qijia 引き継ぎ] / または rotate。 リョー仕様未明な
        // ので 現 game の qijia を維持
        const qijia = (curState.game.state?.qijia ?? 0) as 0|1|2;
        // R19 #3 fix: 次試合 chipLedger を nextMatch action に同梱、 server で synthetic start に
        // 載せ、 中途再接続 player の累積祝儀 復元を可能に。 finalize 直前の最新 chipLedger を 送る
        // [resetChip 時は 0 へ、 既に game.nextMatch 内で計算される]
        let nextChipLedger: { 0: number; 1: number; 2: number } = { 0: 0, 1: 0, 2: 0 };
        try {
          if (finalize && !resetChip) {
            // getFinalScore で finalize 後の値を計算 [chipBase + uma + topN + tontonbu]
            const fs: Array<{ player: number; total: number }> = (curState.game as any).getFinalScore?.() ?? [];
            for (const r of fs) {
              if (r.player === 0 || r.player === 1 || r.player === 2) {
                (nextChipLedger as any)[r.player] = r.total;
              }
            }
          } else if (!resetChip) {
            nextChipLedger = { 0: curState.game.chipLedger[0], 1: curState.game.chipLedger[1], 2: curState.game.chipLedger[2] };
          }
        } catch {}
        sendOnlineAction({ type: 'nextMatch', finalize, resetChip, preShuffledPool: shuffled, qijia, cpuSeats, chipLedger: nextChipLedger });
        return;
      }
      if (finalize && !resetChip) {
        update((s) => {
          if ((s.game as any).state?.finished) {
            try {
              const fs = (s.game as any).getFinalScore();
              for (const r of fs) {
                (s.game.chipLedger as any)[r.player] = r.total;
              }
            } catch (e) {
              dlog('[nextMatch] getFinalScore failed', e);
            }
          }
          return s;
        });
      }
      (this as any).reset({ preserveChip: !resetChip, preShuffledPool: opts.preShuffledPool, qijia: opts.qijia, cpuSeats: opts.cpuSeats });
    },
    reset(opts: { preserveChip?: boolean; preShuffledPool?: string[]; qijia?: 0|1|2; cpuSeats?: number[] } = {}) {
      // 旧 game の chip ledger を保持する option [リョー指示 2026-05-12 次の試合へ default 持越し]
      let preservedChip: Record<0|1|2, number> | null = null;
      const currentState = get(store) as StoreState;
      const preservedCpu: Record<0|1|2, boolean> = {
        0: !!currentState.cpu?.[0],
        1: !!currentState.cpu?.[1],
        2: !!currentState.cpu?.[2],
      };
      if (opts.preserveChip) {
        update((s) => {
          preservedChip = { 0: s.game.chipLedger[0], 1: s.game.chipLedger[1], 2: s.game.chipLedger[2] };
          return s;
        });
      }
      // R12 P0 #1 fix: online で preShuffledPool / qijia を渡されたら 共有山で start
      const ng = opts.preShuffledPool
        ? new Game3({ qijia: (opts.qijia ?? 0) as any, preShuffledPool: opts.preShuffledPool })
        : new Game3();
      ng.qipai();
      const fp = ng.zimo();
      if (preservedChip) {
        ng.chipLedger[0] = (preservedChip as any)[0];
        ng.chipLedger[1] = (preservedChip as any)[1];
        ng.chipLedger[2] = (preservedChip as any)[2];
      }
      // R12 P0 #2 fix: cpuSeats 渡されたら CPU 席 を保持、 でないと online CPU 入り部屋で
      // 次半荘 から CPU 駆動が消える bug
      const cpuMap: Record<0|1|2, boolean> = opts.cpuSeats ? { 0: false, 1: false, 2: false } : { ...preservedCpu };
      if (opts.cpuSeats) {
        for (const s of opts.cpuSeats) {
          if (s === 0 || s === 1 || s === 2) cpuMap[s] = true;
        }
      }
      set({
        game: ng,
        lastZimo: fp,
        lastDapai: null,
        lastWinner: null,
        lastHuleResult: null,
        awaitingRonDecision: false,
      ronPassedPlayers: [],
      ronDeclaredPlayers: [],
      ronResults: [],
        awaitingFulou: false,
        ponCandidates: [],
        kanCandidates: [],
        roundEnded: false,
        message: null as any,
        cpu: cpuMap,
        lizhiPending: null,
        pendingKinpei: null,
        pendingFuyu: null,
    pendingFeverContinue: null,
    pendingPingju: false,
      pendingQianggang: null,
    pendingSaiKoro: null,
    stamps: { 0: null, 1: null, 2: null },
    cutin: null,
    cutinQueue: [],
      });
    },
    /** ポン宣言 [store/fulouActions.ts 委譲]
     *  2026-05-14 codex review P0: 自席 limited + 候補リスト確認 */
    pon(player: number, mianzi: string) {
      if (onlineMode && !isApplyingRemote && myOnlineSeat !== null) {
        if (myOnlineSeat !== player) { dlog('[gate-block]', { type: 'pon', my: myOnlineSeat, player }); return; }
        const s = get(store) as StoreState;
        if (!s.ponCandidates.some((c: any) => c.player === player)) { dlog('[gate-block]', { type: 'pon', reason: 'not in candidates', player }); return; }
      }
      if (sendOnlineAction({ type: 'pon', player, mianzi })) return;
      update((s) => ponImpl(s, player, mianzi));
    },
    /** 大明槓宣言 [store/fulouActions.ts 委譲]
     *  2026-05-14 codex review P0: 自席 limited + 候補リスト確認 */
    damingang(player: number, mianzi: string) {
      if (onlineMode && !isApplyingRemote && myOnlineSeat !== null) {
        if (myOnlineSeat !== player) { dlog('[gate-block]', { type: 'damingang', my: myOnlineSeat, player }); return; }
        const s = get(store) as StoreState;
        if (!s.kanCandidates.some((c: any) => c.player === player)) { dlog('[gate-block]', { type: 'damingang', reason: 'not in candidates', player }); return; }
      }
      if (sendOnlineAction({ type: 'damingang', player, mianzi })) return;
      update((s) => damingangImpl(s, player, mianzi));
    },
  };
}

/** アガリ result.saiKoroChances を pendingSaiKoro に転記、 chances 1+ あれば modal trigger
 *  [2026-05-12 サイコロ MVP step 2]
 *  R3 P1 #8 fix: 複数 winner [ダブロン] の chances を queue 化、 既に pendingSaiKoro が
 *  set 済なら append、 新規 winner の chances を 同 modal 内で 順次処理する。
 *  ただし winner が同じ player なら 上書き [冬 modal 再呼出等] */
/** [2026-05-21 リョー指示] フィーバーリーチ中、 非フィーバー player の zimo は強制ツモ切り
 *  (抜き牌 z4 は innerDiscard 内で declareNukiBei 自動変換、 華 f1-4 は zimo 時点で huapai に
 *  auto 投入済)。 online 時は client desync 防止のため skip。
 *  全 zimo path から呼び出して 漏れない設計に統一。 */
export function applyFeverAutoTsumokiri(s: StoreState): StoreState {
  if (!s.lastZimo || s.roundEnded || s.awaitingRonDecision || s.awaitingFulou) return s;
  if (typeof window !== 'undefined' && (window as any).__anmikaOnline) return s;
  const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
  const someoneFever = ([0, 1, 2] as const).some((p) => s.game.feverActive[p]);
  if (!someoneFever) return s;
  const curIsFever = s.game.feverActive[cur as 0 | 1 | 2];
  if (curIsFever && !s.game.lizhi.has(cur as 0 | 1 | 2)) return s;
  const tile = s.lastZimo;
  return innerDiscard(s, tile);
}

export function triggerSaiKoroIfAny(s: StoreState, result: any, winner: number): StoreState {
  const chances = result?.saiKoroChances ?? [];
  if (chances.length === 0) return s;
  // R4 P1 #8 fix: 各 chance に winner を埋め込む、 ダブロン append 時に owner 維持
  const mappedChances = chances.map((c: any) => ({
    name: c.name,
    baseChip: c.baseChip,
    shuvariApplicable: c.shuvariApplicable,
    count: c.count ?? 1,
    plusMinus: c.plusMinus ?? '+',
    mode: c.mode ?? (result?._isRon ? 'ron' : 'tsumo'),
    winner,
  }));
  appendSaiKoroChances(s, winner, mappedChances);
  return s;
}

export function innerDiscard(s: StoreState, pai: string, meta?: { gold?: boolean; pochi?: 'blue' | 'red' | 'green' | 'yellow' }): StoreState {
  // 既に局終了してる場合は no-op [連打防止]
  if (s.roundEnded) return { ...s };
  const player = s.game.lunbanToPlayerId(s.game.state.lunban);
  // 北 [z4/gN] は河に切れない → 北抜きに変換 [アンミカ独自、 リョー指示 2026-05-11]
  if (toCorePai(pai) === 'z4' && s.game.canNukiBei(player as any)) {
    const nukiMeta = resolveNukiBeiMeta({
      requestedPai: pai,
      metaGold: meta?.gold,
      lastZimo: s.lastZimo,
      lastZimoGold: s.game.shan.lastZimoGold,
    });
    const replacement = s.game.declareNukiBei(player as any, nukiMeta);
    s.lastZimo = replacement ?? null;
    s.message = `[ツモ切り] 北 [${pai}] → 北抜き`;
    if (replacement == null) {
      // 2026-05-14 codex review P2 fix: 北抜きでの 王牌枯渇 流局も applyPingjuTransition
      s = applyPingjuTransition(s, `🌀 流局 [北抜きで王牌枯渇]:`);
    }
    return { ...s };
  }
  dlog('[discard] from=', player, 'pai=', pai, 'meta=', meta, 'fever=', JSON.stringify(s.game.feverActive));
  try {
    s.game.dapai(pai, meta);
  } catch (e: any) {
    s.message = `${pai} は打牌不可 [${e?.message ?? '不明'}]、 別の牌を選択して`;
    (s as any)._lastDapaiFailed = true;
    return { ...s };
  }
  (s as any)._lastDapaiFailed = false;
  const committedPai = s.game.discardLog[player as PlayerId]?.at(-1)?.pai ?? pai;
  s.lastDapai = { player, pai: committedPai };
  let ronCandidates = ([0, 1, 2] as const).filter(
    (p) => p !== player && s.game.canRon(p, committedPai, player as any)
  );
  dlog('[discard] ronCands=', ronCandidates, 'tings=', ([0,1,2] as const).map(p => ({ p, ting: s.game.getTingpaiList(p as any), canR: s.game.canRon(p as any, committedPai, player as any), lizhi: s.game.lizhi.has(p as any), fever: s.game.feverActive[p as 0|1|2] })));
  // CPU が ron 候補なら自動ロン
  // ダブロン対応 [リョー指示]: 全 CPU ロン候補を連続処理、 親優先で lastWinner 設定
  // R3 P1 #6 fix: human ron 候補が同時存在する場合は CPU auto-ron を保留、
  // human の判断 [ron / pass] を先に受け、 全 pass 後に CPU auto-ron を実行する
  const cpuRonCands = ronCandidates.filter(p => s.cpu[p as 0|1|2]);
  const humanRonCands = ronCandidates.filter(p => !s.cpu[p as 0|1|2]);
  if (cpuRonCands.length > 0 && humanRonCands.length === 0) {
    let ronResults: Array<{ player: number; result: any }> = [];
    // 2026-05-14 codex review P1 fix: ダブロンで各 winner ごとに saveSnapshot すると
    // 2 人目の snapshot が 1 人目 適用後 になる。 全 hule 適用前に 1 度だけ saveSnapshot
    saveHuleSnapshot(s.game);
    if (cpuRonCands.length > 1) s.game.snapshotLocked = true;
    for (const p of cpuRonCands) {
      // R7 P1 #6 fix: CPU 直ロン経路 [discard 直後] でも autoResolveKinpei、 通常 path と揃え
      if (hasGoldKita(s.game, p as PlayerId)) {
        s.game.autoResolveKinpei(p as any);
      }
      // fromPlayer 渡し忘れで ronpaiWithDir null → hule が ロン認識せず役なし扱いになる bug fix
      const result = s.game.hule(p as any, committedPai, player as any);
      if (result) {
        ronResults.push({ player: p, result });
      }
    }
    // 全 CPU ロン hule が役なしで失敗した場合は ron 不成立 [見送り扱い、 通常進行へ]
    // [リョー指示 2026-05-12 fix: CPU を ronCandidates から除外、 human 候補なしなら awaitingRon
    //  set しないように、 後段の line 960 で誤って待機状態にならない対策]
    if (ronResults.length === 0) {
      s.game.snapshotLocked = false;
      dlog('[CPU ron 全失敗] 役なし扱いで見送り、 通常 dapai 進行');
      // CPU 候補を ronCandidates から除外、 残りが空なら zimo に進む
      ronCandidates = ronCandidates.filter(p => !s.cpu[p as 0|1|2]);
    } else {
      ronResults = settleRonResultsInKamichaOrder(s.game, player as PlayerId, ronResults);
      // 親アガリ含む場合 lastWinner = 親 [連荘継続]、 そうでなければ最後のアガリ player
      // 2026-05-14 Round 2 codex fix P1 #5: 現親判定で CPU ダブロン後の連荘継続 [子アガリ後の現親 が含まれた時]
      const oya = s.game.currentOya;
      const oyaWon = ronResults.find(r => r.player === oya);
      s.lastWinner = oyaWon ? oyaWon.player : ronResults[ronResults.length - 1].player;
      s.ronResults = ronResults;
      const winner = s.lastWinner as number;
      const winnerResult = ronResults.find(r => r.player === winner)!.result;
      s.message = ronResults.length > 1
        ? `🎉🎉 ダブロン! ${ronResults.map(r => `p${r.player}: ${formatHuleResult(r.result)}`).join(' / ')}`
        : `🎉 [CPU] player ${ronResults[0].player} ロン和了！ ${formatHuleResult(ronResults[0].result)}`;
      s.lastHuleResult = winnerResult;
      finishRonDecisionStage(s);
      // 2026-05-14 codex review P1 fix: CPU ロン経路でも 特殊効果の state 遷移を 人間 ron と
      // 揃える。 triggerSaiKoroIfAny / feverWinCount inc / pendingFeverContinue / roundEnded 制御
      // Round 2 codex fix P2 #11: 全 winner の saiKoroChances を queue 化、 ダブロン 両方処理
      for (const rr of ronResults) {
        s = enqueueCutinState(s, 'ron', rr.player as PlayerId);
        s = triggerSaiKoroIfAny(s, rr.result, rr.player);
      }
      settleAfterWin(s, { winner: winner as PlayerId, isRon: true });
      s.game.snapshotLocked = false;
      return { ...s };
    }
  }
  // ポン候補も検出 [フィーバー中は ponする player が非フィーバーなら ポン不可]
  const someoneFever = ([0, 1, 2] as const).some((p) => s.game.feverActive[p]);
  const ponCands: Array<{ player: number; mianzi: string[] }> = [];
  const kanCands: Array<{ player: number; mianzi: string[] }> = [];
  for (const p of [0, 1, 2] as const) {
    if (p === player) continue;
    // フィーバー中は フィーバー player 以外 副露不可
    if (someoneFever && !s.game.feverActive[p]) continue;
    const m = s.game.getPonCandidates(p, player as any, committedPai);
    if (m.length > 0) ponCands.push({ player: p, mianzi: m });
    const km = s.game.getDamingangCandidates(p, player as any, committedPai);
    if (km.length > 0) kanCands.push({ player: p, mianzi: km });
  }
  // 抜き直後 ポン抑制 flag は ここまでで pon 候補 build 終了 → consume として clear
  //   [game.dapai 内で clear すると pon check 時点で false で誤判定するため、
  //    ルール 2-4 「抜き直後の他家ポン不可」 を 正しく動かすには ここで clear、
  //    2026-05-14 ゆーま 自走 fix]
  s.game.justNukidBei[player as 0|1|2] = false;
  // CPU の ポン 自動判断 [リョー指示 2026-05-14 ゆーま 自走 拡張]:
  //   - 三元牌 [z5/z6/z7] 常に pon [yakuhai 1 役 確定]
  //   - 風牌 [z1-z3] は changfengZ または cand.player の zifengZ と一致時のみ pon
  //   - それ以外は見送り
  if (ronCandidates.length === 0) {
    const committedCore = toCorePai(committedPai);
    const isSanyuanpai = committedCore[0] === 'z' && (committedCore[1] === '5' || committedCore[1] === '6' || committedCore[1] === '7');
    const isFengpai = committedCore[0] === 'z' && (committedCore[1] === '1' || committedCore[1] === '2' || committedCore[1] === '3');
    const paiN = isFengpai ? parseInt(committedCore[1]) : -1;
    const changfengZ = s.game.changfengZ;
    // ポン後 シャンテン推定 [簡易]: estimateXiangtingWithExtra で +1 zimo 相当 評価
    // [リョー指示 2026-05-21 自走 CPU 教育: ポン判定にシャンテン進化チェック追加]
    const ponAdvancesShanten = (p: 0|1|2): boolean => {
      try {
        const { base, withExtra } = s.game.estimateXiangtingWithExtra(p, committedCore);
        return base <= 2 && withExtra < base;
      } catch { return false; }
    };
    for (const cand of ponCands) {
      if (!s.cpu[cand.player as 0 | 1 | 2] || cand.mianzi.length === 0) continue;
      let shouldPon = false;
      if (isSanyuanpai) shouldPon = true;
      else if (isFengpai) {
        const zifeng = s.game.zifengZ(cand.player as any);
        if (paiN === changfengZ || paiN === zifeng) shouldPon = true;
      } else {
        // 数牌 / オタ風: 副露 1+ かつ baseXt<=2 で pon 後 進化する時のみ [役なし リスク回避]
        // 7 [m7/p7/s7] は ポン全面禁止: 明刻化すると feverLizhi の nonAnkanFulou check で
        // フィーバーリーチ権利が消える [2026-05-21 リョー指摘 fix]。
        const sp = s.game.shoupai.get(cand.player as 0|1|2);
        const fulouCount = sp?._fulou?.length ?? 0;
        const isSeven = (committedCore[0] === 'm' || committedCore[0] === 'p' || committedCore[0] === 's') && committedCore[1] === '7';
        if (isSeven) {
          shouldPon = false;
        } else if (fulouCount >= 1 && ponAdvancesShanten(cand.player as 0|1|2)) {
          shouldPon = true;
        }
      }
      if (shouldPon) {
        s.game.declarePon(cand.player as any, cand.mianzi[0], player as any);
        s.lastZimo = null;
        clearReactionStage(s);
        s.message = `[CPU] player ${cand.player} ポン [${cand.mianzi[0]}]`;
        return { ...s };
      }
    }
    // CPU の 大明槓 自動判断 [ゆーま 2026-05-14 自走]:
    //   - pon と同基準: 三元牌 [z5-z7] 常に kan、 風牌 [z1-z3] は 自風/場風 一致時のみ
    //   - それ以外 [萬筒索] は スルー [形崩れ + 嶺上負け リスク回避]
    for (const cand of kanCands) {
      if (!s.cpu[cand.player as 0 | 1 | 2] || cand.mianzi.length === 0) continue;
      let shouldKan = false;
      if (isSanyuanpai) shouldKan = true;
      else if (isFengpai) {
        const zifeng = s.game.zifengZ(cand.player as any);
        if (paiN === changfengZ || paiN === zifeng) shouldKan = true;
      }
      if (shouldKan) {
        // R9 P1 #6 fix: 大明槓 は declareDamingang(player, mianzi, fromPlayer)。 declareKan は
        // 暗槓 / 加槓用で 河 marker / fromPlayer / lunban / 嶺上 同期されない = state 破壊
        if (!s.lastDapai) return { ...s };
        // R18 #11 fix: 嶺上 null [山枯渇 / rollback] 時は 大明槓を成立させず候補のまま、
        // 旧 code は declareDamingang null replacement のまま success message に進んで state 破壊
        const replacement = s.game.declareDamingang(cand.player as any, cand.mianzi[0], s.lastDapai.player as any);
        if (replacement === null) {
          dlog('[CPU damingang] reject: 嶺上 null [山枯渇 / rollback]');
          continue;  // 次 候補 / pass loop へ
        }
        s.lastZimo = replacement;
        clearReactionStage(s);
        s.message = `[CPU] player ${cand.player} 大明槓 [${cand.mianzi[0]}]、 嶺上 ${replacement}`;
        return { ...s };
      }
    }
    // 残った CPU 以外の人間ポン / 大明槓候補のみ残す
    const humanPonCands = ponCands.filter((c) => !s.cpu[c.player as 0 | 1 | 2]);
    const humanKanCands = kanCands.filter((c) => !s.cpu[c.player as 0 | 1 | 2]);
    if (humanPonCands.length > 0 || humanKanCands.length > 0) {
      enterFulouStage(s, { ponCandidates: humanPonCands, kanCandidates: humanKanCands });
      const ppl = [
        ...humanPonCands.map((c) => `pon p${c.player}`),
        ...humanKanCands.map((c) => `kan p${c.player}`),
      ];
      s.message = `副露可能: ${ppl.join(' / ')}`;
      return { ...s };
    }
    // 誰もポンしない → 通常のツモへ
    try {
      s.lastZimo = s.game.zimo();
      s.lastDapai = null;
    } catch (e: any) {
      dlog('[zimo error]', e?.message ?? e);
      s.lastZimo = null;
    }
    if (!s.lastZimo) {
      // 流局成立、 罰符 + 流し役満 を 即 apply [agari panel で点数移動表示するため、 リョー指示 2026-05-12]
      s = applyPingjuTransition(s, '🌀 流局:');
    }
    // フィーバー強制ツモ切り [リョー指示 2026-05-11 + 2026-05-21 全 zimo path 対応]
    // [華 は zimo 時点で huapai に auto 投入済、 北 z4 は innerDiscard 内で declareNukiBei 自動変換]
    // helper 化、 全 zimo path から呼出統一 [漏れ防止]
    const sAfterFever = applyFeverAutoTsumokiri(s);
    if (sAfterFever !== s) return sAfterFever;
    // フィーバー中の待ち牌残り計算 [debug 用、 計算結果は表示のみ]
    const feverP = ([0, 1, 2] as const).find((p) => s.game.feverActive[p]);
    if (feverP !== undefined && !s.roundEnded) {
      const ting = s.game.getTingpaiList(feverP);
      const visibleAll = (ss: string, nn: number): number => {
        let n = 0;
        for (const p of [0, 1, 2] as const) {
          const psp = s.game.shoupai.get(p);
          if (psp) {
            n += psp._bingpai?.[ss]?.[nn] ?? 0;
            for (const m of psp._fulou ?? []) {
              const stripped = (m as string).replace(/[\+=\-_*]/g, '');
              const suit = stripped[0];
              if (suit !== ss) continue;
              for (const d of stripped.slice(1).replace(/0/g, '5')) {
                if (`${suit}${d}` === ss + nn) n++;
              }
            }
          }
          const phe = s.game.he.get(p);
          if (phe?._pai) {
            for (const d of phe._pai as string[]) {
              const stripped = d.replace(/[\+=\-_*]/g, '');
              if (stripped === ss + nn) n++;
            }
          }
        }
        for (const b of s.game.shan.baopai ?? []) {
          if (b === ss + nn) n++;
        }
        return n;
      };
      const totalRemain = ting
        .filter((t) => toCorePai(t) !== 'z5')
        .reduce((acc, t) => {
          const ss = t[0]; const nn = parseInt(t[1] === '0' ? '5' : t[1]);
          return acc + Math.max(0, 4 - visibleAll(ss, nn));
        }, 0);
      dlog('[fever wait]', { feverP, ting, totalRemain, visibleByTile: ting.filter(t => toCorePai(t) !== 'z5').map(t => ({ t, n: visibleAll(t[0], parseInt(t[1] === '0' ? '5' : t[1])) })) });
      // 局終了判定は zimo() が null [山切れ] でのみ行う、 ここでは skip [bug 出やすい]
    }
    s = autoLizhiInline(s);
    return { ...s };
  }
  // 人間 ron 候補が残っている [CPU は ronCandidates にいた場合上で auto-ron 済]
  // R13 P0 #5 fix: ロン全員 pass 後 副露候補 消失 bug fix。 ponCands / kanCands を
  // state に保存 [human 候補のみ]、 pass() 経由で全員 ron pass 後 awaitingFulou に遷移
  enterRonDecisionStage(s, {
    ponCandidates: ponCands.filter((c) => !s.cpu[c.player as 0|1|2]),
    kanCandidates: kanCands.filter((c) => !s.cpu[c.player as 0|1|2]),
  });
  s.message = `ロン可能: player ${ronCandidates.join(',')}`;
  return { ...s };
}

/** リーチ済 player の自動ターン: ツモ和了可なら止める、 z4 / 春夏秋冬は抜く、 待ち不変の暗槓は自動、 そうでなければツモ切り */
export function autoLizhiInline(s: StoreState, safetyMax = 12): StoreState {
  // オンライン時は autoLizhi を skip [各 client が独立に local 進行して desync する、 リョー報告 2026-05-13]
  // リーチ後のツモ切りは host CPU driver か手動 ツモ切り button [後で実装] に任せる
  if (typeof window !== 'undefined' && (window as any).__anmikaOnline) return s;
  let safety = 0;
  while (safety < safetyMax) {
    if (s.roundEnded || s.awaitingRonDecision || s.awaitingFulou) break;
    const player = s.game.lunbanToPlayerId(s.game.state.lunban);
    if (!s.game.lizhi.has(player)) break;
    if (s.game.canTsumo(player)) break;
    // 北 [z4] は河に切らず抜く [春夏秋冬は shan.zimo で skip 済なので考慮不要]
    if (s.lastZimo != null && toCorePai(s.lastZimo) === 'z4' && s.game.canNukiBei(player)) {
      const replacement = s.game.declareNukiBei(player);
      s.lastZimo = replacement ?? null;
      s.message = `[自動北抜き] player ${player}`;
      if (replacement == null) {
        // 2026-05-14 codex review P2 fix: 自動北抜きでの王牌枯渇 流局も applyPingjuTransition
        s = applyPingjuTransition(s, `🌀 流局 [自動北抜きで王牌枯渇]:`);
        break;
      }
      safety++;
      continue;
    }
    // リーチ後 暗槓 [getKanCandidates が wait-preserving のみ返す前提、 majiang-core
    // rule リーチ後暗槓 level=2 で 待ち不変のみ filter される]
    const kanCands = s.game.getKanCandidates(player);
    if (kanCands.length > 0) {
      dlog('[auto kan inline]', { player, mianzi: kanCands[0], baopaiBefore: [...s.game.shan.baopai] });
      const replacement = s.game.declareKan(player, kanCands[0]);
      if (replacement) {
        s.lastZimo = replacement;
        s.message = `[自動カン] player ${player} 暗槓 [${kanCands[0]}]`;
        safety++;
        continue;
      }
    }
    // shoupai._zimo を真の判定基準に [P0-6b fix、 lastZimo は state ずれ する可能性]
    const sp = s.game.shoupai.get(player);
    if (!sp?._zimo) break;
    // _zimo が mianzi [length>2、 副露後] の場合は そのままは切れない、 break
    if (typeof sp._zimo !== 'string' || sp._zimo.length > 2) break;
    s = innerDiscard(s, sp._zimo);
    if ((s as any)._lastDapaiFailed) break;
    safety++;
  }
  return s;
}

/** 流局結果 [アンミカ三麻、 ノーテン罰符なし、 2026-05-23 audit]
 * - 流し役満 check [河 全ヤオ + 副露されてない + 立直してない] のみ点数移動あり
 * - 通常流局はテンパイ/ノーテンに関わらず点数移動なし
 */
/** 流局成立時の helper: snapshot 保存 + 流し役満 apply + pendingPingju 設定
 *  [リョー指示 2026-05-12: agari panel 内で 点数移動表示できるよう apply を 前倒し] */
export function applyPingjuTransition(s: StoreState, msgPrefix: string = ''): StoreState {
  saveHuleSnapshot(s.game);
  const { message, nagashiWinner } = computePingjuResult(s.game);
  s.message = msgPrefix ? `${msgPrefix} ${message}` : message;
  s.pendingPingju = true;
  s.roundEnded = true;
  // R9 P1 #10 fix: 流し役満は本役満ツモ扱い、 lastWinner を set [親流れ / 連荘 / 局結果表示 に反映]
  if (nagashiWinner !== null) {
    s.lastWinner = nagashiWinner;
    s.lastHuleResult = {
      hupai: [{ name: '流し役満', fanshu: '*' }],
      damanguan: 1,
      fanshu: undefined,
      defen: 8000,
      chipBreakdown: [],
      chipTotal: 0,
    } as any;
  }
  return s;
}

// R9 P1 #10 fix: 流し役満 winner も返す形に
function computePingjuResult(g: Game3): { message: string; nagashiWinner: number | null } {
  const message = computePingjuMessage(g);
  const m = message.match(/流し役満 \[player (\d)\]/);
  const nagashiWinner = m ? parseInt(m[1], 10) : null;
  return { message, nagashiWinner };
}

function computePingjuMessage(g: Game3): string {
  const feverWonAny = ([0, 1, 2] as const).some((p) => g.feverWinCount[p] > 0);
  // 流し役満 check: 各 player の河が全ヤオ牌 [1/9/字] + 副露されてない + 立直してない + フィーバー成立中じゃない
  const isYao = (pai: string) => {
    const stripped = pai.replace(/[\+=\-_*]/g, '');
    if (stripped[0] === 'z') return true;
    const n = parseInt(stripped[1] === '0' ? '5' : stripped[1]);
    return n === 1 || n === 9;
  };
  for (const p of [0, 1, 2] as const) {
    const heDbg = g.he.get(p);
    const hePaiDbg = heDbg?._pai ?? [];
    const allYaoDbg = (hePaiDbg as string[]).every((d: string) => isYao(d));
    const noFulouDbg = (hePaiDbg as string[]).every((d: string) => !d.match(/[\+=\-]$/));
    dlog('[流し役満 check]', { player: p, hePaiLen: hePaiDbg.length, hePaiSample: hePaiDbg.slice(0, 6), allYao: allYaoDbg, noFulou: noFulouDbg, lizhi: g.lizhi.has(p), feverActive: { ...g.feverActive } });
    if (g.lizhi.has(p)) continue;
    const someoneFever = ([0, 1, 2] as const).some((q) => g.feverActive[q]);
    if (someoneFever) continue; // フィーバー中は流し役満不成立 [ルール 5-5]
    const he = g.he.get(p);
    if (!he?._pai || he._pai.length === 0) continue;
    const allYao = (he._pai as string[]).every((d: string) => isYao(d));
    const noFulou = (he._pai as string[]).every((d: string) => !d.match(/[\+=\-]$/));
    if (allYao && noFulou) {
      // 流し役満: 本役満ツモ扱い [chip +5 オール + 役満点 加算]
      // [リョー指示 2026-05-11: chip だけでなく defen も役満点で動かす]
      g.chipLedger[p] += 10;
      g.chipLedger[((p + 1) % 3) as PlayerId] -= 5;
      g.chipLedger[((p + 2) % 3) as PlayerId] -= 5;
      // 役満ツモ 点数: 現親なら 8000 オール [合計 16000]、 子なら 4000/4000/8000 [親 8000 + 子 4000] = 16000
      // 2026-05-14 Round 2 codex fix P1 #6: 流し役満 親子 payment を currentOya 判定に
      const currentOyaSeat = g.currentOya;
      const isOya = p === currentOyaSeat;
      if (isOya) {
        for (const q of [0, 1, 2] as PlayerId[]) {
          if (q === p) continue;
          g.state.defen[q] -= 16000;
          g.state.defen[p] += 16000;
        }
      } else {
        for (const q of [0, 1, 2] as PlayerId[]) {
          if (q === p) continue;
          const pay = q === currentOyaSeat ? 16000 : 8000;
          g.state.defen[q] -= pay;
          g.state.defen[p] += pay;
        }
      }
      return `🌊 流し役満 [player ${p}]、 役満ツモ + chip +5 オール`;
    }
  }
  if (feverWonAny) return '流局 [フィーバーアガリ済]';
  // アンミカルール [2026-05-23 audit、 codex CRITICAL [5]]: ノーテン流局は存在しないため
  // テンパイ/ノーテンによる点数移動はなし。 表示用に判定だけ残す。
  const tenpai: number[] = [];
  for (const p of [0, 1, 2] as const) {
    if (g.xiangting(p) === 0) tenpai.push(p);
  }
  if (tenpai.length === 3) return '流局 [全員テンパイ、 点数移動なし]';
  if (tenpai.length === 0) return '流局 [全員ノーテン、 点数移動なし]';
  return `流局 [テンパイ p${tenpai.join(',')}、 点数移動なし]`;
}

export const game = createGameStore();

export function pushCutin(id: CutinId, seat?: PlayerId): void {
  game.enqueueCutin(id, seat);
}
