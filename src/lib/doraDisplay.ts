import { toCorePai } from './helpers';

function displayDoraCore(pai: string): string {
  return toCorePai(String(pai).replace(/[+=\-_*]/g, '')).replace(/0$/, '5');
}

/** 局中ステータス用のドラ枚数。
 * expanded tile はcore牌へ寄せる一方、赤ドラ加算は物理的な m0/p0/s0 だけに行う。
 * 同じドラが複数表示されていれば、各表示枠ぶん重ねて数える。 */
export function countDisplayDora(tiles: string[], doraTiles: string[]): number {
  // A flower occupying an indicator slot is visible and counts as an
  // extracted flower at settlement, but it never designates a dora tile.
  const normalizedDora = doraTiles
    .filter((pai) => !toCorePai(String(pai)).startsWith('f'))
    .map(displayDoraCore);
  let count = 0;
  for (const raw of tiles) {
    const stripped = String(raw).replace(/[+=\-_*]/g, '');
    if (/^[mps]0$/.test(stripped)) count += 1;
    const core = displayDoraCore(stripped);
    count += normalizedDora.filter((dora) => dora === core).length;
  }
  return count;
}
