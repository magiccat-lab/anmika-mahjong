/** 演出に出す語。字形は public/fonts のサブセット ('FX Kana') が持つ。
 *
 *  [2026-09-20] 最初は手書きの SVG ストロークで字を描いていたが、案の字形と
 *  別物になってリョーに指摘された ("フォントとか全然ちゃうやん")。
 *  必要な 22 グリフだけの Noto Sans JP 900 (7.6KB、SIL OFL) を self-host して
 *  実フォントで出す形に変えた。語を足す時は public/fonts/README.md の手順で
 *  サブセットを取り直す。 */
import type { CutinId } from './store';

export const FX_LABELS: Record<CutinId, string> = {
  reach: 'リーチ', ron: 'ロン', tsumo: 'ツモ', fever: 'フィーバー', kan: 'カン', pon: 'ポン',
};
