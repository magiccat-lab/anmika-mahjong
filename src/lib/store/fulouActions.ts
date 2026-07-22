
// fulou action [pon / damingang / declareKan] を store.ts から抜出 [2026-05-12]
// pure function: state + args → state、 store.ts 側は update(s => impl(s, ...args)) で呼ぶ

import type { StoreState } from '../store';
import { applyPingjuTransition, enqueueCutinState } from '../store';
import { dlog } from '../helpers';
import { clearReactionStage } from './winPipeline';

/** 暗槓 / 加槓 [現家、 ツモ後]
 *  2026-05-14 codex review P2 fix: replacement null 時の 王牌枯渇 流局を applyPingjuTransition で
 *  正しく処理、 罰符 / 流し役満 / defen を apply してから 局終了 */
export function declareKanImpl(initial: StoreState, mianzi: string): StoreState {
  const s = initial;
  const player = s.game.lunbanToPlayerId(s.game.state.lunban);
  const replacement = s.game.declareKan(player, mianzi);
  if (replacement === null) {
    // R4 P1 #15 fix: null は 不正 mianzi / rollback / 山枯渇 を区別。
    // 山枯渇 [shan.paishu === 0] なら 流局、 それ以外は 「カン不可」 で進行継続
    const shanRem = (s.game.shan as any)?.paishu ?? 0;
    if (shanRem === 0) {
      return applyPingjuTransition({ ...s }, `🌀 流局 [カン後 王牌枯渇]:`);
    }
    s.message = `player ${player} カン不可 [mianzi=${mianzi}]、 別の打牌 / カン候補から再選択`;
    return { ...s };
  }
  // [2026-07-22 リョー要望] カンもリーチ同様のカットインを出す
  enqueueCutinState(s as any, 'kan', player as any);
  s.lastZimo = replacement;
  s.message = `player ${player} カン [${mianzi}]、 嶺上 ${replacement}`;
  return { ...s };
}

/** ポン宣言
 *  R4 P1 #16 fix: declarePon が false [不成立 = 不正 mianzi or 状態不整合] の場合、
 *  awaiting を解除せず候補待ちを維持。 旧版は false でも success 扱いで state を進めて
 *  打牌待ちにしてた = state 破綻 */
export function ponImpl(initial: StoreState, player: number, mianzi: string): StoreState {
  const s = initial;
  if (!s.lastDapai) return { ...s };
  dlog('[pon] player=', player, 'mianzi=', mianzi, 'fromPlayer=', s.lastDapai.player, 'lunban=', s.game.state.lunban);
  const sp = s.game.shoupai.get(player as 0 | 1 | 2);
  dlog('[pon BEFORE] m=', JSON.parse(JSON.stringify(sp?._bingpai?.m ?? [])), 'p=', JSON.parse(JSON.stringify(sp?._bingpai?.p ?? [])), 's=', JSON.parse(JSON.stringify(sp?._bingpai?.s ?? [])), 'z=', JSON.parse(JSON.stringify(sp?._bingpai?.z ?? [])), '_zimo=', sp?._zimo, '_fulou=', sp?._fulou?.slice());
  const ok = s.game.declarePon(player as any, mianzi, s.lastDapai.player as any);
  dlog('[pon AFTER]  m=', JSON.parse(JSON.stringify(sp?._bingpai?.m ?? [])), 'p=', JSON.parse(JSON.stringify(sp?._bingpai?.p ?? [])), 's=', JSON.parse(JSON.stringify(sp?._bingpai?.s ?? [])), 'z=', JSON.parse(JSON.stringify(sp?._bingpai?.z ?? [])), '_zimo=', sp?._zimo, '_fulou=', sp?._fulou?.slice());
  dlog('[pon] declarePon result=', ok, 'new lunban=', s.game.state.lunban, 'currentPlayer=', s.game.lunbanToPlayerId(s.game.state.lunban));
  if (!ok) {
    s.message = `player ${player} ポン不可 [mianzi=${mianzi}]、 候補待ち継続`;
    return { ...s };
  }
  clearReactionStage(s);
  // [2026-07-22 リョー要望] ポンもリーチ同様のカットインを出す
  enqueueCutinState(s as any, 'pon', player as any);
  s.lastZimo = null;
  s.message = `player ${player} ポン → 打牌してください`;
  return { ...s };
}

/** 大明槓宣言
 *  R4 P1 #15 fix: declareDamingang null は 不正 mianzi / 山枯渇 / rollback の 3 case 混在。
 *  shan.paishu を check して 「山枯渇 → 流局」 「それ以外 → 不正、 候補待ち維持」 を分離 */
export function damingangImpl(initial: StoreState, player: number, mianzi: string): StoreState {
  const s = initial;
  if (!s.lastDapai) return { ...s };
  const replacement = s.game.declareDamingang(player as any, mianzi, s.lastDapai.player as any);
  if (replacement === null) {
    const shanRem = (s.game.shan as any)?.paishu ?? 0;
    if (shanRem === 0) {
      // 山枯渇 [本当に流局]
      clearReactionStage(s);
      return applyPingjuTransition({ ...s }, `🌀 流局 [大明槓後 王牌枯渇]:`);
    }
    // 不正 mianzi / rollback 済み: 候補待ち継続
    s.message = `player ${player} 大明槓不可 [mianzi=${mianzi}]、 候補待ち継続`;
    return { ...s };
  }
  clearReactionStage(s);
  // [2026-07-22 リョー要望] カンもリーチ同様のカットインを出す
  enqueueCutinState(s as any, 'kan', player as any);
  // [2026-07-22 リョー報告: ミンカンして嶺上ツモしたらつもれなくなった]
  // 槓で消費した打牌が lastDapai に残ると、ツモ宣言 UI のゲート [!lastDapai] に
  // 塞がれて嶺上開花が宣言できず、和了種別も ロン に誤分類される
  s.lastDapai = null;
  s.lastZimo = replacement;
  s.message = `player ${player} 大明槓 [${mianzi}]、 嶺上 ${replacement}`;
  return { ...s };
}
