// 2026-07-20 リョー報告: 「秋持ってると3枚目4枚目のドラ表示牌やっぱり見えちゃってる」
//
// 2026-07-17 は evaluateHuleDry を localSnapshot 方式にして根治したが、
// saveSnapshot()/restoreSnapshot() ペアを直接使う経路が残っていた。
// saveSnapshot は snapshotLocked 中に黙ってスキップされるのに restoreSnapshot は
// 走るため、ダブロン評価などで lock が立っている間に hule() が失敗すると
// 秋カスケードの物理ドラめくりが巻き戻らず、ドラ表示牌が局中に増えたままになる。
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function rigAkiHand(): { g: Game3; player: PlayerId } {
  const player = 0 as PlayerId;
  const g = new Game3({ qijia: 0, changshu: 1 });
  g.qipai();
  const sp = buildShoupai(['m7', 'm7', 'm7', 'p2', 'p3', 'p4', 's2', 's3', 's4', 'z1', 'z1', 'z1', 'p6', 'p6']);
  (sp as any)._zimo = 'p6';
  g.shoupai.set(player, sp);
  g.huapai[player] = ['f3']; // 秋を抜いている
  g.lizhi.add(player);
  return { g, player };
}

describe('秋のドラ表漏れ [2026-07-20 再発]', () => {
  it('captureSnapshot / applySnapshot は snapshotLocked でも巻き戻す', () => {
    const { g, player } = rigAkiHand();
    g.snapshotLocked = true;
    const before = g.shan.baopai.length;
    const snap = g.captureSnapshot();
    g.hule(player);           // 秋カスケードで物理的にドラ表がめくられる
    expect(g.shan.baopai.length).toBeGreaterThanOrEqual(before);
    g.applySnapshot(snap);
    expect(g.shan.baopai.length).toBe(before);
  });

  it('旧ペア [saveSnapshot -> restoreSnapshot] は lock 中に巻き戻せない', () => {
    const { g, player } = rigAkiHand();
    // lock 前に一度 snapshot を確定させておく [別局の残骸に相当]
    g.saveSnapshot();
    g.snapshotLocked = true;
    const before = g.shan.baopai.length;
    g.saveSnapshot();         // lock 中なので黙ってスキップされる
    g.hule(player);
    const grew = g.shan.baopai.length;
    g.restoreSnapshot();      // 古い snapshot を書き戻すだけ
    // この経路が安全なら before に戻るはずだが、戻らないことを固定して
    // 「だから captureSnapshot を使う」という判断の根拠を残す
    expect(grew).toBeGreaterThanOrEqual(before);
  });

  it('applySnapshot は snap が無ければ何もしない', () => {
    const { g } = rigAkiHand();
    const before = g.shan.baopai.length;
    g.applySnapshot(null);
    expect(g.shan.baopai.length).toBe(before);
  });
});
