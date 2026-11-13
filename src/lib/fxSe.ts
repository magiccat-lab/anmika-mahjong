// 打牌 ・ リーチ ・ ロン ・ ツモの効果音 [2026-11-13 リョー ○× anmika_sakurai1 H2]
// 強さは卓への影響順: ロン ・ ツモ (最大) > リーチ > 打牌 (小さく短く)。尾は 0.3 秒以内 [速い連打でにじまない]。
// 音は public/sounds の se_discard / se_riichi / se_hule [ffmpeg で合成、各 5KB 以下]。ミュートは playSound が見る。
import { playSound } from './prefs';

export const SE_DISCARD = '/sounds/se_discard.mp3';
export const SE_RIICHI = '/sounds/se_riichi.mp3';
export const SE_HULE = '/sounds/se_hule.mp3';
export const SE_VOL = { discard: 0.22, riichi: 0.6, hule: 0.95 } as const;
/** 和了のビート [ms]。この間は止めてから帯 ・ 音 ・ フラッシュを出す [H1] */
export const HULE_HOLD_MS = 120;
/** 打牌音の最小間隔。CPU は 0ms で打つので、連打を 1 音にまとめる */
export const DISCARD_SE_MIN_GAP_MS = 90;

let lastDiscardAt = -Infinity;

/** 打牌音。直前の音から DISCARD_SE_MIN_GAP_MS 未満なら鳴らさない */
export function playDiscardSe(now: number = Date.now()): boolean {
  if (now - lastDiscardAt < DISCARD_SE_MIN_GAP_MS) return false;
  lastDiscardAt = now;
  playSound(SE_DISCARD, SE_VOL.discard);
  return true;
}
export function playRiichiSe(): void { playSound(SE_RIICHI, SE_VOL.riichi); }
export function playHuleSe(): void { playSound(SE_HULE, SE_VOL.hule); }
// [2026-11-13 リョー ○× anmika_voice1 2 版目 B1 a ・ A5 a] 発声の声。全員のリーチ ・ ロン ・ ツモ ・ ポン ・ カン ・ フィーバーリーチに付ける
// 声は Irodori-TTS の説明文だけで作った声 c [実在の声優の録音は使っていない]。public/sounds/voice/ は git に入れない [無ければ鳴らないだけ]
export const CALL_VOICE: Readonly<Record<string, string>> = {
  reach: '/sounds/voice/call_riichi.mp3', ron: '/sounds/voice/call_ron.mp3', tsumo: '/sounds/voice/call_tsumo.mp3',
  pon: '/sounds/voice/call_pon.mp3', kan: '/sounds/voice/call_kan.mp3', fever: '/sounds/voice/call_fever.mp3',
};
export const CALL_VOICE_VOL = 0.9;
/** 帯の id に声があれば鳴らす。鳴らしたら true */
export function playCallVoice(id: string): boolean {
  const src = CALL_VOICE[id];
  if (!src) return false;
  playSound(src, CALL_VOICE_VOL);
  return true;
}
export function _resetDiscardSeForTest(): void { lastDiscardAt = -Infinity; }
