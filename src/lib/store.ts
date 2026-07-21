
// Svelte store wrapper for Game3
import { writable, get } from 'svelte/store';
import Majiang from '@kobalab/majiang-core';
import { Game3, buildShoupai, isGoldPai, pochiColorFromPai } from './game3';
import type { PlayerId } from './types';
import { dlog, toCorePai } from './helpers';
import { resolveNukiBeiMeta } from './game3/bei';
import { buildStateFromPaifu } from './store/paifuIo';
import { buildDebugState } from './store/debug';
import { cpuStepImpl, autoAdvanceImpl } from './store/cpuActions';
import { shouldSkipPonForFever } from './store/cpuFever';
import { Shan3, generateTilePool, defaultSanmaRule } from './shan3';
import { declareKanImpl, ponImpl, damingangImpl } from './store/fulouActions';
import { hasGoldKita } from './game3/gold';
import { evaluateWinPoints } from './game3/settlement';
import type { LizhiPendingFlags } from './lizhiUi';
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
  type PendingKamiPochi,
  type PendingKinpei,
  type PendingPochiSwap,
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
  /** 宣言牌待ち中に選んだリーチ種別。オンライン同期後もUIと候補制限を一致させる。 */
  lizhiPendingFlags?: LizhiPendingFlags | null;
  _lizhiOpen?: boolean;
  _lizhiShuvari?: boolean;
  _lizhiFever?: boolean;
  // R4 P1 #10 fix: ダブロン後の 金北再選択で CPU 他 winner 分の hule 適用が消える bug 対応。
  // pendingKinpei に otherWinners を保持して、 selectKinpei で restoreSnapshot 後に
  // 全 winner [winner + otherWinners] を再 hule + applyHule する
  // R8 P0 #1 fix: 冬modal → 金北 modal 経由で humanOthers [人間ダブロン候補] も保持、
  // selectKinpei finalize で 残 human 候補が居れば awaitingRonDecision 維持
  pendingKinpei: PendingKinpei | null;
  // R7 P0 #3 fix: 冬 modal 経由でも human ダブロン候補を保持、 selectFuyu で 救済可能に
  pendingFuyu: PendingFuyu | null;
  /** ドラ表示・冬めくり中に出た正ぽっちの任意牌選択待ち。 */
  pendingKamiPochi: PendingKamiPochi | null;
  /** 白ぽっち／でかぽっちで祝儀期待値が同率になった高目候補の選択待ち。 */
  pendingPochiSwap: PendingPochiSwap | null;
  pendingFeverContinue: PendingFeverContinue | null; // フィーバー中 アガリ後の 「続行」 ボタン待ち
  pendingPingju: boolean; // 流局成立、 「次局へ」 で 判定フェーズ [流し役満 / tenpai 罰符] を apply 待ち [リョー指示 2026-05-11]
  // R9 P1 #7 fix: 加槓 後の 槍槓 ron window 中の deferred state、 全員 pass で declareKan 実行
  pendingQianggang: PendingQianggang | null;
  /** 北抜きに対する字一色・四喜和・国士ロンの反応窓。 */
  pendingNukiBei?: { player: PlayerId; meta?: { gold?: boolean } } | null;
  /** サイコロチャンス [出目当て] modal 表示中 [MVP、 アガリ時の saiKoroChances を順に処理]
   *  chances: result.saiKoroChances [push 順]、 currentIdx: 現在処理中 index、
   *  selectedCombo: 宣言した出目 [小さい方 / 大きい方]、 rolls: 4 回ぶんの結果 */
  pendingSaiKoro: PendingSaiKoro | null;
  /** solo: CPU 和了のサイコロ進行を人間の確認まで止める [2026-07-16 リョー指示] */
  cpuWinAck: boolean;
  /** スタンプ popup [seat ごと最新 1 つ、 ts で fade 判定]
   *  game state 副作用なし、 reload で復元しない [_action_log にも入らない] */
  stamps: Record<PlayerId, { id: StampId; ts: number } | null>;
  /** カットイン演出 [全画面 1 枚、 queue で順次再生] */
  cutin: CutinPayload | null;
  cutinQueue: CutinPayload[];
  /** WSA: online replay mode — canonical store uses this instead of window.__anmikaOnline */
  _onlineMode?: boolean;
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

type WinChoiceContext = {
  winner: PlayerId;
  isRon: boolean;
  ronfrom: PlayerId | null;
};

type PreSettlementChoiceResolution = {
  result: any;
  pending: boolean;
};

/** A pre-settlement choice rewinds hule(), then re-enters the ordinary win
 * action after the choice is recorded.  Keep the reaction window replayable
 * and remove only this claimant from the duplicate-submit guard. */
function prepareWinChoiceReplay(s: StoreState, context: WinChoiceContext): void {
  s.game.snapshotLocked = false;
  s.roundEnded = false;
  if (context.isRon) {
    s.ronDeclaredPlayers = (s.ronDeclaredPlayers ?? []).filter((player) => player !== context.winner);
    continueRonDecisionStage(s);
    return;
  }
  s.lastWinner = null;
  s.lastHuleResult = null;
  s.ronResults = [];
}

/**
 * Resolve the two choices that must be fixed before point/chip settlement:
 * a positive pochi used as a dora indicator, and a tied all-mighty pochi high.
 * hule() may reveal a new indicator through Autumn, so this runs after hule and
 * rewinds to the pre-hule snapshot before asking the decision owner.
 */
export function resolvePreSettlementPochiChoices(
  s: StoreState,
  initialResult: any,
  context: WinChoiceContext,
  recalculate: () => any,
): PreSettlementChoiceResolution {
  let result = initialResult;
  // リョー裁定 2026-07-21: 神ぽっち target は局中固定せず和了ごとに現手牌から再計算する。
  // 旧実装は target===null の occurrence だけ選んでいた [=一度確定したら次局まで固定]。
  // 前回和了 [同一 FEVER 続行] の確定値や snapshot 復元で戻った残骸が残っていても、
  // この和了で見えている全 occurrence を毎回選び直す。今回の処理済みは resolvedKeys で
  // 追跡する [restoreSnapshot が旧 choice を復活させるため choice 側の null では判定しない]。
  const resolvedKeys = new Set<string>();
  // guard: 旧 16。全 occurrence を毎回選び直す方式で iteration が occurrence 総数
  // [表+裏+秋追加表示] に比例するようになったため余裕を持たせる
  for (let guard = 0; guard < 32; guard++) {
    const occurrence = s.game.getKamiPochiDoraOccurrences(context.winner)
      .find((candidate) => !resolvedKeys.has(candidate.key));
    if (occurrence) {
      resolvedKeys.add(occurrence.key);
      const candidates = s.game.getKamiPochiCandidates('dora');
      s.game.restoreSnapshot();
      // リョー裁定 2026-07-20: 神ぽっちは選択モーダルを出さず常に自動高め取り。
      // 勝者手牌の最多牌をドラに取るのが最高打点 [indicator は scoring 側が
      // doraIndicatorOf で逆引きする]。人間/CPU で分岐しない。
      const sp = s.game.shoupai.get(context.winner);
      const most = sp ? s.game.mostCommonPaiInHand(sp, { player: context.winner }) : null;
      const target = most && candidates.includes(most) ? most : candidates[0];
      s.game.kamiPochiDoraChoices[context.winner][occurrence.key] = target;
      saveHuleSnapshot(s.game);
      result = recalculate();
      if (!result) return { result: null, pending: false };
      continue;
    }

    const swap = result?._pochiSwapPending as PendingPochiSwap | undefined;
    if (swap) {
      const decisionOwners = Array.isArray(swap.decisionOwners)
        ? [...swap.decisionOwners]
        : s.game.pochiDecisionOwners(context.winner);
      const needsHumanDecision = decisionOwners.some((owner) => !s.cpu[owner as PlayerId]);
      if (needsHumanDecision) {
        s.game.restoreSnapshot();
        s.pendingPochiSwap = {
          winner: context.winner,
          kind: swap.kind,
          candidates: swap.candidates.map((candidate) => ({ ...candidate })),
          decisionOwners,
          decisionOwnerIndex: 0,
          isRon: context.isRon,
          ronfrom: context.ronfrom,
        };
        prepareWinChoiceReplay(s, context);
        s.message = `🀄 高目が同率です: ${swap.candidates.map((candidate) => candidate.target).join(' / ')}`;
        return { result, pending: true };
      }
      const target = swap.candidates[0]?.target;
      if (target) s.game.setPochiSwapChoice(context.winner, target, swap.candidates);
      delete result._pochiSwapPending;
    }
    return { result, pending: false };
  }
  throw new Error('神ぽっち選択の再計算回数が上限を超えました');
}

function resultForWinner(s: StoreState, winner: PlayerId): any | null {
  return s.ronResults.find((entry) => entry.player === winner)?.result
    ?? (s.lastWinner === winner ? s.lastHuleResult : null);
}

function syncFuyuResult(s: StoreState, winner: PlayerId): void {
  const result = resultForWinner(s, winner);
  const reveal = s.game.fuyuRevealState[winner];
  if (!result || !reveal) return;
  result.fuyuLog = reveal.fuyuLog.map((entry) => ({ ...entry }));
  result.fuyuKamiPochiPending = reveal.pendingChoice ? { ...reveal.pendingChoice } : null;
}

/** Resolve each physical positive pochi revealed by Winter automatically.
 * リョー裁定 2026-07-20: 神ぽっちは人間にもモーダルを出さず自動高め取り
 * [現物で一番多い牌に取る。華込み]。 */
export function enterFuyuKamiPochiStage(s: StoreState, context: WinChoiceContext): boolean {
  const winners = context.isRon && s.ronResults.length > 0
    ? s.ronResults.map((entry) => entry.player as PlayerId)
    : [context.winner];
  for (const winner of winners) {
    for (let guard = 0; guard < 64; guard++) {
      const pending = s.game.getPendingFuyuKamiPochi(winner);
      if (!pending?.occurrenceKey) break;
      const best = s.game.bestFuyuKamiPochiTarget(winner);
      const pick = pending.candidates.includes(best) ? best : pending.candidates[0];
      const advance = s.game.resumeFuyuKamiPochi(winner, pending.occurrenceKey, pick);
      if (!advance) throw new Error('冬の神ぽっち自動選択に失敗しました');
      syncFuyuResult(s, winner);
      if (advance.status === 'complete') break;
    }
  }
  return false;
}

/**
 * 加槓の槍槓反応窓 [R9 P1 #7 → 2026-07-21 監査 D-04 fix で human/CPU 共通化]。
 * mianzi が加槓 pattern なら他家ロン可否を確認し、
 * - 人間候補あり → pendingQianggang + awaitingRonDecision で判断待ち [handled]
 * - CPU 候補のみ → 即 auto-ron で槍槓成立 [handled] / 全役なしなら通常進行へ
 * - 候補なし / 暗槓 → handled=false [呼び出し側が declareKanImpl へ進む]
 * 旧実装は store action [人間] 専用で、CPU の自動加槓 [cpuStepImpl] は
 * game.declareKan 直呼びで窓を作らず槍槓を迂回していた。
 */
export function processKakanQianggangWindow(
  s: StoreState,
  mianzi: string,
): { s: StoreState; handled: boolean } {
  const isKakan = !!mianzi.match(/^[mpsz]\d{3}[\+\=\-]\d$/);
  if (!isKakan) return { s, handled: false };
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
      s.game.restoreSnapshot();
      if (hasGoldKita(s.game, p as PlayerId)) {
        s.game.autoResolveKinpei(p as any);
        saveHuleSnapshot(s.game);
      }
      let r = s.game.hule(p as any, kakanPai, player as any);
      if (r) {
        const choice = resolvePreSettlementPochiChoices(
          s,
          r,
          { winner: p as PlayerId, isRon: true, ronfrom: player as PlayerId },
          () => s.game.hule(p as PlayerId, kakanPai, player as PlayerId),
        );
        if (choice.pending) return { s, handled: true };
        r = choice.result;
      }
      if (r) {
        ronResults.push({ player: p, result: r });
      }
    }
    s.game.qianggangPending = false;
    if (ronResults.length > 0) {
      const settledRonResults = settleRonResultsInKamichaOrder(
        s.game,
        player as PlayerId,
        ronResults,
      );
      const oya = s.game.currentOya;
      const oyaWon = settledRonResults.find(r => r.player === oya);
      s.lastWinner = oyaWon ? oyaWon.player : settledRonResults[settledRonResults.length - 1].player;
      s.lastHuleResult = settledRonResults[settledRonResults.length - 1].result;
      s.ronResults = settledRonResults;
      if (enterFuyuKamiPochiStage(s, {
        winner: s.lastWinner as PlayerId,
        isRon: true,
        ronfrom: player as PlayerId,
      })) {
        return { s, handled: true };
      }
      // R18 #4 fix: CPU 槍槓 ロンも fever 継続対応 [旧 roundEnded=true 固定で fever 抜け]
      const winnerSeatQ = s.lastWinner as PlayerId;
      settleAfterWin(s, { winner: winnerSeatQ, isRon: true, ronfrom: player as PlayerId });
      s.message = `🎉 CPU 槍槓 ron: ${settledRonResults.map(r => `p${r.player}`).join('/')}`;
      for (const rr of settledRonResults) {
        s = enqueueCutinState(s, 'ron', rr.player as PlayerId);
        s = triggerSaiKoroIfAny(s, rr.result, rr.player);
      }
      return { s, handled: true };
    }
    // 全 CPU 役なしで ron 失敗 → 加槓 通常進行
  }
  if (humanRonCands.length > 0) {
    enterQianggangStage(s, { player, mianzi, kakanPai });
    s.lastDapai = { player, pai: kakanPai };
    enterRonDecisionStage(s);
    s.message = `🎯 加槓 [${mianzi}] → 槍槓 ron 候補 p${humanRonCands.join('/')} の判断待ち`;
    return { s, handled: true };
  }
  // ron 候補なし → 通常 declareKanImpl に進む [qianggangPending は declareKan 内で再 set]
  s.game.qianggangPending = false;
  return { s, handled: false };
}

