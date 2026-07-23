// [2026-07-23 Sol総点検 P1] オンライン needsZimo 停止修復橋 [400ms drawNext] の発火判定。
// 旧実装は外側 trigger と timer 内再検証が別条件で、槍槓/流局確認/サイコロ/リーチ宣言窓を
// 網羅していなかった。窓中に誤発火すると _autoDrawNextKey を先に消費し、窓解除が
// events 長不変だと同じ key で再発火できず橋が死ぬ [正規の停止修復まで失われる]。
// ここで判定を一本化し、abort 理由で key の扱いを分ける。
import type { PlayerId } from './types';

export type DrawNextBridgeVerdict = 'send' | 'keep' | 'rearm';

// 'send'  = drawNext を送ってよい [本物の停止]
// 'keep'  = 状態が進行済み [ツモ到着/局移動/手番移動/局終了]。key は消費のままでよい
// 'rearm' = 一時的な判定窓 [槍槓/流局/サイコロ/リーチ宣言/鳴き/ロン/華・金北系 modal] に
//           入っただけ。解除後に同じ停止が残り得るので key を解放して橋を再アームさせる
export function evaluateDrawNextBridge(s: any, selfPlayer: PlayerId, roundKey: string): DrawNextBridgeVerdict {
  if (!s || s.roundEnded) return 'keep';
  const st = s.game?.state;
  if (!st) return 'keep';
  if (`${st.changbang}-${st.jushu}-${st.benbang}` !== roundKey) return 'keep';
  const cur = s.game.lunbanToPlayerId(st.lunban);
  if (cur !== selfPlayer) return 'keep';
  if (s.game.shoupai.get(cur)?._zimo != null) return 'keep';
  if (s.lastZimo != null) return 'keep';
  if (
    s.awaitingRonDecision
    || s.awaitingFulou
    || s.pendingQianggang != null
    || s.pendingPingju
    || s.pendingSaiKoro != null
    || s.lizhiPending != null
    || s.pendingFeverContinue != null
    || s.pendingFuyu != null
    || s.pendingKinpei != null
    || s.pendingKamiPochi != null
    || s.pendingPochiSwap != null
  ) return 'rearm';
  return 'send';
}
