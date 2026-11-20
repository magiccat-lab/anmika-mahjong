// 事故は起きるものさ [jikoSp] の試し打ちと、その前提の手番ブロック判定。純関数だけ。
// server/ws_server.ts も使うので svelte/store などの client 専用 module を import しない [store.ts へは型だけ]
import { hasGoldKita } from '../game3/gold';
import { jikoSpFor } from '../jikoSp';
import type { PlayerId } from '../types';
import type { StoreState } from '../store';

/** [2026-11-04 リョー 隠し演出「アガリ牌が見えない状態からにして」] 事故は起きるものさ [lib/jikoSp.ts] を、ツモった瞬間 (和了の結果が来る前) に
 *  知るための試し打ち。手番の人間がフィーバー中 ・ リーチ中 ・ 逆払いで、今引いた牌がツモ和了になり、その和了で本人のチップが
 *  JIKO_SP_MIN_LOSS 枚以上減るなら { player, loss, pochi } を返す。それ以外は null [今まで通り、和了の結果が来てから暗転]。
 *  fuyuOwnerChipDelta と同じ型: captureSnapshot → hule → applyHule → 読む → applySnapshot で必ず戻す。
 *  人に聞く段が挟まる和了 [冬 ・ 金北の選択 ・ 神ぽっち ・ 高目の同率] は、本物の和了で枚数が変わり得るので null に倒す [偽の暗転を出さない] */
export type JikoPreHit = { player: 0 | 1 | 2; loss: number; pochi: 'red' | 'yellow' };
export function jikoRoundKey(st: any): string {
  return `${st?.changbang ?? ''}-${st?.jushu ?? ''}-${st?.benbang ?? ''}`;
}
export function jikoPreCheck(s: StoreState): JikoPreHit | null {
  const g = s.game;
  if (!g || s.roundEnded || s.lastWinner !== null || isLiveTurnActionBlocked(s)) return null;
  const player = g.lunbanToPlayerId(g.state.lunban) as PlayerId;
  if (s.cpu[player] || !g.feverActive[player] || !g.lizhi.has(player) || !g.pochiPaymentMode[player]) return null;
  const sp: any = g.shoupai.get(player);
  if (typeof sp?._zimo !== 'string' || sp._zimo.length > 3) return null;
  if (!g.canTsumo(player)) return null;
  const snap = g.captureSnapshot();
  const prevFuyu = g.fuyuConsumed[player];
  // hule() が書く作業用の印 [次の hule が必ず書き直すが、前後で同じ形に戻す]
  const hadHuaLen = Object.prototype.hasOwnProperty.call(g, '_huapaiOwnLengthAtHule');
  const prevHuaLen = hadHuaLen ? structuredClone((g as any)._huapaiOwnLengthAtHule) : undefined;
  try {
    const result = g.hule(player);
    if (!result) return null;
    if (g.getKamiPochiDoraOccurrences(player).length > 0 || (result as any)._pochiSwapPending) return null;
    const huapai = g.effectiveHuapaiAtHule(player);
    if (huapai.includes('f4')) return null;
    if (hasGoldKita(g, player) && g.kinpeiTarget[player] === null && huapai.length > 0) return null;
    g.applyHule(result, player, null);
    const hit = jikoSpFor([{ player, result }], jikoRoundKey(g.state));
    return hit ? { player: hit.player, loss: hit.loss, pochi: hit.pochi } : null;
  } catch {
    return null;
  } finally {
    g.applySnapshot(snap);
    g.fuyuConsumed[player] = prevFuyu;
    if (hadHuaLen) (g as any)._huapaiOwnLengthAtHule = prevHuaLen;
    else delete (g as any)._huapaiOwnLengthAtHule;
  }
}

export function hasPostWinDecision(s: StoreState): boolean {
  return !!(s.pendingFuyu || s.pendingKinpei || s.pendingKamiPochi || s.pendingPochiSwap
    || s.pendingSaiKoro || s.pendingFeverContinue);
}

export function isLiveTurnActionBlocked(s: StoreState, allowLizhiDiscard = false): boolean {
  return s.roundEnded
    || s.pendingPingju
    || s.awaitingRonDecision
    || s.awaitingFulou
    || !!s.pendingHold
    || s.pendingQianggang !== null
    || s.pendingNukiBei != null
    || hasPostWinDecision(s)
    || (!allowLizhiDiscard && s.lizhiPending !== null);
}
