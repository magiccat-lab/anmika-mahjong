import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';
import { openLizhiWaitRows } from '../openLizhiWaits';

// オープンリーチの待ちと残り枚数 [2026-11-15 先輩]
function makeGame() {
  const g = new Game3();
  g.qipai();
  const reacher = 0 as PlayerId;
  // p123 p456 p789 s11 s22 : s1 s2 の双碰待ち
  g.shoupai.set(reacher, buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 's1', 's1', 's2', 's2']));
  g.openLizhi.add(reacher);
  // 観る側の手牌も決め打ち [s1 s2 を持たない]
  for (const p of [1, 2]) g.shoupai.set(p as PlayerId, buildShoupai(['m2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'z1', 'z1', 'z2', 'z2', 'z3']));
  // 配牌時の河とドラ表示を空にして数字を決め打ちにする
  for (const p of [0, 1, 2]) (g.he.get(p as PlayerId) as any)._pai = [];
  (g.shan as any)._baopai = [];
  (g.shan as any).commitDoraReveal();
  return { g, reacher };
}
const byTile = (rows: ReturnType<typeof openLizhiWaitRows>) =>
  Object.fromEntries(rows[0].waits.map((w) => [w.tile, w.remain]));

describe('openLizhiWaitRows', () => {
  it('待ちは getTingpaiList と同じ集合 [= 他家の打牌禁止牌]', () => {
    const { g, reacher } = makeGame();
    const rows = openLizhiWaitRows(g, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].player).toBe(reacher);
    const expected = new Set((g.getTingpaiList(reacher) as string[]).map((t) => t));
    expect(new Set(rows[0].waits.map((w) => w.tile))).toEqual(expected);
  });

  it('他家の視点: オープン手牌の 2 枚ずつを引いた残り 2', () => {
    const { g } = makeGame();
    expect(byTile(openLizhiWaitRows(g, 1))).toEqual({ s1: 2, s2: 2 });
  });

  it('宣言者本人の視点でも二重に数えず同じ残り', () => {
    const { g } = makeGame();
    expect(byTile(openLizhiWaitRows(g, 0))).toEqual({ s1: 2, s2: 2 });
  });

  it('河とドラ表示牌も引く', () => {
    const { g } = makeGame();
    (g.he.get(2 as PlayerId) as any)._pai.push('s1');
    (g.shan as any)._baopai = ['s2'];
    (g.shan as any).commitDoraReveal();
    expect(byTile(openLizhiWaitRows(g, 1))).toEqual({ s1: 1, s2: 1 });
  });

  it('オープンリーチ者がいなければ空、skip した席は出さない', () => {
    const g = new Game3();
    g.qipai();
    expect(openLizhiWaitRows(g, 0)).toEqual([]);
    const { g: g2 } = makeGame();
    expect(openLizhiWaitRows(g2, 1, (p) => p === 0)).toEqual([]);
  });
});
