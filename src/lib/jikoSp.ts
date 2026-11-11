// [2026-11-04 リョー「フィーバーリーチ中に逆を引いたとき、しかも消えるチップが50枚以上のとき、
//  画面全員ブラックアウトして…曲が流れるようなSP演出ないかな。隠し演出で」]
// 出る条件: 和了った人が和了の時点でフィーバー中 (_feverAtHule) で、逆ぽっちで払いが反転し (_pochiPaymentApplied)、
// この和了でその人のチップが 50 枚以上減った (chipTransfer.delta、冬の後払いも足し込み済み)。
// 隠し演出なので演出一覧 (fxOdds.ts) には載せない。オンラインは全席が同じ和了の結果を受け取るので、各画面がここで同じ判定をする
export const JIKO_SP_MIN_LOSS = 50;
// [11-04 リョー B1「ツモった瞬間つもったものみせず真っ暗にして、雷が落ちて、テキストとかなしで、事故は起きるものさ原曲のサビから
//  再生される感じで、その後にポッチが浮かび上がってきて」] 和了の帯 ・ 和了の板より先に出し、明けてから帯と板を出す
// [11-04 リョー 2 版 V1「もうちょいゆっくりでもいいけどね」] 4.5 秒 → 7 秒。真っ暗の間 ・ 雷 ・ ぽっちの浮き上がりをそれぞれ延ばした
/** 暗転の長さ。真っ暗 → 雷 (1.2 秒) → ぽっちが浮かぶ → 明ける */
export const JIKO_SP_BLACK_MS = 7000;
/** 雷が落ちる時刻。曲もここでサビから鳴らす */
export const JIKO_SP_BOLT_MS = 1200;
// [11-04 リョー 2 版 S1「いや、原曲そのままにしてくれ」] 27 秒で切って下げるのをやめ、原曲カラオケのサビ (34.6 秒) から曲の終わりまで流す。
// 流れている間は BGM を消し、曲が終わったら BGM に戻す
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

// [2026-11-12 リョー「事故演出起きた後逆ツモで演出もっかいきてるしBGMが次の局でも治らない」]
// フィーバー続行で同じ局のうちに同じ人が逆ツモを重ねると (6HJK 東2局1本場は 72 ・ 100 ・ 100 ・ 128 枚の 4 回)、
// 試し打ちの印 (局 ・ 席 ・ 枚数) は枚数が変わるたびに新しく、暗転と曲が 3 回出ていた。暗転は 1 つの局 ・ 席で 1 回だけにする
/** 局 ・ 席の印。key は `${局}-${席}-${枚数}` */
export function jikoRoundSeat(key: string): string {
  return `rp:${key.slice(0, key.lastIndexOf('-'))}`;
}
/** 試し打ちの当たりを使ってよいか。その局 ・ 席で暗転を出した後は、暗転中 (今のツモの分) だけ通し、明けた後の逆ツモは普通の絞りに戻す */
export function jikoPreAllowed(roundKey: string, player: number, seen: ReadonlySet<string>, blackoutNow: boolean): boolean {
  return blackoutNow || !seen.has(`rp:${roundKey}-${player}`);
}
/** 曲を止める時か。曲は鳴らし始めた局が終わって次の局 (次の試合を含む) に入ったら止め、BGM に戻す */
export function jikoSongOutOfRound(songRound: string | null, roundKeyNow: string, eventsLen: number): boolean {
  return songRound !== null && (roundKeyNow !== songRound || eventsLen < 2);
}
