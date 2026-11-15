// オープンリーチ者の待ち牌と、見ている人の視点での残り枚数 [2026-11-15 先輩「オープンリーチの待ちをフィーバーと同じ様に出して」]
// 待ちは isOpenReachWaitDiscardForbidden と同じ getTingpaiList なので、この一覧 = 他家の打牌禁止牌。
// 残りは riichiWaitSuggest と同じく見える牌だけで数える [自分の手牌 ・ 河 ・ 副露 ・ ドラ表示 ・ 抜き北]
// 加えてオープンリーチ者の手牌 [全員に公開済み] も見える牌に入れる。他家の伏せ手牌と山は使わない。
import { kanpamanUnseen, TILES_PER_KIND, visibleTileCounts, waitCoreOf } from './riichiWaitSuggest';

export type OpenLizhiWaitRow = { tile: string; remain: number | null };
export type OpenLizhiWaits = { player: number; waits: OpenLizhiWaitRow[] };

function countHand(sp: any, counts: Record<string, number>): void {
  const bing = sp?._bingpai;
  if (!bing) return;
  for (const suit of ['m', 'p', 's', 'z'] as const) {
    const max = suit === 'z' ? 7 : 9;
    for (let n = 1; n <= max; n++) {
      const c = bing[suit]?.[n] ?? 0;
      if (c > 0) counts[`${suit}${n}`] = (counts[`${suit}${n}`] ?? 0) + c;
    }
  }
}

/**
 * @param skip フィーバー確定済みなど、別の枠で出している席
 * 残りが null の待ちは白ぽっち [z5、何にでもなるので数えない]
 */
export function openLizhiWaitRows(g: any, viewer: number, skip: (p: number) => boolean = () => false): OpenLizhiWaits[] {
  const opens: Set<number> | undefined = g?.openLizhi;
  if (!opens || opens.size === 0) return [];
  const seen = visibleTileCounts(g, viewer);
  for (const r of opens) {
    if (r === viewer) continue; // 自分の手牌は visibleTileCounts が数え済み
    countHand(g.shoupai?.get?.(r), seen);
  }
  const out: OpenLizhiWaits[] = [];
  for (const r of [0, 1, 2]) {
    if (!opens.has(r) || skip(r)) continue;
    let tings: string[] = [];
    try { tings = g.getTingpaiList?.(r) ?? []; } catch { tings = []; }
    const done = new Set<string>();
    const waits: OpenLizhiWaitRow[] = [];
    for (const w of tings) {
      const tile = waitCoreOf(w);
      if (!/^[mpsz][1-9]$/.test(tile) || done.has(tile)) continue;
      done.add(tile);
      waits.push({
        tile,
        remain: tile === 'z5' ? null
          : tile === 'm8' ? kanpamanUnseen(g, viewer)
          : Math.max(0, TILES_PER_KIND - (seen[tile] ?? 0)),
      });
    }
    if (waits.length > 0) out.push({ player: r, waits });
  }
  return out;
}
