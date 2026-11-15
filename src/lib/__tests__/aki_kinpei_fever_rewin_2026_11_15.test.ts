import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 2026-11-15 通報 DD6G rev 692「秋秋金北したらなんかドラ表示数バグってる」:
// 手の秋 1 枚 + 金北 [秋] の和了で 2 枚目の秋 f3 がドラ表に開くと秋秋金北へ移る。
// その f3 が消費済みに記録されず、同じフィーバー中の次の和了で表示の秋 1 枚に
// 金北の強化がまた乗り、表裏 2 組を余計にめくっていた。

function setHand(g: Game3, player: PlayerId) {
  const sp = buildShoupai(['m1', 'm2', 'm3', 'p2', 'p3', 'p4', 'p6', 'p7', 'p8', 's3', 's4', 's5', 's8']);
  sp.zimo('s8');
  g.shoupai.set(player, sp);
}

describe('秋金北で開いた秋は同じフィーバーの次の和了で再発動しない', () => {
  it('2 回目の hule ではドラ表が増えない', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    const player = 0 as PlayerId;
    g.lizhi.add(player);
    g.huapai[player] = ['f3'];
    g.kinpeiTarget[player] = 'aki';
    (g.shan as any)._baopai = ['m9', 'z7'];
    (g.shan as any)._fubaopai = ['p6', 'p1'];
    // 秋めくりは _pai 先頭から [表, 裏] の順。1 組目の表に 2 枚目の秋を置く
    const pai: string[] = (g.shan as any)._pai;
    pai.splice(0, 6, 'f3', 'z1', 'ns3', 's8', 's9', 'z3');

    setHand(g, player);
    const r1 = g.hule(player);
    expect(r1).not.toBeNull();
    // 1 回目: 秋金北 → 開いた秋で秋秋金北。めくりは 2 組 [3 組目は無し]
    expect(g.shan.baopai).toEqual(['m9', 'z7', 'f3', 'ns3']);
    expect(g.akiUsedIndicators[player]).toContain('baopai:2');

    setHand(g, player);
    const r2 = g.hule(player);
    expect(r2).not.toBeNull();
    expect(g.shan.baopai).toEqual(['m9', 'z7', 'f3', 'ns3']);
    expect(g.shan.fubaopai).toEqual(['p6', 'p1', 'z1', 's8']);
  });
});
