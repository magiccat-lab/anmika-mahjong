// 2026-09-07 バグ通報 20260907_1 「最終局わんちゃんフリテン無視されてる」の裁定固定。
//
// 通報の局面 [最終局 / p2 CPU が p0 の p8 でロン] を再現すると、p2 の待ちは p1/p4/p7/p8 で
// 自河は z1,z2,z7,m9,s2,p5。待ち牌は 1 枚も自河に無いのでフリテンではなく、ロンは合法だった。
// [p0 は p8 を 2 回切っているが、フリテンは「和了者自身の河」で決まるので p0 の河は関係ない]
// 併せて、待ち牌が自河にある場合はちゃんとロンを弾くことも固定する。
//
// 未実装の穴 [別途裁定待ち]: 他家が和了牌を切ったのを見逃した時の
// 同巡内フリテン / 立直後の永久フリテンは canRon に無い [自河 check のみ]。
// CPU は常に自動ロンするため今回の局面には影響しない。
import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { buildShoupai } from '../game3';
import { createGameStore } from '../store';
import type { PlayerId } from '../types';

/** 通報された最終局の p2 [立直 / 北抜き 1] を復元する */
function setupReportedFinalRound(he: string[]) {
  const store: any = createGameStore();
  const s: any = get(store);
  const g: any = s.game;
  g.diyizimo = false;
  for (const p of [0, 1, 2] as PlayerId[]) {
    g.huapai[p] = [];
    g.goldHand[p] = { p: 0, s: 0, z: 0 };
    g.pochiHand[p] = { blue: 0, red: 0, green: 0, yellow: 0 };
    g.nukidora[p] = 0;
    g.nukidoraGold[p] = 0;
    g.he.get(p)._pai.length = 0;
  }
  g.shoupai.set(2, buildShoupai(['p2', 'p3', 'p4', 'p4', 'p5', 'p6', 'p7', 'p9', 'p9', 'p9', 's7', 's8', 's9']));
  g.nukidora[2] = 1;
  g.lizhi.add(2);
  g.he.get(2)._pai.push(...he);
  return g;
}

const REPORTED_HE = ['z1', 'z2', 'z7', 'm9', 's2', 'p5'];

describe('最終局のフリテン [バグ通報 20260907_1]', () => {
  it('待ちは p1/p4/p7/p8', () => {
    const g = setupReportedFinalRound(REPORTED_HE);
    expect(g.getTingpaiList(2 as PlayerId)).toEqual(['p1', 'p4', 'p7', 'p8']);
  });

  it('自河に待ち牌が無いので p8 ロンは合法', () => {
    const g = setupReportedFinalRound(REPORTED_HE);
    expect(g.canRon(2 as PlayerId, 'p8' as any, 0 as PlayerId)).toBe(true);
    expect(g.canRon(2 as PlayerId, 'p6' as any, 0 as PlayerId)).toBe(false);
  });

  it('待ち牌が自河にあればフリテンでロン不可', () => {
    for (const wait of ['p1', 'p4', 'p7', 'p8']) {
      const g = setupReportedFinalRound([...REPORTED_HE, wait]);
      expect(g.canRon(2 as PlayerId, 'p8' as any, 0 as PlayerId)).toBe(false);
    }
  });
});
