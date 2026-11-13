/**
 * 「演出を短く」[prefs.shortFx] の尺の係数。この端末の画面の待ちだけを縮める。
 * [2026-11-13 リョー ○× anmika_sakurai1 T3] 既定 [shortFx = false] では ms をそのまま返す。
 * サーバーの時間 ・ 他の人の画面の時間には触らない [online でも各 client が自分の画面の待ちだけ縮める]。
 */
import { get } from 'svelte/store';
import { prefs } from './prefs';

export const SHORT_FX_RATIO = 0.5;

export function shortFxOn(): boolean {
  return get(prefs).shortFx === true;
}

/** 演出の待ち ms。短縮が切れていれば元の値のまま */
export function fxMs(ms: number, ratio: number = SHORT_FX_RATIO): number {
  return shortFxOn() ? Math.max(1, Math.round(ms * ratio)) : ms;
}
