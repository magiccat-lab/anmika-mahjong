import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// [2026-11-04 通報 isg. 「フィーバー逆後の放銃トビ賞に倍率が乗ってない」 D3NH rev 5080]
// フィーバー中の逆ぽっちの後のロンで和了者が自分で飛ぶと、トビ賞は放銃者が受け取る。
// 他の祝儀と同じく和了者の倍率 [シュバ ・ フィーバー ・ ぽっち] で和了者が払う。旧実装は受取側の倍率 [×1] で 5 枚だった
function freshGame(): Game3 {
  const g = new Game3({ qijia: 0 });
  g.qipai();
  g.diyizimo = false;
  g.state.benbang = 0;
  g.state.lizhibang = 0;
  g.chipLedger = { 0: 0, 1: 0, 2: 0 };
  g.shoupai.set(1 as PlayerId, buildShoupai([
    'm1', 'm1', 'm1',
    'm9', 'm9', 'm9',
    'p1', 'p1', 'p1',
    's1', 's1', 's1',
    'z1', 'z1',
  ]));
  g.huapai[1] = [];
  g.nukidora[1] = 0;
  g.nukidoraGold[1] = 0;
  g.goldHand[1] = { p: 0, s: 0, z: 0 };
  g.pochiHand[1] = { blue: 0, red: 0, green: 0, yellow: 0 };
  return g;
}

describe('fever reverse ron self-bust tobi prize 2026-11-04', () => {
  it('フィーバー tier3 ×4 の黄の逆ロンで和了者が飛ぶとトビ賞は 5×4 = 20 枚を放銃者へ', () => {
    const g = freshGame();
    g.state.defen = { 0: 35000, 1: 1000, 2: 35000 };
    g.feverActive[1] = true;
    g.feverTier[1] = 3;
    g.pochiMultiplier[1] = { defen: -1, chip: -1 };
    g.pochiPaymentMode[1] = true;

    g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, 1 as PlayerId, 0 as PlayerId);

    expect(g.state.defen[1]).toBeLessThan(0);
    const tobi = g.chipBreakdown.filter((b) => b.label.includes('トビ賞 [p1 飛び]'));
    expect(tobi).toHaveLength(1);
    expect(Math.abs(tobi[0].total)).toBe(20);
    // 和了者の払い、放銃者の受け取り [他の祝儀は 0 枚の手なのでトビ賞だけ]
    expect(g.chipLedger).toEqual({ 0: 20, 1: -20, 2: 0 });
  });

  it('逆でない普通のロンのトビ賞は今まで通り和了者の倍率で受け取る', () => {
    const g = freshGame();
    g.state.defen = { 0: 1000, 1: 35000, 2: 35000 };
    g.feverActive[1] = true;
    g.feverTier[1] = 3;

    g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, 1 as PlayerId, 0 as PlayerId);

    expect(g.state.defen[0]).toBeLessThan(0);
    const tobi = g.chipBreakdown.filter((b) => b.label.includes('トビ賞 [p0 飛び]'));
    expect(tobi).toHaveLength(1);
    expect(tobi[0].total).toBe(20);
  });
});
