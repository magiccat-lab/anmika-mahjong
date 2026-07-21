import { describe, expect, it, vi } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 2026-07-21 監査 D-05: リーチ後の強制暗槓 [待ち不変] 候補があると、和了形でも
// canTsumo が false になり強制カンへ進んでいた。2026-07-15 裁定「ツモ和了は優先できる」
// に従い、和了成立を先に判定する。強制カン gate は和了しない場合だけ効く
// [dapai は throw、北抜きは不可のまま]。

function lizhiTsumoHand(): { g: Game3; player: PlayerId } {
  const g = new Game3({ qijia: 0 });
  g.qipai();
  const player = 0 as PlayerId;
  const sp = buildShoupai(['m1', 'm2', 'm3', 'p2', 'p3', 'p4', 'p6', 'p7', 'p8', 's3', 's4', 's5', 's8']);
  sp.zimo('s8');
  g.shoupai.set(player, sp);
  g.lizhi.add(player);
  return { g, player };
}

describe('D-05: ツモ和了は強制暗槓より優先', () => {
  it('強制暗槓候補があっても和了形なら canTsumo は true', () => {
    const { g, player } = lizhiTsumoHand();
    // 旧実装は候補が 1 つでもあると和了判定前に false を返していた
    vi.spyOn(g, 'getForcedLizhiKanCandidates').mockReturnValue(['p1111']);
    expect(g.canTsumo(player)).toBe(true);
    expect(g.hule(player)).not.toBeNull();
  });

  it('和了しない場合の gate は維持: 打牌 throw / 北抜き不可', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    // 既存裁定テストと同型の待ち不変カン形 [z4 単騎 + p1111、和了形ではない]
    g.shoupai.set(player, buildShoupai([
      'p1', 'p1', 'p1', 'p2', 'p3', 'p4', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z4',
    ]));
    (g.shoupai.get(player) as any).zimo('p1');
    g.lizhi.add(player);
    expect(g.getForcedLizhiKanCandidates(player)).toContain('p1111');
    expect(g.canTsumo(player)).toBe(false); // 和了形でないから false [カンへ進む]
    expect(() => g.dapai('z4')).toThrow(/待ち不変カンが必須/);
    expect(g.canNukiBei(player)).toBe(false);
  });
});
