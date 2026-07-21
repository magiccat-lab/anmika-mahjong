import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 2026-07-21 監査 D-01: 表示 [表/裏ドラ表] の秋 f3 が、同一 FEVER 中の和了のたびに
// 再発動して表裏 1 組を余計に追加表示していた。akiUsedIndicators [物理 occurrence の
// 消費集合] で同じ表示秋は player ごとに一度しか発動しない。

function riichiTsumoGame(): { g: Game3; player: PlayerId } {
  const g = new Game3({ qijia: 0 });
  g.qipai();
  const player = 0 as PlayerId;
  // 立直ツモ和了できる固定手 [門前ピンフ形 + s8 ツモ]
  const sp = buildShoupai(['m1', 'm2', 'm3', 'p2', 'p3', 'p4', 'p6', 'p7', 'p8', 's3', 's4', 's5', 's8']);
  sp.zimo('s8');
  g.shoupai.set(player, sp);
  g.lizhi.add(player);
  return { g, player };
}

describe('D-01: 表示の秋の再発動防止', () => {
  it('表示の秋 f3 は同じ player の 2 回目の hule では発動しない', () => {
    const { g, player } = riichiTsumoGame();
    (g.shan as any)._baopai = ['f3'];
    (g.shan as any)._fubaopai = ['m9'];
    const baopaiLenBefore = g.shan.baopai.length;

    const r1 = g.hule(player);
    expect(r1).not.toBeNull();
    const lenAfterFirst = g.shan.baopai.length;
    // 1 回目: 表示の秋が発動して表示が増える
    expect(lenAfterFirst).toBeGreaterThan(baopaiLenBefore);
    expect((g.akiUsedIndicators[player] ?? []).includes('baopai:0')).toBe(true);

    // FEVER 続行を模擬して同じ player がもう一度和了 [手はそのまま]
    const sp2 = buildShoupai(['m1', 'm2', 'm3', 'p2', 'p3', 'p4', 'p6', 'p7', 'p8', 's3', 's4', 's5', 's8']);
    sp2.zimo('s8');
    g.shoupai.set(player, sp2);
    const r2 = g.hule(player);
    expect(r2).not.toBeNull();
    // 2 回目: 消費済みの表示秋 [baopai:0] は再発動せず、1 回目の連鎖で増えた表示に
    // f3 が無ければ表示枚数は変わらない
    const newAkiRevealed = g.shan.baopai.slice(baopaiLenBefore).filter((p: string) => p === 'f3').length
      + (g.shan.fubaopai ?? []).slice(1).filter((p: string) => p === 'f3').length;
    if (newAkiRevealed === 0) {
      expect(g.shan.baopai.length).toBe(lenAfterFirst);
    } else {
      // 連鎖で新たに出た f3 の分だけは正しく発動してよい [その分も消費記録される]
      expect(g.shan.baopai.length).toBeGreaterThanOrEqual(lenAfterFirst);
    }
  });

  it('restoreSnapshot で消費記録も pre-hule へ巻き戻る [ダブロン評価互換]', () => {
    const { g, player } = riichiTsumoGame();
    (g.shan as any)._baopai = ['f3'];
    (g.shan as any)._fubaopai = ['m9'];
    g.saveSnapshot();
    const r1 = g.hule(player);
    expect(r1).not.toBeNull();
    expect((g.akiUsedIndicators[player] ?? []).length).toBeGreaterThan(0);
    g.restoreSnapshot();
    expect((g.akiUsedIndicators[player] ?? []).length).toBe(0);
  });

  it('nextRound 相当のリセットで消費記録がクリアされる', () => {
    const { g, player } = riichiTsumoGame();
    (g.shan as any)._baopai = ['f3'];
    const r1 = g.hule(player);
    expect(r1).not.toBeNull();
    expect((g.akiUsedIndicators[player] ?? []).length).toBeGreaterThan(0);
    g.nextRound({ winner: player });
    expect(g.akiUsedIndicators[0]).toEqual([]);
    expect(g.akiUsedIndicators[1]).toEqual([]);
    expect(g.akiUsedIndicators[2]).toEqual([]);
  });
});
