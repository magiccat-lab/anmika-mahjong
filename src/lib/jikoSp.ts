// [2026-11-04 リョー「フィーバーリーチ中に逆を引いたとき、しかも消えるチップが50枚以上のとき、
//  画面全員ブラックアウトして…曲が流れるようなSP演出ないかな。隠し演出で」]
// 出る条件: 和了った人が和了の時点でフィーバー中 (_feverAtHule) で、逆ぽっちで払いが反転し (_pochiPaymentApplied)、
// この和了でその人のチップが 50 枚以上減った (chipTransfer.delta、冬の後払いも足し込み済み)。
// 隠し演出なので演出一覧 (fxOdds.ts) には載せない。オンラインは全席が同じ和了の結果を受け取るので、各画面がここで同じ判定をする
export const JIKO_SP_MIN_LOSS = 50;
// [11-04 リョー B1「ツモった瞬間つもったものみせず真っ暗にして、雷が落ちて、テキストとかなしで、事故は起きるものさ原曲のサビから
//  再生される感じで、その後にポッチが浮かび上がってきて」] 和了の帯 ・ 和了の板より先に出し、明けてから帯と板を出す
/** 暗転の長さ。真っ暗 → 雷 (0.6 秒) → ぽっちが浮かぶ → 明ける */
export const JIKO_SP_BLACK_MS = 4500;
/** 雷が落ちる時刻。曲もここでサビから鳴らす */
export const JIKO_SP_BOLT_MS = 600;
/** 曲を流す長さ (原曲カラオケのサビ 27 秒)。暗転が明けた後も卓の上で流し、最後の 2.5 秒で下げる。この間は BGM を消す */
export const JIKO_SP_SONG_MS = 27000;
export const JIKO_SP_SONG = '/sounds/bgm/jiko_sp.mp3';

export type JikoSpHit = { key: string; player: 0 | 1 | 2; loss: number; pochi: 'red' | 'yellow' };

export function jikoSpFor(entries: Array<{ player: number; result: any }>, roundKey: string): JikoSpHit | null {
  for (const e of entries) {
    const r = e?.result;
    if (!r || !r._feverAtHule || !r._pochiPaymentApplied) continue;
    const p = e.player as 0 | 1 | 2;
    const d = Number(r.chipTransfer?.delta?.[p]);
    if (!Number.isFinite(d)) continue;
    const loss = -d;
    if (loss < JIKO_SP_MIN_LOSS) continue;
    return { key: `${roundKey}-${p}-${loss}`, player: p, loss, pochi: r._pochiReverseColor === 'red' ? 'red' : 'yellow' };
  }
  return null;
}