function hasPostWinDecision(s: StoreState): boolean {
  return !!(s.pendingFuyu || s.pendingKinpei || s.pendingKamiPochi || s.pendingPochiSwap
    || s.pendingSaiKoro || s.pendingFeverContinue);
}

/** 誰かのフィーバー中で、自分がフィーバー宣言者でない [= ツモ切り強制] か。
 *  App 側の自動ツモ切り token と操作ガイド表示が共用する
 *  [2026-07-21 リョー報告 stuck dump: フィーバー中の人間手番が手動ツモ切り待ちで
 *   止まって見える。他の牌タップは強制ルールで無言無視のため実質進行不能に見えた]。 */
export function isFeverForcedTsumogiri(s: StoreState, player: PlayerId): boolean {
  const someoneFever = ([0, 1, 2] as PlayerId[]).some((p) => s.game.feverActive[p]);
  return someoneFever && !s.game.feverActive[player];
}

function isLiveTurnActionBlocked(s: StoreState, allowLizhiDiscard = false): boolean {
  return s.roundEnded
    || s.pendingPingju
    || s.awaitingRonDecision
    || s.awaitingFulou
    || s.pendingQianggang !== null
    || s.pendingNukiBei != null
    || hasPostWinDecision(s)
    || (!allowLizhiDiscard && s.lizhiPending !== null);
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
    pendingKamiPochi: null,
    pendingPochiSwap: null,
    pendingFeverContinue: null,
    pendingPingju: false,
      pendingQianggang: null,
    pendingNukiBei: null,
    pendingSaiKoro: null,
    cpuWinAck: true,
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

  const cloneWire = <T>(value: T): T => {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value)) as T;
  };

  /**
   * Restore a seat-scoped server projection without ever reconstructing the
   * hidden wall or another player's concealed tiles.  Accepted online
   * commands are authoritative state transitions; the local reducer is not a
   * source of truth because masked draws cannot be replayed deterministically.
   */
  function hydrateProjectionState(projection: any): boolean {
    try {
      if (!projection || projection.schemaVersion !== 1) return false;
      if (myOnlineSeat === null || projection.recipientSeat !== myOnlineSeat) return false;
      if (!projection.gameState || !projection.shan || !projection.fields || !projection.store) return false;
      if (!projection.privateHand || !projection.publicHands || !projection.rivers) return false;

      const current = get(store) as StoreState;
      const ng = new Game3({
        shanRule: current.game.shanRule,
        qijia: projection.gameState.qijia,
        startingDefen: current.game.startingDefen,
        changshu: current.game.changshu,
      });
      ng.state = cloneWire(projection.gameState);
      ng.shan = Shan3.createBlind({
        rule: ng.shanRule,
        baopai: cloneWire(projection.shan.baopai ?? []),
        fubaopai: projection.shan.fubaopai == null ? null : cloneWire(projection.shan.fubaopai),
        paishu: Number(projection.shan.paishu ?? 0),
        kanDoraCount: Number(projection.shan.kanDoraCount ?? 0),
        canDrawRinshan: typeof projection.shan.canDrawRinshan === 'boolean'
          ? projection.shan.canDrawRinshan
          : undefined,
      });
      ng.shan.rinshanUsed = Number(projection.shan.rinshanUsed ?? 0);
      (ng.shan as any)._fuyuRevealed = cloneWire(projection.shan.fuyuRevealed ?? []);

      const restoreHand = (serialized: any): any => {
        if (!serialized?.bingpai) throw new Error('online projection hand missing bingpai');
        const bp = serialized.bingpai;
        const numericArray = (value: unknown, minLength: number): number[] => {
          if (!Array.isArray(value) || value.length < minLength) throw new Error('online projection invalid bingpai');
          const out = value.map((n) => Number(n));
          if (out.some((n) => !Number.isInteger(n) || n < 0 || n > 4)) throw new Error('online projection invalid tile count');
          return out;
        };
        const sp = buildShoupai([]);
        sp._bingpai = {
          _: Number(bp._ ?? 0),
          m: numericArray(bp.m, 10),
          p: numericArray(bp.p, 10),
          s: numericArray(bp.s, 10),
          z: numericArray(bp.z, 8),
        };
        if (!Number.isInteger(sp._bingpai._) || sp._bingpai._ < 0 || sp._bingpai._ > 14) {
          throw new Error('online projection invalid hidden count');
        }
        if (bp.anmika && typeof bp.anmika === 'object') {
          sp._bingpai.__anmika = cloneWire(bp.anmika);
          for (const [pai, count] of Object.entries(bp.anmika)) {
            const n = Number(count);
            if (!Number.isInteger(n) || n < 0 || n > 1) throw new Error(`online projection invalid ${pai} count`);
            sp._bingpai[pai] = n;
          }
        }
        sp._fulou = cloneWire(serialized.fulou ?? []);
        sp._zimo = serialized.zimo ?? null;
        sp._anmikaZimo = serialized.anmikaZimo ?? null;
        sp._anmikaFulou = cloneWire(serialized.anmikaFulou ?? []);
        sp._anmikaFulouPhysical = cloneWire(serialized.anmikaFulouPhysical ?? []);
        return sp;
      };

      const restorePublicHand = (value: any): any => {
        if (value?.revealedHand) return restoreHand(value.revealedHand);
        const revealedWaitTiles = Array.isArray(value?.revealedWaitTiles)
          ? value.revealedWaitTiles.filter((pai: unknown) => typeof pai === 'string')
          : [];
        const count = Number(value?.concealedCount ?? 0);
        if (!Number.isInteger(count) || count < 0 || count > 14 || revealedWaitTiles.length > count) {
          throw new Error('online projection invalid concealed count');
        }
        const sp = buildShoupai(revealedWaitTiles);
        sp._bingpai._ = count - revealedWaitTiles.length;
        sp._fulou = cloneWire(value?.fulou ?? []);
        sp._anmikaFulou = cloneWire(value?.anmikaFulou ?? []);
        sp._anmikaFulouPhysical = cloneWire(value?.anmikaFulouPhysical ?? []);
        // A hidden draw still has to keep the public turn phase out of the
        // "needs draw" state.  Its face never enters this client.
        sp._zimo = value?.pseudoZimo ?? (value?.hasZimo ? '__hidden_draw__' : null);
        sp._anmikaZimo = null;
        return sp;
      };

      ng.shoupai = new Map();
      for (const player of [0, 1, 2] as const) {
        const serialized = player === myOnlineSeat
          ? projection.privateHand
          : projection.publicHands[player] ?? projection.publicHands[String(player)];
        ng.shoupai.set(player, player === myOnlineSeat ? restoreHand(serialized) : restorePublicHand(serialized));
      }
      ng.he = new Map();
      for (const player of [0, 1, 2] as const) {
        const he = new Majiang.He();
        const river = projection.rivers[player] ?? projection.rivers[String(player)] ?? [];
        if (!Array.isArray(river)) throw new Error('online projection invalid river');
        (he as any)._pai = cloneWire(river);
        ng.he.set(player, he);
      }
      ng.events = cloneWire(projection.publicEvents ?? []);

      const fields = projection.fields as Record<string, any>;
      for (const [field, value] of Object.entries(fields)) {
        if (field === 'lizhi' || field === 'doubleLizhi' || field === 'openLizhi') {
          (ng as any)[field] = new Set(Array.isArray(value) ? value : []);
        } else if (field === 'firstTurnState') {
          ng.restoreFirstTurnState(value);
        } else {
          (ng as any)[field] = cloneWire(value);
        }
      }

      // Keep the Game3 object identity stable so animation observers do not
      // replay every historical draw after each authoritative update.
      Object.assign(current.game as any, ng as any);
      const wireStore = projection.store as Record<string, any>;
      const next: StoreState = {
        ...current,
        game: current.game,
        lastZimo: wireStore.lastZimo ?? null,
        lastDapai: cloneWire(wireStore.lastDapai ?? null),
        lastWinner: wireStore.lastWinner ?? null,
        lastHuleResult: cloneWire(wireStore.lastHuleResult ?? null),
        awaitingRonDecision: !!wireStore.awaitingRonDecision,
        ronPassedPlayers: cloneWire(wireStore.ronPassedPlayers ?? []),
        ronDeclaredPlayers: cloneWire(wireStore.ronDeclaredPlayers ?? []),
        ronResults: cloneWire(wireStore.ronResults ?? []),
        awaitingFulou: !!wireStore.awaitingFulou,
        ponCandidates: cloneWire(wireStore.ponCandidates ?? []),
        kanCandidates: cloneWire(wireStore.kanCandidates ?? []),
        roundEnded: !!wireStore.roundEnded,
        message: wireStore.message ?? null,
        cpu: cloneWire(wireStore.cpu ?? current.cpu),
        lizhiPending: wireStore.lizhiPending ?? null,
        lizhiPendingFlags: cloneWire(wireStore.lizhiPendingFlags ?? null),
        _lizhiOpen: wireStore._lizhiOpen === true,
        _lizhiShuvari: wireStore._lizhiShuvari === true,
        _lizhiFever: wireStore._lizhiFever === true,
        pendingKinpei: cloneWire(wireStore.pendingKinpei ?? null),
        pendingFuyu: cloneWire(wireStore.pendingFuyu ?? null),
        pendingKamiPochi: cloneWire(wireStore.pendingKamiPochi ?? null),
        pendingPochiSwap: cloneWire(wireStore.pendingPochiSwap ?? null),
        pendingFeverContinue: cloneWire(wireStore.pendingFeverContinue ?? null),
        pendingPingju: !!wireStore.pendingPingju,
        pendingQianggang: cloneWire(wireStore.pendingQianggang ?? null),
        pendingNukiBei: cloneWire(wireStore.pendingNukiBei ?? null),
        pendingSaiKoro: cloneWire(wireStore.pendingSaiKoro ?? null),
        cpuWinAck: wireStore.cpuWinAck !== false,
        _onlineMode: true,
      };
      // Candidate identity remains private, but tests/debug views may consume
      // this self-only list when supplied by the projection.
      (next as any).ronCandidates = cloneWire(wireStore.ronCandidates ?? []);
      set(next);
      return true;
    } catch (error) {
      dlog('[online-projection-reject]', error);
      return false;
    }
  }

  function finishAfterFuyuKamiPochi(s: StoreState, context: WinChoiceContext): StoreState {
    if (enterFuyuKamiPochiStage(s, context)) return s;
    const results = context.isRon && s.ronResults.length > 0
      ? s.ronResults
      : (s.lastHuleResult ? [{ player: context.winner, result: s.lastHuleResult }] : []);
    for (const entry of results) {
      syncFuyuResult(s, entry.player as PlayerId);
      if (entry.result?._anmikaPostWinEffectsQueued) continue;
      if (!entry.result?._anmikaRonEffectsQueued) {
        s = enqueueCutinState(s, context.isRon ? 'ron' : 'tsumo', entry.player as PlayerId);
        s = triggerSaiKoroIfAny(s, entry.result, entry.player);
      }
      entry.result._anmikaPostWinEffectsQueued = true;
      if (s.pendingSaiKoro && s.cpu[entry.player as PlayerId]) s.cpuWinAck = false;
    }
    if (context.isRon) finishRonDecisionStage(s);
    settleAfterWin(s, {
      winner: (s.lastWinner ?? context.winner) as PlayerId,
      isRon: context.isRon,
      ronfrom: context.ronfrom,
    });
    s.message = `${s.message ?? ''} [神ぽっち選択確定]`.trim();
    return s;
  }

  const api = {
    subscribe,
    /** オンライン対戦 接続 & game init */
    initOnlineGame(opts: {
      ws: WebSocket; qijia: 0|1|2; cpuSeats?: number[]; mySeat?: 0|1|2; isHost?: boolean; hostSeat?: 0|1|2; revision?: number; matchId?: number; roundId?: number;
      preShuffledPool?: string[];
      blindStart?: { hands: Record<0|1|2, string[]>; firstZimo: string; paishu: number; baopai: string[]; fubaopai: string[] | null; canDrawRinshan?: boolean; huapai?: Record<0|1|2, string[]>; goldHand?: Record<0|1|2, {p:number;s:number;z:number}>; pochiHand?: Record<0|1|2, Record<string, number>> };
    }) {
      onlineWs = opts.ws;
      onlineMode = true;
      myOnlineSeat = opts.mySeat ?? null;
      iAmHost = opts.isHost ?? false;
      hostSeat = opts.hostSeat ?? null;
      onlineRevision = opts.revision ?? 0;
      onlineMatchId = opts.matchId ?? 1;
      onlineRoundId = opts.roundId ?? 1;
      if (typeof window !== 'undefined') (window as any).__anmikaOnline = true;
      let ng: Game3;
      let fp: any;
      if (opts.blindStart) {
        const bs = opts.blindStart;
        ng = new Game3({ qijia: opts.qijia });
        ng.shan = Shan3.createBlind({
          rule: ng.shanRule,
          baopai: bs.baopai as any[],
          fubaopai: bs.fubaopai as any[] | null,
          paishu: bs.paishu,
          canDrawRinshan: bs.canDrawRinshan,
        });
        ng.initFromDeal({ hands: bs.hands as any, huapai: bs.huapai as any, goldHand: bs.goldHand as any, pochiHand: bs.pochiHand as any });
        fp = bs.firstZimo;
      } else {
        ng = new Game3({ qijia: opts.qijia, preShuffledPool: opts.preShuffledPool });
        ng.qipai();
        fp = ng.zimo();
      }
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
        pendingKamiPochi: null,
        pendingPochiSwap: null,
        pendingFeverContinue: null,
        pendingPingju: false,
      pendingQianggang: null,
        pendingNukiBei: null,
        pendingSaiKoro: null,
    cpuWinAck: true,
        stamps: { 0: null, 1: null, 2: null },
        cutin: null,
        cutinQueue: [],
        _onlineMode: true,
      });
    },
    setOnlineProtocolState(opts: { ws?: WebSocket; revision: number; matchId: number; roundId: number }) {
      if (opts.ws) onlineWs = opts.ws;
      onlineRevision = opts.revision;
      onlineMatchId = opts.matchId;
      onlineRoundId = opts.roundId;
    },
    /** Apply the server's seat-scoped canonical state. */
    hydrateOnlineProjection(projection: unknown): boolean {
      return hydrateProjectionState(projection);
    },
    getOnlineProtocolState() {
      return { revision: onlineRevision, matchId: onlineMatchId, roundId: onlineRoundId };
    },
    setOnlineReplayMode(enabled: boolean) {
      update((st) => ({ ...st, _onlineMode: enabled }));
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
      if (action?._state) return hydrateProjectionState(action._state);
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
      if (action._draw && s.game.shan.isBlind) {
        const d = action._draw;
        if (d.lastZimo) s.game.shan.feedDraw({ tile: d.lastZimo, huapai: d.huapai ?? [], gold: d.gold ?? false, pochi: d.pochi ?? null, paishu: d.paishu });
        // 1 action で秋ドラを複数組開く場合、実行順は
        // 表1→裏1→表2→裏2。表配列を全件入れてから裏配列を入れると
        // blind 側の drawNewDora(false/true) が別の牌を対応付けてしまう。
        // server が送る物理的な開示順を優先し、旧 payload だけ pairwise fallback する。
        const doraDraws = Array.isArray(d.doraDraws)
          ? d.doraDraws
          : Array.from(
              { length: Math.max(d.newBaopai?.length ?? 0, d.newFubaopai?.length ?? 0) },
              (_, index) => [
                d.newBaopai?.[index] ? { tile: d.newBaopai[index], isFu: false } : null,
                d.newFubaopai?.[index] ? { tile: d.newFubaopai[index], isFu: true } : null,
              ].filter(Boolean),
            ).flat();
        for (const draw of doraDraws) {
          if (draw && typeof draw.tile === 'string') s.game.shan.feedDora(draw.tile);
        }
        if (d.paishu !== undefined && !d.lastZimo) (s.game.shan as any)._blindPaishu = d.paishu;
      }
      isApplyingRemote = true;
      try {
        switch (action.type) {
          // 現手番 action: discard / lizhi / tsumo / declareKan / nukiBei / tsumokiri は
          // sender が現在手番でない 限り reject
          // [2026-07-21 監査 S-01 fix] cpuRelay の from_seat 検証緩和を撤去。server が
          // cpuRelay 受付を廃止し、CPU action は server deadline driver が CPU 席
          // そのものを from_seat にして流すため、通常検証 [from_seat === currentPlayer] で足りる
          case 'discard':
          case 'lizhi':
          case 'tsumo':
          case 'declareKan':
          case 'nukiBei':
          case 'tsumokiri':
          case 'drawNext': {
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
          case 'shuvari': {
            const targetP = action.player ?? from_seat;
            if (from_seat !== targetP) return reject(`shuvari: from_seat ${from_seat} ≠ action.player ${targetP}`);
            if (!s.game.canDeclareLateShuvari(targetP as PlayerId)) return reject(`shuvari: player ${targetP} is outside declaration window`);
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
          case 'selectKamiPochi':
          case 'selectPochiSwap':
          case 'continueFever':
          case 'agariyame': {
            // R6 P2 #11 fix: continueFever は pendingFeverContinue.winner で gate
            const owners = action.type === 'selectFuyu' ? s.pendingFuyu?.decisionOwners
              : action.type === 'selectKinpei' ? s.pendingKinpei?.decisionOwners
              : action.type === 'selectKamiPochi' ? s.pendingKamiPochi?.decisionOwners
              : action.type === 'selectPochiSwap' ? s.pendingPochiSwap?.decisionOwners
              : undefined;
            const expected = action.type === 'selectFuyu' ? s.pendingFuyu?.winner
              : action.type === 'selectKinpei' ? s.pendingKinpei?.winner
              : action.type === 'selectKamiPochi' ? s.pendingKamiPochi?.winner
              : action.type === 'selectPochiSwap' ? s.pendingPochiSwap?.winner
              : action.type === 'continueFever' ? s.pendingFeverContinue?.winner
              : winner;
            if (expected === undefined || expected === null) return reject(`${action.type}: no expected winner`);
            if (owners?.length) {
              if (!owners.includes(from_seat)) return reject(`${action.type}: from_seat ${from_seat} not in decisionOwners ${owners}`);
            } else if (from_seat !== expected) return reject(`${action.type}: from_seat ${from_seat} ≠ winner ${expected}`);
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
          case 'shuvari': (this as any).shuvari(action.player ?? from_seat); break;
          case 'tsumo': (this as any).tsumo(); break;
          case 'ron': (this as any).ron(action.player ?? from_seat); break;
          case 'pass': (this as any).pass(action.player ?? from_seat); break;
          case 'declareKan': (this as any).declareKan(action.mianzi); break;
          case 'nukiBei': (this as any).nukiBei(action.meta); break;
          case 'tsumokiri': (this as any).tsumokiri(); break;
          case 'drawNext': (this as any).drawNext(); break;  // R4 P1 #18
          case 'selectFuyu': (this as any).selectFuyu(action.use); break;
          case 'selectKinpei': (this as any).selectKinpei(action.target); break;
          case 'selectKamiPochi': (this as any).selectKamiPochi(action.target, action.occurrenceKey); break;
          case 'selectPochiSwap': (this as any).selectPochiSwap(action.target); break;
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
      update((st) => ({ ...st, _onlineMode: false }));
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
        try { onlineWs.send(JSON.stringify({ type: 'stamp', stampId })); } catch (_) { /* noop */ }
      }
    },
    /** 打牌 → ロン / ポン候補判定 [CPU 自動応答込み]、 meta で河の色記録 */
    discard(pai: string, meta?: { gold?: boolean; pochi?: 'blue' | 'red' | 'green' | 'yellow' }) {
      if (!checkOnlineGate({ type: 'discard' }, 'currentPlayer')) return;
      if (sendOnlineAction({ type: 'discard', pai, meta })) return;
      update((s) => {
        if (isLiveTurnActionBlocked(s, true)) return { ...s };
        // シュバリ中は見逃し不可 [リョー指示 2026-05-11]。ロンだけでなくツモも同じ扱いで、
        // ツモ和了できる状態の打牌 [= シュバポツモのキャンセル] を reject する
        // [2026-07-20 リョー報告: シュバポツモがキャンセルできてしまっている]。
        // 通常リーチのツモは従来どおり見逃せる [自動ツモ切りが止まるだけ]。
        {
          const turnPlayer = s.game.lunbanToPlayerId(s.game.state.lunban);
          if (s.game.shuvariActive[turnPlayer] && s.game.canTsumo(turnPlayer)) {
            s.message = `p${turnPlayer} はシュバリ中、 見逃し不可。 ツモ宣言してください`;
            return { ...s };
          }
        }
        // リーチ pending 中なら 宣言牌候補チェック + リーチ確定
        if (s.lizhiPending !== null) {
          const player = s.game.lunbanToPlayerId(s.game.state.lunban);
          if (player !== s.lizhiPending) {
            s.message = `リーチ pending 中: player ${s.lizhiPending} の打牌待ち`;
            return { ...s };
          }
          const cands = s.game.getLizhiCandidates(player);
          const norm = (p: string) => p.replace(/[_*]$/, '');
          let physicalPai: string;
          try {
            physicalPai = s.game.resolveDiscardPai(player, pai, meta);
          } catch {
            s.message = `${pai} は手牌にない物理牌です`;
            return { ...s };
          }
          if (!cands.some((c) => norm(c) === physicalPai)) {
            s.message = `${pai} はリーチ宣言牌じゃない、 赤枠の牌から選んで`;
            return { ...s };
          }
          // [2026-07-16 リョー裁定] フィーバー宣言時は fever が成立する牌しか切れない。
          // 旧仕様 [不可牌なら通常リーチへ自動降格] を廃止し、打牌自体を reject する
          // [UI 側も候補をフィーバー成立牌に絞る]
          const isFeverDecl = !!(s as any)._lizhiFever;
          let feverCheckForDeclare: { ok: boolean; tiles: string[]; tier: 1 | 2 | 3 | 4 } | undefined;
          if (isFeverDecl) {
            const feverMap = s.game.feverCandidatesByDapai(player);
            feverCheckForDeclare = feverMap.get(physicalPai);
            if (!feverCheckForDeclare) {
              s.message = `${pai} ではフィーバーが成立しない [7 暗刻を崩さない宣言牌を選んで]`;
              return { ...s };
            }
          }
          // リーチ確定 [defen -1000、 供託 +1、 lizhi.add]
          if (!s.game.declareLizhi({ open: !!(s as any)._lizhiOpen, shuvari: !!(s as any)._lizhiShuvari, fever: isFeverDecl, feverCheck: feverCheckForDeclare, feverDapai: isFeverDecl ? physicalPai : undefined })) {
            s.message = 'リーチ確定失敗';
            s.lizhiPending = null;
            s.lizhiPendingFlags = null;
            s._lizhiOpen = false;
            s._lizhiShuvari = false;
            s._lizhiFever = false;
            return { ...s };
          }
          s.lizhiPending = null;
          s.lizhiPendingFlags = null;
          s._lizhiOpen = false;
          s._lizhiShuvari = false;
          s._lizhiFever = false;
          s = enqueueCutinState(s, isFeverDecl ? 'fever' : 'reach', player as PlayerId);
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
        if (s.roundEnded || hasPostWinDecision(s)) return { ...s };
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
        if (!s.game.canRon(player as any, s.lastDapai.pai, s.lastDapai.player as any)) return { ...s };
        // 北抜き牌へのロンが成立したら補充処理を破棄する。
        if (s.pendingNukiBei) s.pendingNukiBei = null;
        // P0-1: 宣言牌 ron → フィーバー不正立 [リョー指示 2026-05-11]
        //   宣言牌の discarder が feverDeclareDapaiPlayer なら、 fever を undo してから ron 処理
        //   [lizhi 自体は通常通り成立、 ron も通常進行、 fever 倍率のみ消える]
        const fdp = s.game.feverDeclareDapaiPlayer;
        if (fdp !== null && fdp === s.lastDapai.player) {
          s.game.cancelFeverDeclaration(fdp);
          dlog('[fever undone] 宣言牌 ron、 player=', fdp);
        }
        // フィーバー中 + 冬持ち + 自家 → 冬使う / 保留 modal
        const reversePochiDecisionRon = !!(s.game.feverActive[player as 0|1|2]
          && s.game.pochiPaymentMode[player as 0|1|2]);
        const reverseRonHasHumanOwner = reversePochiDecisionRon
          && ([0, 1, 2] as const).some((p) => p !== player && !s.cpu[p]);
        if (s.game.feverActive[player as 0|1|2]
          && s.game.effectiveHuapaiAtHule(player as PlayerId).includes('f4')
          && (!s.cpu[player as 0|1|2] || reverseRonHasHumanOwner)) {
          // [2026-05-15 機能 11] 待ち残山 0 → modal skip で 自動冬使用 [user 選択不要]
          if (s.game.isFeverWaitExhausted(player as 0|1|2) && !reversePochiDecisionRon) {
            s.game.fuyuConsumed[player as 0|1|2] = true;
            s.game.endFever(player as PlayerId);
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
        const reverseDecisionOwnersRon = ([0, 1, 2] as const).filter((p) => p !== player);
        const isFeverPayAuto_ron = reversePochiDecisionRon
          && reverseDecisionOwnersRon.every((p) => s.cpu[p]);
        // snapshot 保存 [後で金北変更時に巻き戻し]
        // [2026-07-21 監査 D-02 fix] snapshotLocked = 先に宣言した claimant の評価が済んで
        // いる再入。この場合は保存 [no-op] ではなく pre-discard snapshot へ巻き戻してから
        // 評価する。旧実装は巻き戻さず、1 人目の秋処理で開いた baopai の上で 2 人目を
        // 採点し、宣言順で翻数・ドラが変わっていた
        if (s.game.snapshotLocked) {
          s.game.restoreSnapshot();
        } else {
          saveHuleSnapshot(s.game);
        }
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
        {
          const choice = resolvePreSettlementPochiChoices(
            s,
            result,
            { winner: player as PlayerId, isRon: true, ronfrom: s.lastDapai.player as PlayerId },
            () => s.game.hule(player as PlayerId, s.lastDapai!.pai, s.lastDapai!.player as PlayerId),
          );
          if (choice.pending) return { ...s };
          result = choice.result;
          if (!result) {
            s.message = `player ${player} 神ぽっち選択後のロン再計算失敗`;
            return { ...s };
          }
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
            // 神ぽっち / 高目選択で再度 restore しても、確定した金北を失わない。
            saveHuleSnapshot(s.game);
            result = s.game.hule(player as any, s.lastDapai.pai, s.lastDapai.player as any);
            if (!result) {
              s.message = `player ${player} 金北自動選択後のロン再計算失敗`;
              return { ...s };
            }
            const choice = resolvePreSettlementPochiChoices(
              s,
              result,
              { winner: player as PlayerId, isRon: true, ronfrom: s.lastDapai.player as PlayerId },
              () => s.game.hule(player as PlayerId, s.lastDapai!.pai, s.lastDapai!.player as PlayerId),
            );
            if (choice.pending) return { ...s };
            result = choice.result;
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
            // WSA: 秋ダブロン対策 — 全 winner を同一 pre-ron snapshot から評価
            s.game.restoreSnapshot();
            if (hasGoldKita(s.game, p as PlayerId)) {
              s.game.autoResolveKinpei(p as any);
              saveHuleSnapshot(s.game);
            }
            let r2 = s.game.hule(p as any, ld.pai, ld.player as any);
            if (r2) {
              const choice = resolvePreSettlementPochiChoices(
                s,
                r2,
                { winner: p as PlayerId, isRon: true, ronfrom: ld.player as PlayerId },
                () => s.game.hule(p as PlayerId, ld.pai, ld.player as PlayerId),
              );
              if (choice.pending) {
                result._anmikaRonSettlementDeferred = true;
                for (const prior of ronResults) prior.result._anmikaRonSettlementDeferred = true;
                s.ronResults = sortRonResultsByKamicha(
                  ld.player as PlayerId,
                  mergeRonResults(s.ronResults, ronResults),
                );
                s.ronDeclaredPlayers = Array.from(new Set([
                  ...(s.ronDeclaredPlayers ?? []),
                  ...ronResults.map((entry) => entry.player),
                ]));
                s.lastWinner = winnerByOya(s.game, s.ronResults);
                s.lastHuleResult = s.ronResults.at(-1)?.result ?? result;
                return { ...s };
              }
              r2 = choice.result;
            }
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
          if (hasGoldKita(s.game, player as PlayerId)
            && (!s.cpu[player as 0|1|2] || reverseRonHasHumanOwner)
            && !isFeverPayAuto_ron && !s.pendingKinpei
            && s.game.kinpeiTarget[player as 0|1|2] === null) {
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
        if (enterFuyuKamiPochiStage(s, {
          winner: player as PlayerId,
          isRon: true,
          ronfrom: ld.player as PlayerId,
        })) {
          s.game.snapshotLocked = false;
          return { ...s };
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
        // 金北持ち + 自家 → アガリ計算後 modal で選択 [リョー指示]
        // ただし フィーバー + 払い [reverse pochi] state なら 自動確定で modal スキップ
        // R7 P1 #6 fix: 金北手牌内 [goldHand.z > 0] も modal 対象、 nukidoraGold だけだと
        // 抜く前の金北で強化選択漏れ
        // 2026-07-15 リョー裁定: 一度選択した適用先は以降変更不可 [保留のみ再選択可]。
        // 選択済み [kinpeiTarget != null] なら modal を開かない [tsumo 側 1677 と同じガード]
        if (hasGoldKita(s.game, player as PlayerId)
          && (!s.cpu[player as 0|1|2] || reverseRonHasHumanOwner)
          && !isFeverPayAuto_ron
          && s.game.kinpeiTarget[player as 0|1|2] === null) {
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
        settleAfterWin(s, { winner: player as PlayerId, isRon: true, ronfrom: s.lastDapai?.player ?? null });
        return { ...s };
      });
    },
    /** フィーバー中 冬使う / 保留 選択 */
    selectFuyu(use: boolean) {
      // 正ぽっちはwinner、逆ぽっちは同卓者側が決定する。
      if (onlineMode && !isApplyingRemote && myOnlineSeat !== null) {
        const s = get(store) as StoreState;
        const owners = s.pendingFuyu?.decisionOwners ?? (s.pendingFuyu ? [s.pendingFuyu.winner] : []);
        if (s.pendingFuyu && !owners.includes(myOnlineSeat)) { dlog('[gate-block]', { type: 'selectFuyu', my: myOnlineSeat, owners }); return; }
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
        {
          const choice = resolvePreSettlementPochiChoices(
            s,
            result,
            { winner: winner as PlayerId, isRon, ronfrom: ronfrom as PlayerId | null },
            () => isRon && ronfrom !== null
              ? s.game.hule(winner as PlayerId, s.lastDapai!.pai, ronfrom as PlayerId)
              : s.game.hule(winner as PlayerId),
          );
          if (choice.pending) return { ...s };
          result = choice.result;
          if (!result) {
            s.message = `player ${winner} 神ぽっち選択後の再計算失敗`;
            return { ...s };
          }
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
          s.lastHuleResult = result;
          s.lastWinner = winner;
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
          saveHuleSnapshot(s.game);
          result = isRon && ronfrom !== null
            ? s.game.hule(winner as any, s.lastDapai!.pai, ronfrom as any)
            : s.game.hule(winner as any);
          if (!result) {
            s.message = `player ${winner} 金北自動選択後の再計算失敗`;
            return { ...s };
          }
          const choice = resolvePreSettlementPochiChoices(
            s,
            result,
            { winner: winner as PlayerId, isRon, ronfrom: ronfrom as PlayerId | null },
            () => isRon && ronfrom !== null
              ? s.game.hule(winner as PlayerId, s.lastDapai!.pai, ronfrom as PlayerId)
              : s.game.hule(winner as PlayerId),
          );
          if (choice.pending) return { ...s };
          result = choice.result;
          if (!result) {
            s.message = `player ${winner} 金北・神ぽっち選択後の再計算失敗`;
            return { ...s };
          }
        }
        // 冬 modal 経由でも全ロン候補を同じ pre-hule snapshot から評価する。
        const ronResults: Array<{ player: number; result: any }> = [{ player: winner, result }];
        if (isRon && ronfrom !== null && s.lastDapai) {
          const ld = s.lastDapai;
          const otherCands = ([0,1,2] as const).filter(p => p !== winner && p !== ld.player && s.game.canRon(p as any, ld.pai, ld.player as any));
          for (const p of otherCands) {
            if (s.cpu[p as 0|1|2]) {
              s.game.restoreSnapshot();
              if (hasGoldKita(s.game, p as PlayerId)) {
                s.game.autoResolveKinpei(p as any);
                saveHuleSnapshot(s.game);
              }
              let r2 = s.game.hule(p as any, ld.pai, ld.player as any);
              if (r2) {
                const choice = resolvePreSettlementPochiChoices(
                  s,
                  r2,
                  { winner: p as PlayerId, isRon: true, ronfrom: ld.player as PlayerId },
                  () => s.game.hule(p as PlayerId, ld.pai, ld.player as PlayerId),
                );
                if (choice.pending) {
                  for (const prior of ronResults) prior.result._anmikaRonSettlementDeferred = true;
                  s.ronResults = sortRonResultsByKamicha(
                    ld.player as PlayerId,
                    mergeRonResults(s.ronResults, ronResults),
                  );
                  s.ronDeclaredPlayers = Array.from(new Set([
                    ...(s.ronDeclaredPlayers ?? []),
                    ...ronResults.map((entry) => entry.player),
                  ]));
                  s.lastWinner = winnerByOya(s.game, s.ronResults);
                  s.lastHuleResult = s.ronResults.at(-1)?.result ?? result;
                  return { ...s };
                }
                r2 = choice.result;
              }
              if (r2) {
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
        if (isRon && ronfrom !== null) {
          const combined = sortRonResultsByKamicha(
            ronfrom as PlayerId,
            mergeRonResults(s.ronResults, ronResults),
          );
          if (fuyuHumans.length > 0) {
            for (const entry of ronResults) entry.result._anmikaRonSettlementDeferred = true;
            s.ronResults = combined;
          } else {
            s.ronResults = settleRonResultsInKamichaOrder(s.game, ronfrom as PlayerId, combined);
          }
        } else {
          s.game.applyHule(result, winner as PlayerId, null);
          s.ronResults = [];
        }
        s.ronDeclaredPlayers = [...(s.ronDeclaredPlayers ?? []), ...ronResults.map(r => r.player).filter(p => !(s.ronDeclaredPlayers ?? []).includes(p))];
        const isFever = s.game.feverActive[winner as 0|1|2];
        const feverNote = isFever ? '🔥 [フィーバー継続中]' : '';
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
        if (enterFuyuKamiPochiStage(s, {
          winner: (s.lastWinner ?? winner) as PlayerId,
          isRon,
          ronfrom: ronfrom as PlayerId | null,
        })) {
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
        settleAfterWin(s, { winner: (s.lastWinner ?? winner) as PlayerId, isRon, ronfrom });
        return { ...s };
      });
    },
    /** 金北 modal で強化対象選択 [target=null は保留] */
    selectKinpei(target: 'haru' | 'natsu' | 'aki' | 'fuyu' | null) {
      // 正ぽっちはwinner、逆ぽっちは同卓者側が決定する。
      if (onlineMode && !isApplyingRemote && myOnlineSeat !== null) {
        const s = get(store) as StoreState;
        const owners = s.pendingKinpei?.decisionOwners ?? (s.pendingKinpei ? [s.pendingKinpei.winner] : []);
        if (s.pendingKinpei && !owners.includes(myOnlineSeat)) { dlog('[gate-block]', { type: 'selectKinpei', my: myOnlineSeat, owners }); return; }
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
        // この snapshot を以後の神ぽっち / 高目 / 冬再計算の基準にする。
        // 選択前 snapshot のままだと restore 時に金北 target が消えてしまう。
        saveHuleSnapshot(s.game);
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
        {
          const choice = resolvePreSettlementPochiChoices(
            s,
            result,
            { winner: winner as PlayerId, isRon, ronfrom: ronfrom as PlayerId | null },
            () => isRon && ronfrom !== null
              ? s.game.hule(winner as PlayerId, s.lastDapai!.pai, ronfrom as PlayerId)
              : s.game.hule(winner as PlayerId),
          );
          if (choice.pending) return { ...s };
          result = choice.result;
          if (!result) {
            s.message = `player ${winner} 金北・神ぽっち選択後の再計算失敗`;
            return { ...s };
          }
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
        // 金北を選んだ winner と他のCPU winnerを同じ pre-ron snapshot から再計算する。
        const allResults: Array<{ player: number; result: any }> = [{ player: winner, result }];
        for (const ow of otherWinners) {
          s.game.restoreSnapshot();
          if (hasGoldKita(s.game, ow as PlayerId)) {
            s.game.autoResolveKinpei(ow as any);
            saveHuleSnapshot(s.game);
          }
          let r2 = isRon && ronfrom !== null
            ? s.game.hule(ow as any, s.lastDapai!.pai, ronfrom as any)
            : s.game.hule(ow as any);
          if (r2) {
            const choice = resolvePreSettlementPochiChoices(
              s,
              r2,
              { winner: ow as PlayerId, isRon, ronfrom: ronfrom as PlayerId | null },
              () => isRon && ronfrom !== null
                ? s.game.hule(ow as PlayerId, s.lastDapai!.pai, ronfrom as PlayerId)
                : s.game.hule(ow as PlayerId),
            );
            if (choice.pending) {
              for (const prior of allResults) prior.result._anmikaRonSettlementDeferred = true;
              if (isRon && ronfrom !== null) {
                s.ronResults = sortRonResultsByKamicha(
                  ronfrom as PlayerId,
                  mergeRonResults(s.ronResults, allResults),
                );
              }
              s.ronDeclaredPlayers = Array.from(new Set([
                ...(s.ronDeclaredPlayers ?? []),
                ...allResults.map((entry) => entry.player),
              ]));
              s.lastWinner = winnerByOya(s.game, s.ronResults);
              s.lastHuleResult = s.ronResults.at(-1)?.result ?? result;
              return { ...s };
            }
            r2 = choice.result;
          }
          if (r2) {
            allResults.push({ player: ow, result: r2 });
          }
        }
        const kinpeiRemainingHumans = kinpeiHumanOthers.filter(p =>
          !(s.ronPassedPlayers ?? []).includes(p) && !(s.ronDeclaredPlayers ?? []).includes(p)
        );
        if (isRon && ronfrom !== null) {
          const combined = sortRonResultsByKamicha(
            ronfrom as PlayerId,
            mergeRonResults(s.ronResults, allResults),
          );
          if (kinpeiRemainingHumans.length > 0) {
            for (const entry of allResults) entry.result._anmikaRonSettlementDeferred = true;
            s.ronResults = combined;
          } else {
            s.ronResults = settleRonResultsInKamichaOrder(s.game, ronfrom as PlayerId, combined);
          }
        } else {
          s.game.applyHule(result, winner as PlayerId, null);
          s.ronResults = [];
        }
        const isFever = s.game.feverActive[winner as 0|1|2];
        const feverNote = isFever ? '🔥 [フィーバー継続中]' : '';
        const targetLabel = target ? ` [金北→${target}]` : ' [金北→保留]';
        const settledResults = isRon && s.ronResults.length > 0 ? s.ronResults : allResults;
        s.message = settledResults.length > 1
          ? `🎉🎉 ダブロン! ${settledResults.map(r => `p${r.player}: ${formatHuleResult(r.result)}`).join(' / ')} ${feverNote}${targetLabel}`
          : `🎉 player ${winner} ${isRon ? 'ロン' : 'ツモ'}和了！ ${formatHuleResult(result)} ${feverNote}${targetLabel}`;
        s.lastHuleResult = settledResults[settledResults.length - 1].result;
        // R5 P1 #3 fix: lastWinner を oya 優先に [ron path と揃え、 親アガリ含むダブロン後の連荘継続]
        s.lastWinner = winnerByOya(s.game, settledResults) ?? winner;
        // R8 P0 #1 fix: 冬 modal 経由で持ち越した humanOthers が残ってる場合 awaitingRonDecision 維持
        s.ronDeclaredPlayers = [...(s.ronDeclaredPlayers ?? []), ...allResults.map(r => r.player).filter(p => !(s.ronDeclaredPlayers ?? []).includes(p))];
        if (kinpeiRemainingHumans.length > 0) {
          continueRonDecisionStage(s);
          s.message += ` [他 human 候補 p${kinpeiRemainingHumans.join('/')} 判断待ち]`;
          return { ...s };
        }
        if (enterFuyuKamiPochiStage(s, {
          winner: (s.lastWinner ?? winner) as PlayerId,
          isRon,
          ronfrom: ronfrom as PlayerId | null,
        })) {
          s.game.snapshotLocked = false;
          return { ...s };
        }
        // 金北再計算前に同じ winner のサイコロが既に積まれていれば差し替え、二重化を防ぐ。
        if (s.pendingSaiKoro) {
          const winners = new Set(allResults.map(r => r.player));
          const remaining = s.pendingSaiKoro.chances.filter((c: any) => !winners.has(c.winner));
          replaceSaiKoroChances(s, remaining);
        }
        for (const rr of allResults) {
          if (!cutinQueued) s = enqueueCutinState(s, isRon ? 'ron' : 'tsumo', rr.player as PlayerId);
          s = triggerSaiKoroIfAny(s, rr.result, rr.player);
          rr.result._anmikaPostWinEffectsQueued = true;
        }
        s.game.snapshotLocked = false;
        finishRonDecisionStage(s);
        // fever 継続: 次家へ advance、 selectKinpei が ron/tsumo を兼ねるので両 path 対応
        settleAfterWin(s, { winner: (s.lastWinner ?? winner) as PlayerId, isRon, ronfrom });
        return { ...s };
      });
    },
    /** ドラ表示または冬めくりで現れた正ぽっちを任意牌に取る。 */
    selectKamiPochi(target: string, occurrenceKey?: string) {
      if (onlineMode && !isApplyingRemote && myOnlineSeat !== null) {
        const s = get(store) as StoreState;
        const pending = s.pendingKamiPochi;
        if (!pending || !pending.decisionOwners.includes(myOnlineSeat)) {
          dlog('[gate-block]', { type: 'selectKamiPochi', my: myOnlineSeat });
          return;
        }
      }
      const current = get(store) as StoreState;
      const initialPending = current.pendingKamiPochi;
      const wireKey = occurrenceKey ?? initialPending?.occurrenceKey;
      if (sendOnlineAction({ type: 'selectKamiPochi', target, occurrenceKey: wireKey })) return;
      update((s) => {
        const pending = s.pendingKamiPochi;
        if (!pending || !pending.candidates.includes(target)) return { ...s };
        if (occurrenceKey !== undefined && occurrenceKey !== pending.occurrenceKey) return { ...s };
        const context: WinChoiceContext = {
          winner: pending.winner as PlayerId,
          isRon: pending.isRon,
          ronfrom: pending.ronfrom as PlayerId | null,
        };
        if (pending.context === 'dora') {
          s.game.kamiPochiDoraChoices[context.winner][pending.occurrenceKey] = target;
          s.pendingKamiPochi = null;
          return { ...s };
        }

        const advance = s.game.resumeFuyuKamiPochi(context.winner, pending.occurrenceKey, target);
        if (!advance) return { ...s };
        s.pendingKamiPochi = null;
        syncFuyuResult(s, context.winner);
        return { ...finishAfterFuyuKamiPochi(s, context) };
      });
      if (initialPending?.context === 'dora'
        && initialPending.candidates.includes(target)
        && (occurrenceKey === undefined || occurrenceKey === initialPending.occurrenceKey)) {
        if (initialPending.isRon) api.ron(initialPending.winner);
        else api.tsumo();
      }
    },
    /** 祝儀期待値が同率の白ぽっち／でかぽっち高目候補を確定する。 */
    selectPochiSwap(target: string) {
      if (onlineMode && !isApplyingRemote && myOnlineSeat !== null) {
        const s = get(store) as StoreState;
        const pending = s.pendingPochiSwap;
        if (!pending || !pending.decisionOwners.includes(myOnlineSeat)) {
          dlog('[gate-block]', { type: 'selectPochiSwap', my: myOnlineSeat });
          return;
        }
      }
      const initialPending = (get(store) as StoreState).pendingPochiSwap;
      if (sendOnlineAction({ type: 'selectPochiSwap', target })) return;
      update((s) => {
        const pending = s.pendingPochiSwap;
        if (!pending || !pending.candidates.some((candidate) => candidate.target === target)) return { ...s };
        if (!s.game.setPochiSwapChoice(pending.winner as PlayerId, target, pending.candidates)) return { ...s };
        s.pendingPochiSwap = null;
        return { ...s };
      });
      if (initialPending?.candidates.some((candidate) => candidate.target === target)) {
        if (initialPending.isRon) api.ron(initialPending.winner);
        else api.tsumo();
      }
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
        let zoroBonusThisRoll = 0;
        // 連続ゾロ目特典 [2026-07-20 リョー裁定]: シュバサイのときだけ発動する
        // [2026-07-18 の「シュバ不問で全サイコロチャンス」は撤回]。
        // シュバサイ = 役固有の常時シュバサイ、または シュバ適用サイコロ × シュバ宣言中
        // [SaiKoroModal のシュバ表示と同じ判定]。
        // 基本額は 2 回目以降のゾロ目の出目に応じて 1→111 / n→n*11 [22/33/44/55/66] 枚オール。
        // リョー裁定 2026-07-21 [Google Doc 準拠]: 連続特典も出目当てと同じ倍率を受ける。
        // 出目当て本体 [finalize 側] と同一 opts = シュバ非適用 [サイコロ chip はシュバに
        // 乗らない 2026-05-12]、FEVER tier 倍率適用、ぽっち倍率適用 [ron 由来×非フィーバーは
        // bypass、逆ぽっちの払いは負倍率で自動反転]。
        const isShuvariSai = (curChance as any)?.alwaysShuvari === true
          || ((curChance as any)?.shuvariApplicable === true && s.game.shuvariActive[chanceWinner]);
        if (zoro && isShuvariSai) {
          let consec = 1;
          for (let i = ps.rolls.length - 2; i >= 0; i--) {
            if (ps.rolls[i].zoro) consec++;
            else break;
          }
          if (consec >= 2) {
            const n = d1;
            zoroBonusThisRoll = n === 1 ? 111 : n * 11;
            const chanceMode = (curChance as any)?.mode ?? 'tsumo';
            s.game.applyChipOall(chanceWinner, zoroBonusThisRoll, {
              bypassShuvari: true,
              // [2026-07-21 監査 D-06 fix] ロン由来サイコロは FEVER 中でもぽっち除外 [2026-07-15 裁定]
              bypassPochi: chanceMode === 'ron',
              bypassFever: false,
              label: `🎲 ゾロ目連続特典 [${n},${n}] ×${consec}`,
              mode: chanceMode,
            });
            // 累積 zoroBonus [倍率込み実額、払いは負値] を summary 表示用に store
            // applyChipOall 直後の chipBreakdown 末尾 entry が今回 push 分
            const lastEntry = s.game.chipBreakdown[s.game.chipBreakdown.length - 1];
            const actualThisRoll = lastEntry?.total ?? zoroBonusThisRoll;
            (ps as any)._zoroBonusAcc = ((ps as any)._zoroBonusAcc ?? 0) + actualThisRoll;
            s.message = `🎲 ゾロ目連続特典 [${n},${n}] × ${consec}: chip ${actualThisRoll} オール`;
          }
        }
        // ゾロ目はリプレイ扱い [回数外]。虹All-Star等は5〜7投になる。
        const nonZoroCount = ps.rolls.filter((r) => !r.zoro).length;
        const requiredRolls = Math.max(1, Number(curChance?.rollCount ?? 4));
        if (nonZoroCount >= requiredRolls) {
          // chip 計算 + 適用、 finalized=true で表示維持 [user の「次へ」 click 待ち]
          const chance = ps.chances[ps.currentIdx];
          const hits = ps.rolls.filter((r) => r.hit).length;
          const baseChip = chance.baseChip;
          // count回はtrigger時に独立chanceへ展開する。
          // 逆ぽっち等のマイナスサイコロは pochiMultiplier [chip 倍率、符号込み] が
          // applyChipOall 内で自動適用する [即赤=70×(-2)=-140]。ここで符号を
          // 掛けると二重反転になるので base は常に正のまま渡す。
          const chipN = baseChip * hits;
          if (hits > 0 && chipN > 0) {
            // ぽっち倍率はツモ由来だけに適用。ロン由来サイコロでは明示 bypass。
            // シュバは サイコロ chip 倍率に乗らない [リョー指示 2026-05-12]
            s.game.applyChipOall(chanceWinner, chipN, {
              bypassShuvari: true,
              // [2026-07-21 監査 D-06 fix] ロン由来サイコロは FEVER 中でもぽっち除外 [2026-07-15 裁定]
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
    /** solo: CPU 和了のサイコロ進行を人間が確認して開始する [2026-07-16 リョー指示] */
    ackCpuWin() {
      update((s) => ({ ...s, cpuWinAck: true }));
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
        const { winner, isRon, ronfrom } = s.pendingFeverContinue;
        clearFeverContinueStage(s);
        if (isRon) {
          // ron 経路: winner は hand 14 [applyHule で ron pai 込み]
          // リョー裁定 2026-07-21 [裁定6]: 再開席は放銃者の次 [「とにかく順番に山を
          // めくっていくだけだから、順番はズレないよ」]。ronfrom 未保持の旧 state
          // [牌譜/保存データ] だけ従来の winner 基準で進める。
          // 反時計周り: 次プレイヤー = basePid - 1 [2026-05-13 fix]
          // 2026-05-14 fix [user 報告]: lunban 逆算で qijia 固定じゃなく currentOya 基準に。
          // 親流れ後 currentOya !== qijia な局で 別の席に ツモが渡る = 「親番より下家の捨て牌多い」
          // 「ツモ順 一個ズレ」 bug の原因。 lunbanToPlayerId が currentOya 基準なので 逆も統一
          const winnerPid = winner as 0|1|2;
          const basePid = (typeof ronfrom === 'number' ? ronfrom : winnerPid) as 0|1|2;
          const nextPlayer = ((basePid - 1) + 3) % 3;
          s.game.state.lunban = (((s.game.currentOya - nextPlayer) % 3 + 3) % 3) as any;
          s = confirmPendingFeverBeforeDraw(s);
          if (s.pendingPingju || s.roundEnded) return { ...s };
          s.lastZimo = s.game.zimo();
          // [2026-05-21] フィーバー強制ツモ切り [fulou next-player zimo 経路]
          s = applyFeverAutoTsumokiri(s);
        } else if (s.lastZimo) {
          // tsumo 経路: アガリ牌を そのまま打牌 [dapai で lunban advance + 次家 zimo]
          s = innerDiscard(s, s.lastZimo);
        }
        const hasPendingReaction = s.awaitingRonDecision || s.awaitingFulou;
        // アガリ表示を clear して次の操作へ
        s.lastWinner = null;
        s.lastHuleResult = null;
        if (!hasPendingReaction) {
          s.lastDapai = null;
          finishRonDecisionStage(s);
        }
        if (!s.lastZimo) {
          // 2026-07-16 リョー報告 fix [ソロのフィーバーで山掘り切り→進行不能]:
          // 旧 code は roundEnded を立てて message を足すだけで、pendingPingju が無く
          // 流局パネルも次局導線も出ない = 詰み。他の山切れ経路と同じく pingju transition を通す
          if (!s.pendingPingju && !s.roundEnded) {
            s = applyPingjuTransition(s, '🌀 フィーバー山切れ:');
          } else {
            s.roundEnded = true;
          }
          return { ...s };
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
      // 和了者の冬・金北・サイコロ・フィーバー判断を先に確定してから、
      // pending 側に保持したダブロン候補の判断へ戻す。modal の上書きを防ぐ。
      {
        const s = get(store) as StoreState;
        if (hasPostWinDecision(s)) {
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
          if (s.pendingNukiBei) return { ...finalizePendingNukiBei(s) };
          // 2026-05-14 fix [user 報告 + codex 同定]: 候補全 skip 後の zimo は lastDapai.player の
          // 次家 [反時計 = player - 1] を確定。 dapai が事前 lunban+1 してるが ポンスキップで stale
          // 化する case あり、 ここで明示再計算して 「親より下家 捨て牌多い」 ズレ防止
          if (s.lastDapai) {
            const from = s.lastDapai.player;
            const nextPlayer = ((from - 1) + 3) % 3;
            s.game.state.lunban = (((s.game.currentOya - nextPlayer) % 3 + 3) % 3) as any;
          }
          s = confirmPendingFeverBeforeDraw(s);
          if (s.pendingPingju || s.roundEnded) return { ...s };
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
            if (s.game.feverDeclareDapaiPlayer === s.lastDapai.player) {
              s.game.cancelFeverDeclaration(s.lastDapai.player as PlayerId);
            }
            saveHuleSnapshot(s.game);
            const ronResults: Array<{ player: number; result: any }> = [];
            for (const p of cpuRemaining) {
              // Every claimant is evaluated from the same pre-ron state.  hule()
              // can consume Autumn indicators, so carrying the prior claimant's
              // mutation into this calculation would change the hand value.
              s.game.restoreSnapshot();
              // R5 P1 #4 fix: human pass 後 CPU 後発ロン でも 金北 autoResolve、 通常 path と揃える
              if (hasGoldKita(s.game, p as PlayerId)) {
                s.game.autoResolveKinpei(p as any);
                saveHuleSnapshot(s.game);
              }
              let result = s.game.hule(p as any, s.lastDapai.pai, s.lastDapai.player as any);
              if (result) {
                const choice = resolvePreSettlementPochiChoices(
                  s,
                  result,
                  { winner: p as PlayerId, isRon: true, ronfrom: s.lastDapai.player as PlayerId },
                  () => s.game.hule(p as PlayerId, s.lastDapai!.pai, s.lastDapai!.player as PlayerId),
                );
                if (choice.pending) return { ...s };
                result = choice.result;
              }
              if (result) {
                ronResults.push({ player: p, result });
              }
            }
            if (ronResults.length > 0) {
              if (ronResults.length > 1 || (s.ronResults ?? []).length > 0) s.game.snapshotLocked = true;
              s.pendingNukiBei = null;
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
              if (enterFuyuKamiPochiStage(s, {
                winner: s.lastWinner as PlayerId,
                isRon: true,
                ronfrom: s.lastDapai.player as PlayerId,
              })) {
                s.game.snapshotLocked = false;
                return { ...s };
              }
              // R18 #4 fix: pass 後 CPU ロンで fever 継続抜けてた、 winner が fever 中なら
              // pendingFeverContinue にして 通常 ロンと揃える
              const winnerSeat = s.lastWinner as PlayerId;
              settleAfterWin(s, { winner: winnerSeat, isRon: true, ronfrom: s.lastDapai?.player ?? null });
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
        if (s.pendingNukiBei && (s.ronDeclaredPlayers ?? []).length === 0) {
          return { ...finalizePendingNukiBei(s) };
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
            s.game.snapshotLocked = false;
          }
          if ((s.ronResults ?? []).length > 1) {
            s.message = `🎉🎉 ダブロン! ${formatRonResults(s.ronResults)}`;
            s.lastWinner = winnerByOya(s.game, s.ronResults);
            s.lastHuleResult = s.ronResults[s.ronResults.length - 1].result;
          }
          // fever check: 最後に宣言した winner を基準に
          const lastWinner = s.lastWinner ?? winnerByOya(s.game, s.ronResults);
          if (lastWinner !== null) {
            s.lastWinner = lastWinner;
            if (s.lastDapai && enterFuyuKamiPochiStage(s, {
              winner: lastWinner as PlayerId,
              isRon: true,
              ronfrom: s.lastDapai.player as PlayerId,
            })) {
              return { ...s };
            }
            for (const rr of s.ronResults) {
              if (rr.result?._anmikaRonEffectsQueued) continue;
              s = enqueueCutinState(s, 'ron', rr.player as PlayerId);
              s = triggerSaiKoroIfAny(s, rr.result, rr.player);
              rr.result._anmikaRonEffectsQueued = true;
            }
            settleAfterWin(s, { winner: lastWinner as PlayerId, isRon: true, ronfrom: s.lastDapai?.player ?? null });
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
        s = confirmPendingFeverBeforeDraw(s);
        if (s.pendingPingju || s.roundEnded) return { ...s };
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
        if (isLiveTurnActionBlocked(s) || s.lastWinner !== null) return { ...s }; // 連打防止
        const player = s.game.lunbanToPlayerId(s.game.state.lunban);
        // R7 P0 #2 fix: canTsumo 妥当性検証必須、 不正 client が pending modal を作る攻撃防止
        if (!s.game.canTsumo(player)) return { ...s };
        const reversePochiDecisionTsumo = !!(s.game.feverActive[player] && s.game.pochiPaymentMode[player]);
        const reverseTsumoHasHumanOwner = reversePochiDecisionTsumo
          && ([0, 1, 2] as const).some((p) => p !== player && !s.cpu[p]);
        if (s.game.feverActive[player]
          && s.game.effectiveHuapaiAtHule(player).includes('f4')
          && (!s.cpu[player] || reverseTsumoHasHumanOwner)) {
          // [2026-05-15 機能 11] フィーバー中 + 冬持ち + 待ち残山 0 → modal skip で 自動冬使用
          // [user confirm 不要、 「使う以外 ありえない」 局面なので 自動 applyFuyu(true)]
          if (s.game.isFeverWaitExhausted(player) && !reversePochiDecisionTsumo) {
            s.game.fuyuConsumed[player] = true;
            s.game.endFever(player);
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
        const reverseDecisionOwnersTsumo = ([0, 1, 2] as const).filter((p) => p !== player);
        const isFeverPayAuto_tsumo = reversePochiDecisionTsumo
          && reverseDecisionOwnersTsumo.every((p) => s.cpu[p]);
        saveHuleSnapshot(s.game);
        let result = s.game.hule(player as any);
        if (!result) {
          s.message = `player ${player} はツモアガリできない [役なし or majiang-core 拒否]`;
          return { ...s };
        }
        {
          const choice = resolvePreSettlementPochiChoices(
            s,
            result,
            { winner: player as PlayerId, isRon: false, ronfrom: null },
            () => s.game.hule(player as PlayerId),
          );
          if (choice.pending) return { ...s };
          result = choice.result;
          if (!result) {
            s.message = `player ${player} 神ぽっち選択後のツモ再計算失敗`;
            return { ...s };
          }
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
          && (!s.cpu[player] || reverseTsumoHasHumanOwner)
          && !isFeverPayAuto_tsumo) {
          s.lastHuleResult = result;
          s.lastWinner = player;
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
          saveHuleSnapshot(s.game);
          result = s.game.hule(player as any);
          if (!result) {
            s.message = `player ${player} 金北自動選択後のツモ再計算失敗`;
            return { ...s };
          }
          const choice = resolvePreSettlementPochiChoices(
            s,
            result,
            { winner: player as PlayerId, isRon: false, ronfrom: null },
            () => s.game.hule(player as PlayerId),
          );
          if (choice.pending) return { ...s };
          result = choice.result;
        }
        s.game.applyHule(result, player as any, null);
        const isFever = s.game.feverActive[player as 0|1|2];
        const feverNote = isFever ? '🔥 [フィーバー継続中、 次局へ進まず待ち継続]' : '';
        s.message = `🎉 player ${player} ツモ和了！ ${formatHuleResult(result)} ${feverNote}`;
        s.lastHuleResult = result;
        s.lastWinner = player;
        s.ronResults = [];
        if (enterFuyuKamiPochiStage(s, { winner: player as PlayerId, isRon: false, ronfrom: null })) {
          return { ...s };
        }
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
        if (isLiveTurnActionBlocked(s)) return { ...s };
        const player = s.game.lunbanToPlayerId(s.game.state.lunban);
        return { ...beginNukiBei(s, player, meta) };
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
        if (isLiveTurnActionBlocked(s)) return { ...s };
        const kakan = processKakanQianggangWindow(s, mianzi);
        s = kakan.s;
        if (kakan.handled) return { ...s };
        return declareKanImpl(s, mianzi);
      });
    },
    /** リーチ宣言 [pending state へ、 宣言牌を打牌した時点で確定] */
    lizhi(opts: { shuvari?: boolean; fever?: boolean; open?: boolean } = {}) {
      if (!checkOnlineGate({ type: 'lizhi' }, 'currentPlayer')) return;
      if (sendOnlineAction({ type: 'lizhi', opts })) return;
      update((s) => {
        if (isLiveTurnActionBlocked(s)) return { ...s };
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
          const feverByDapai = s.game.feverCandidatesByDapai(player);
          const lizhiCandidates = new Set(
            s.game.getLizhiCandidates(player).map((pai) => pai.replace(/[_*]$/, '')),
          );
          const hasLegalFeverDapai = [...feverByDapai.keys()]
            .some((pai) => lizhiCandidates.has(pai.replace(/[_*]$/, '')));
          if (!hasLegalFeverDapai) {
            s.message = `player ${player} フィーバー条件未達 [7p/7s 暗刻なし]`;
            return { ...s };
          }
        }
        s.lizhiPending = player;
        // 選択フラグを reactive 反映用 store 直下にも持つ [リョー指示 2026-05-12: リーチ宣言時 button 枠表示]
        s.lizhiPendingFlags = { open: !!opts.open, shuvari: !!opts.shuvari, fever: !!opts.fever };
        s._lizhiOpen = !!opts.open;
        s._lizhiShuvari = !!opts.shuvari;
        s._lizhiFever = !!opts.fever;
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
    /** 通常立直成立後、次家の打牌までに行う遅延シュバリ宣言。 */
    shuvari(player?: number) {
      const state = get(store) as StoreState;
      const target = (player ?? myOnlineSeat
        ?? ([0, 1, 2] as const).find((p) => state.game.canDeclareLateShuvari(p))) as PlayerId | undefined;
      if (target === undefined) return;
      if (onlineMode && !isApplyingRemote && myOnlineSeat !== target) return;
      if (sendOnlineAction({ type: 'shuvari', player: target })) return;
      update((s) => {
        if (!s.game.declareLateShuvari(target)) {
          s.message = `player ${target} はシュバリ宣言期限外`;
        } else {
          s.message = `player ${target} シュバリーチ成立`;
        }
        return { ...s };
      });
    },
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
      // 2026-07-16 リョー指示: 親がアガリ止め可能な局面で親が CPU なら、CPU 自身に判断させる。
      // トップ確定で半荘を締められる局面は常に「やめる」が合理なので無条件でアガリ止め。
      // オフライン進行のみ [オンラインは authority 側の進行判断に委ねる]
      if (!onlineMode) {
        const s0 = get(store) as StoreState;
        const w = s0.lastWinner;
        if (w !== null && w !== undefined && s0.cpu[w as 0 | 1 | 2] && s0.game.canAgariyame(w as any)) {
          update((s) => {
            s.game.agariyame();
            const ranking = s.game.getRanking();
            s.message = '🏁 半荘終了 [CPU 親のアガリ止め判断] ' + ranking.map(r => `${r.rank}位 p${r.player} ${r.defen}点`).join(' / ');
            s.roundEnded = true;
            return { ...s };
          });
          return;
        }
      }
      if (onlineMode && !isApplyingRemote) {
        const s = get(store) as StoreState;
        const isWinner = s.lastWinner !== null && myOnlineSeat === s.lastWinner;
        const isHostLocal = iAmHost || !!(window as any).__anmikaIsHost;
        const winnerIsCpu = s.lastWinner !== null && s.cpu[s.lastWinner as 0|1|2] === true;
        const canSend = isWinner || (s.lastWinner === null && isHostLocal) || (winnerIsCpu && isHostLocal);
        if (!canSend) return;
        const fromRole: 'host' | 'winner' | 'oya' = isWinner ? 'winner' : 'host';
        sendOnlineAction({ type: 'nextRound', from_role: fromRole });
        return;
      }
      update((s) => {
        const remotePool = preShuffledPool;
        if (s.pendingPingju) {
          s.pendingPingju = false;
          if (s.game.isGameEnd()) {
            s.game.state.finished = true;
            const ranking = s.game.getRanking();
            s.message = '🏁 半荘終了 [流局後 トビ] ' + ranking.map(r => `${r.rank}位 p${r.player} ${r.defen}点`).join(' / ');
            s.roundEnded = true;
            return { ...s };
          }
        }
        const winner = s.lastWinner;
        const blindState = (remotePool as any)?._blindState;
        s.game.nextRound({ winner: winner as any, preShuffledPool: blindState ? undefined : remotePool as any });
        if (s.game.isGameEnd()) {
          s.game.state.finished = true;
          const ranking = s.game.getRanking();
          s.message = '🏁 半荘終了 ' + ranking.map(r => `${r.rank}位 p${r.player} ${r.defen}点`).join(' / ');
          s.roundEnded = true;
          return { ...s };
        }
        if (blindState) {
          s.game.shan = Shan3.createBlind({
            rule: s.game.shanRule,
            baopai: blindState.baopai,
            fubaopai: blindState.fubaopai,
            paishu: blindState.paishu,
            canDrawRinshan: blindState.canDrawRinshan,
          });
          s.game.initFromDeal({ hands: blindState.hands, huapai: blindState.huapai, goldHand: blindState.goldHand, pochiHand: blindState.pochiHand });
          s.lastZimo = blindState.firstZimo;
        } else {
          s.game.qipai();
          s.lastZimo = s.game.zimo();
        }
        s.lastDapai = null;
        s.lastWinner = null;
        s.lastHuleResult = null;
        clearReactionStage(s);
        s.roundEnded = false;
        s.message = null;
        s.lizhiPending = null;
        s = applyFeverAutoTsumokiri(s);
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
        if (isLiveTurnActionBlocked(s)) return { ...s };
        const player = s.game.lunbanToPlayerId(s.game.state.lunban);
        const sp = s.game.shoupai.get(player);
        if (sp?._zimo != null) return { ...s }; // 既にツモ済、 no-op
        s = confirmPendingFeverBeforeDraw(s);
        if (s.pendingPingju || s.roundEnded) return { ...s };
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
        if (isLiveTurnActionBlocked(s) || (s.lizhiPending ?? null) !== null) return { ...s };
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
        if (isLiveTurnActionBlocked(s)) return { ...s };
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
      // [2026-07-21 監査 S-01 fix] オンラインの CPU は権威サーバーの deadline driver
      // [CPU 席 750ms の turnTimeoutAction] だけが進める。旧 host cpuRelay 代理送信は
      // 隠し手牌の oracle 探索・CPU 直接操作に使えたため server 側で受付廃止済み。
      if (onlineMode && !isApplyingRemote) {
        dlog('[cpuStep] online は server driver 駆動、 client からは送らない');
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
        if (!iAmHost) {
          dlog('[nextMatch] reject: online 中は host のみ');
          return;
        }
        const curState = get(store) as StoreState;
        const cpuSeats = ([0, 1, 2] as const).filter((p) => curState.cpu[p]);
        const qijia = (curState.game.state?.qijia ?? 0) as 0|1|2;
        let nextChipLedger: { 0: number; 1: number; 2: number } = { 0: 0, 1: 0, 2: 0 };
        try {
          if (finalize && !resetChip) {
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
        sendOnlineAction({ type: 'nextMatch', finalize, resetChip, qijia, cpuSeats, chipLedger: nextChipLedger });
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
        pendingKamiPochi: null,
        pendingPochiSwap: null,
    pendingFeverContinue: null,
    pendingPingju: false,
      pendingQianggang: null,
    pendingNukiBei: null,
    pendingSaiKoro: null,
    cpuWinAck: true,
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
      update((s) => {
        const legal = s.awaitingFulou
          && !s.awaitingRonDecision
          && !hasPostWinDecision(s)
          && !s.roundEnded
          && !s.pendingPingju
          && s.ponCandidates.some((candidate) => candidate.player === player && candidate.mianzi.includes(mianzi));
        return legal ? ponImpl(s, player, mianzi) : { ...s };
      });
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
      update((s) => {
        const legal = s.awaitingFulou
          && !s.awaitingRonDecision
          && !hasPostWinDecision(s)
          && !s.roundEnded
          && !s.pendingPingju
          && s.kanCandidates.some((candidate) => candidate.player === player && candidate.mianzi.includes(mianzi));
        return legal ? damingangImpl(s, player, mianzi) : { ...s };
      });
    },
  };
  return api;
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
  // [2026-07-16 リョー指示] フィーバー中の自動スキップ廃止。
  // 1巡ずつ表示して何が起きてるか見えるようにする。
  // CPU の進行は cpuStepImpl が 1 ターンずつ処理する
  return s;
}

function finalizePendingNukiBei(s: StoreState): StoreState {
  const pending = s.pendingNukiBei;
  if (!pending) return s;
  s.pendingNukiBei = null;
  clearReactionStage(s);
  s.lastDapai = null;
  const nukiBefore = (s.game.nukidora[pending.player] ?? 0)
    + (s.game.nukidoraGold[pending.player] ?? 0);
  const replacement = s.game.declareNukiBei(pending.player, pending.meta);
  s.lastZimo = replacement;
  if (replacement === null) {
    const nukiAfter = (s.game.nukidora[pending.player] ?? 0)
      + (s.game.nukidoraGold[pending.player] ?? 0);
    if (nukiAfter > nukiBefore) {
      return applyPingjuTransition(
        s,
        `🌀 流局 [player ${pending.player} 北抜き後に嶺上牌枯渇]:`,
      );
    }
    s.message = `player ${pending.player} 北抜き不可`;
  } else {
    s.message = `player ${pending.player} 北抜き [${s.game.nukidora[pending.player] + s.game.nukidoraGold[pending.player]}枚目]`;
  }
  return s;
}

export function beginNukiBei(s: StoreState, player: PlayerId, meta?: { gold?: boolean }): StoreState {
  if (!s.game.canNukiBei(player)) {
    s.message = `player ${player} 北抜き不可`;
    return s;
  }
  const ronCandidates = ([0, 1, 2] as const).filter((p) =>
    p !== player && s.game.canRon(p, 'z4', player)
  );
  if (ronCandidates.length === 0) {
    s.pendingNukiBei = { player, meta };
    return finalizePendingNukiBei(s);
  }

  s.pendingNukiBei = { player, meta };
  s.lastDapai = { player, pai: 'z4' };
  const cpuRon = ronCandidates.filter((p) => s.cpu[p]);
  const humanRon = ronCandidates.filter((p) => !s.cpu[p]);
  if (cpuRon.length > 0 && humanRon.length === 0) {
    saveHuleSnapshot(s.game);
    const results: Array<{ player: number; result: any }> = [];
    for (const p of cpuRon) {
      s.game.restoreSnapshot();
      if (hasGoldKita(s.game, p)) {
        s.game.autoResolveKinpei(p);
        saveHuleSnapshot(s.game);
      }
      let result = s.game.hule(p, 'z4', player);
      if (result) {
        const choice = resolvePreSettlementPochiChoices(
          s,
          result,
          { winner: p, isRon: true, ronfrom: player },
          () => s.game.hule(p, 'z4', player),
        );
        if (choice.pending) return s;
        result = choice.result;
      }
      if (result) results.push({ player: p, result });
    }
    if (results.length > 0) {
      s.pendingNukiBei = null;
      s.ronResults = settleRonResultsInKamichaOrder(s.game, player, results);
      s.lastWinner = winnerByOya(s.game, s.ronResults);
      s.lastHuleResult = s.ronResults.at(-1)?.result ?? null;
      finishRonDecisionStage(s);
      if (enterFuyuKamiPochiStage(s, {
        winner: s.lastWinner as PlayerId,
        isRon: true,
        ronfrom: player,
      })) return s;
      for (const rr of s.ronResults) s = triggerSaiKoroIfAny(s, rr.result, rr.player);
      settleAfterWin(s, { winner: s.lastWinner as PlayerId, isRon: true, ronfrom: player });
      s.message = `北抜きロン: ${formatRonResults(s.ronResults)}`;
      return s;
    }
    return finalizePendingNukiBei(s);
  }
  enterRonDecisionStage(s);
  s.message = `北抜きロン可能: player ${ronCandidates.join(',')}`;
  return s;
}

/** FEVER宣言牌の反応窓が閉じた直後に成立を確定し、次ツモより先に待ち枯れを判定する。 */
export function confirmPendingFeverBeforeDraw(s: StoreState): StoreState {
  const player = s.game.feverDeclareDapaiPlayer;
  if (player === null) return s;
  s.game.confirmFeverDeclaration(player);
  if (s.game.isFeverWaitExhausted(player)) {
    return applyPingjuTransition(s, '🔥 フィーバー立直成立、待ち牌全消失で1人テンパイ流局:');
  }
  return s;
}

export function triggerSaiKoroIfAny(s: StoreState, result: any, winner: number): StoreState {
  const rawChances = result?.saiKoroChances ?? [];
  const awarded: Record<number, string[]> = (s.game as any).feverSaiAwarded
    ?? ((s.game as any).feverSaiAwarded = { 0: [], 1: [], 2: [] });
  const seen = new Set<string>(awarded[winner] ?? []);
  const chances = rawChances.filter((c: any) => {
    const key = typeof c?.awardKey === 'string' ? c.awardKey : null;
    // During FEVER, ordinary conditions are paid once. A true-yakuman dice
    // award is the documented exception and repeats on every win.
    if (!s.game.feverActive[winner as PlayerId] || !key || key.startsWith('yakuman:')) return true;
    return !seen.has(key);
  });
  if (chances.length === 0) return s;
  for (const c of chances) {
    const key = typeof c?.awardKey === 'string' ? c.awardKey : null;
    if (s.game.feverActive[winner as PlayerId] && key && !key.startsWith('yakuman:')) seen.add(key);
  }
  awarded[winner] = [...seen];
  // `count` is a number of independent sessions, not a payout multiplier.
  // Expand it here so every session declares its own combination and rolls.
  const mappedChances = chances.flatMap((c: any) => {
    const sessions = Math.max(1, Math.trunc(Number(c.count ?? 1)));
    return Array.from({ length: sessions }, (_, sessionIndex) => ({
      awardKey: c.awardKey,
      name: sessions > 1 ? `${c.name} [${sessionIndex + 1}/${sessions}]` : c.name,
      baseChip: c.baseChip,
      shuvariApplicable: c.shuvariApplicable,
      alwaysShuvari: c.alwaysShuvari === true,
      rollCount: Math.max(1, Math.trunc(Number(c.rollCount ?? 4))),
      count: 1,
      plusMinus: c.plusMinus ?? '+',
      mode: c.mode ?? (result?._isRon ? 'ron' : 'tsumo'),
      winner,
    }));
  });
  appendSaiKoroChances(s, winner, mappedChances);
  return s;
}

export function innerDiscard(s: StoreState, pai: string, meta?: { gold?: boolean; pochi?: 'blue' | 'red' | 'green' | 'yellow' }): StoreState {
  // 局終了・反応待ち・和了後 modal 中は no-op。自動進行ボタンや遅延 action が
  // 勝利局面を打牌で上書きすると復帰不能になるため、最下層でも必ず止める。
  if (isLiveTurnActionBlocked(s)) return { ...s };
  const player = s.game.lunbanToPlayerId(s.game.state.lunban);
  // 北 [z4/gN] は河に切れない → 北抜きに変換 [アンミカ独自、 リョー指示 2026-05-11]
  if (toCorePai(pai) === 'z4' && s.game.canNukiBei(player as any)) {
    const nukiMeta = resolveNukiBeiMeta({
      requestedPai: pai,
      metaGold: meta?.gold,
      lastZimo: s.lastZimo,
      lastZimoGold: s.game.shan.lastZimoGold,
    });
    s = beginNukiBei(s, player as PlayerId, nukiMeta);
    if (!s.awaitingRonDecision && !s.roundEnded) s.message = `[ツモ切り] 北 [${pai}] → 北抜き`;
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
    if (s.game.feverDeclareDapaiPlayer === player) {
      s.game.cancelFeverDeclaration(player as PlayerId);
    }
    let ronResults: Array<{ player: number; result: any }> = [];
    // 2026-05-14 codex review P1 fix: ダブロンで各 winner ごとに saveSnapshot すると
    // 2 人目の snapshot が 1 人目 適用後 になる。 全 hule 適用前に 1 度だけ saveSnapshot
    saveHuleSnapshot(s.game);
    for (const p of cpuRonCands) {
      s.game.restoreSnapshot();
      // R7 P1 #6 fix: CPU 直ロン経路 [discard 直後] でも autoResolveKinpei、 通常 path と揃え
      if (hasGoldKita(s.game, p as PlayerId)) {
        s.game.autoResolveKinpei(p as any);
        saveHuleSnapshot(s.game);
      }
      // fromPlayer 渡し忘れで ronpaiWithDir null → hule が ロン認識せず役なし扱いになる bug fix
      let result = s.game.hule(p as any, committedPai, player as any);
      if (result) {
        const choice = resolvePreSettlementPochiChoices(
          s,
          result,
          { winner: p as PlayerId, isRon: true, ronfrom: player as PlayerId },
          () => s.game.hule(p as PlayerId, committedPai, player as PlayerId),
        );
        if (choice.pending) return { ...s };
        result = choice.result;
      }
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
      if (ronResults.length > 1) s.game.snapshotLocked = true;
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
      if (enterFuyuKamiPochiStage(s, {
        winner: winner as PlayerId,
        isRon: true,
        ronfrom: player as PlayerId,
      })) {
        s.game.snapshotLocked = false;
        return { ...s };
      }
      // 2026-05-14 codex review P1 fix: CPU ロン経路でも 特殊効果の state 遷移を 人間 ron と
      // 揃える。 triggerSaiKoroIfAny / feverWinCount inc / pendingFeverContinue / roundEnded 制御
      // Round 2 codex fix P2 #11: 全 winner の saiKoroChances を queue 化、 ダブロン 両方処理
      for (const rr of ronResults) {
        s = enqueueCutinState(s, 'ron', rr.player as PlayerId);
        s = triggerSaiKoroIfAny(s, rr.result, rr.player);
        // CPU ロン経路でも ack gate を設定 [tsumo 側 cpuActions.ts:60 と同等]
        if (s.pendingSaiKoro) s.cpuWinAck = false;
      }
      settleAfterWin(s, { winner: winner as PlayerId, isRon: true, ronfrom: player as PlayerId });
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
      // [2026-07-20 リョー指摘] フィーバー成立条件は「暗槓以外の副露ゼロ」で牌種を問わない。
      // 7 のポンを禁じるだけでは足りず、7 対子や全虹の芽がある手では
      // 役牌ポンでもフィーバー権が飛ぶ。芽が残っている間は丸ごと見送る
      if (shouldSkipPonForFever(s.game, cand.player as 0|1|2)) {
        dlog('[cpu pon skip] フィーバー権保護', { player: cand.player, pai: committedCore });
        continue;
      }
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
      // 大明槓も暗槓ではない副露なので、ポンと同じくフィーバー権を潰す
      if (shouldSkipPonForFever(s.game, cand.player as 0|1|2)) {
        dlog('[cpu damingang skip] フィーバー権保護', { player: cand.player, pai: committedCore });
        continue;
      }
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
      s = confirmPendingFeverBeforeDraw(s);
      if (s.pendingPingju || s.roundEnded) return { ...s };
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
  if (s._onlineMode) return s;
  let safety = 0;
  while (safety < safetyMax) {
    if (isLiveTurnActionBlocked(s)) break;
    const player = s.game.lunbanToPlayerId(s.game.state.lunban);
    if (!s.game.lizhi.has(player)) break;
    if (s.game.canTsumo(player)) break;
    // 北 [z4] は河に切らず抜く [春夏秋冬は shan.zimo で skip 済なので考慮不要]
    if (s.lastZimo != null && toCorePai(s.lastZimo) === 'z4' && s.game.canNukiBei(player)) {
      s = beginNukiBei(s, player);
      if (s.awaitingRonDecision || s.roundEnded || s.pendingPingju) break;
      s.message = `[自動北抜き] player ${player}`;
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
    // _zimo が mianzi [length>3、 副露後] の場合は そのままは切れない、 break
    if (typeof sp._zimo !== 'string' || sp._zimo.length > 3) break;
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
  const { message, nagashiWinner, nagashiResult } = computePingjuResult(s.game);
  s.message = msgPrefix ? `${msgPrefix} ${message}` : message;
  s.pendingPingju = true;
  s.roundEnded = true;
  // R9 P1 #10 fix: 流し役満は本役満ツモ扱い、 lastWinner を set [親流れ / 連荘 / 局結果表示 に反映]
  if (nagashiWinner !== null) {
    s.lastWinner = nagashiWinner;
    s.lastHuleResult = nagashiResult;
    if (enterFuyuKamiPochiStage(s, { winner: nagashiWinner as PlayerId, isRon: false, ronfrom: null })) return s;
    if (nagashiResult) triggerSaiKoroIfAny(s, nagashiResult, nagashiWinner);
  }
  return s;
}

function settleNagashiYakuman(g: Game3, winner: PlayerId): any {
  const point = evaluateWinPoints({
    result: { damanguan: 1 },
    winner,
    loser: null,
    oya: g.currentOya,
    benbang: g.state.benbang,
  });
  for (const p of [0, 1, 2] as PlayerId[]) g.state.defen[p] += point.deltas[p];

  const chipBefore = g.chipLedger[winner];
  const chipStart = g.chipBreakdown.length;
  // 流し役満は本役満ツモ: 打点祝儀5枚 + 本役満ボーナス10枚を別々に加算。
  g.applyChipOall(winner, 5, { label: '流し役満 役満ツモ' });
  g.applyChipOall(winner, 10, { label: '流し役満 本役満10枚オール' });

  // 手牌内の赤金虹は数えず、ルールで明記された「抜いた北・華」の祝儀だけを加算する。
  const nukiTotal = (g.nukidora[winner] ?? 0) + (g.nukidoraGold[winner] ?? 0);
  if (nukiTotal > 0) g.applyChipOall(winner, nukiTotal, { label: `流し役満 抜きドラ ×${nukiTotal}` });
  const ownHua = g.huapai[winner] ?? [];
  const haruCount = ownHua.filter((p) => p === 'f1').length;
  if (haruCount > 0) {
    const kinpei = g.kinpeiTarget[winner] === 'haru';
    const base = ownHua.length * haruCount * (kinpei ? 2 : 1);
    g.applyChipOall(winner, base, { label: `流し役満 春${kinpei ? '金北' : ''}` });
  }
  const fuyuCount = ownHua.filter((p) => p === 'f4').length;
  if (fuyuCount > 0) g.applyFuyuChip(winner, null, fuyuCount, g.kinpeiTarget[winner] === 'fuyu');

  const result: any = {
    hupai: [{ name: '流し役満', fanshu: '*' }],
    damanguan: 1,
    fanshu: undefined,
    defen: point.winnerGain,
    defen3: point.winnerGain,
    chipBreakdown: g.chipBreakdown.slice(chipStart),
    chipTotal: g.chipLedger[winner] - chipBefore,
    saiKoroChances: [{
      awardKey: 'yakuman:流し役満',
      name: '流し役満',
      baseChip: 70,
      shuvariApplicable: false,
      alwaysShuvari: true,
      count: 1,
      plusMinus: '+',
      mode: 'tsumo',
    }],
  };
  const reveal = g.fuyuRevealState[winner];
  if (reveal) {
    result.fuyuLog = reveal.fuyuLog.map((entry) => ({ ...entry }));
    result.fuyuKamiPochiPending = reveal.pendingChoice ? { ...reveal.pendingChoice } : null;
  }
  return result;
}

// 流局判定と流し役満の精算結果をまとめて返す。
function computePingjuResult(g: Game3): { message: string; nagashiWinner: number | null; nagashiResult: any | null } {
  const message = computePingjuMessage(g);
  const m = message.match(/流し役満 \[player (\d)\]/);
  const nagashiWinner = m ? parseInt(m[1], 10) : null;
  const nagashiResult = nagashiWinner === null ? null : settleNagashiYakuman(g, nagashiWinner as PlayerId);
  return { message, nagashiWinner, nagashiResult };
}

function computePingjuMessage(g: Game3): string {
  const feverWonAny = ([0, 1, 2] as const).some((p) => g.feverWinCount[p] > 0);
  // 流し役満 check: 各 player の河が全ヤオ牌 [1/9/字] + 副露されてない + 立直してない + フィーバー成立中じゃない
  const isYao = (pai: string) => {
    const core = toCorePai(pai.replace(/[\+=\-_*]/g, ''));
    if (core[0] === 'z') return true;
    const n = parseInt(core[1] === '0' ? '5' : core[1]);
    return n === 1 || n === 9 || core === 'm7';
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
      return `🌊 流し役満 [player ${p}]、 本役満ツモ + 抜き牌祝儀 + サイコロチャンス`;
    }
  }
  if (feverWonAny) return '流局 [フィーバーアガリ済]';
  // 2026-07-16 リョー裁定: テンパイ料あり [場4000]。
  // [5/23 audit の「罰符ナシ」はチョンボ系罰則の話で、ノーテン料とは別]
  // 1人聴牌: ノーテン2人が 2000 ずつ払う / 2人聴牌: ノーテン1人が 4000 払う / 3人・0人: 移動なし
  // アガリ済みフィーバーの流局 [feverWonAny] は上で return 済みのため対象外
  // 2026-07-16 リョー裁定 [追]: フィーバーリーチ中 [未アガリ] の流局は
  // 宣言者だけの「強制一人テンパイ」扱い。他家の実テンパイは数えない
  const feverDeclarers = ([0, 1, 2] as const).filter((p) => g.feverActive[p]);
  const tenpai: number[] = [];
  if (feverDeclarers.length > 0) {
    tenpai.push(...feverDeclarers);
  } else {
    for (const p of [0, 1, 2] as const) {
      if (g.xiangting(p) === 0) tenpai.push(p);
    }
  }
  if (tenpai.length === 3) return '流局 [全員テンパイ、 点数移動なし]';
  if (tenpai.length === 0) return '流局 [全員ノーテン、 点数移動なし]';
  const noten = ([0, 1, 2] as const).filter((p) => !tenpai.includes(p as number));
  const receive = 4000 / tenpai.length;
  const pay = 4000 / noten.length;
  for (const p of tenpai) g.state.defen[p as 0 | 1 | 2] += receive;
  for (const p of noten) g.state.defen[p] -= pay;
  return `流局 [テンパイ料 場4000: p${tenpai.join(',')} +${receive} / p${noten.join(',')} -${pay}]`;
}

export const game = createGameStore();

export function pushCutin(id: CutinId, seat?: PlayerId): void {
  game.enqueueCutin(id, seat);
}
