import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import { addAnmikaPai } from '../helpers';
import type { PlayerId } from '../types';

// 2026-07-21 監査 S-03: 他家 FEVER 中の非 FEVER 者は canNukiBei がツモ牌 z4 のみを
// 許すが、meta.gold の指定でツモった金北の代わりに手持ちの通常北 [逆も] を消費でき、
// 強制ツモ切り制約と物理牌祝儀を回避できた。declareNukiBei [client/server 共通の根元]
// で物理属性をツモ牌に固定する。

function armFeverBystander(zimoPai: 'z4' | 'gN'): { g: Game3; player: PlayerId } {
  const g = new Game3({ qijia: 0 });
  g.qipai();
  const player = 0 as PlayerId;
  // 手牌に通常北 1 枚を持つ非 FEVER 者
  const sp = buildShoupai(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's2', 's3', 's7', 's8', 's9', 'z4']);
  if (zimoPai === 'gN') {
    sp.zimo('z4');
    (sp as any)._zimo = 'gN';
    addAnmikaPai(sp, 'gN', 1);
    g.goldHand[player].z += 1;
  } else {
    sp.zimo('z4');
  }
  g.shoupai.set(player, sp);
  g.feverActive[1] = true; // 他家 FEVER 中
  return { g, player };
}

describe('S-03: 非 FEVER 者の北抜きは物理ツモ牌に固定', () => {
  it('金北ツモ中に通常北 [meta.gold=false] を抜く偽装は拒否される', () => {
    const { g, player } = armFeverBystander('gN');
    expect(g.canNukiBei(player)).toBe(true);
    const replacement = g.declareNukiBei(player, { gold: false });
    expect(replacement).toBeNull();
    expect(g.nukidora[player]).toBe(0);
    expect(g.nukidoraGold[player]).toBe(0);
  });

  it('金北ツモ中の meta 未指定は金北として抜かれる [自動一致]', () => {
    const { g, player } = armFeverBystander('gN');
    const replacement = g.declareNukiBei(player);
    expect(replacement).not.toBeNull();
    expect(g.nukidoraGold[player]).toBe(1);
    expect(g.nukidora[player]).toBe(0);
  });

  it('通常北ツモ中に金北 [meta.gold=true] を指定する逆方向も拒否される', () => {
    const { g, player } = armFeverBystander('z4');
    g.goldHand[player].z += 1; // 手牌に金北があると偽装できた状況
    const replacement = g.declareNukiBei(player, { gold: true });
    expect(replacement).toBeNull();
  });

  it('FEVER が誰もいなければ従来どおり meta 指定で選べる', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    const player = 0 as PlayerId;
    const sp = buildShoupai(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's2', 's3', 's7', 's8', 's9', 'z4']);
    sp.zimo('z4');
    g.shoupai.set(player, sp);
    const replacement = g.declareNukiBei(player, { gold: false });
    expect(replacement).not.toBeNull();
    expect(g.nukidora[player]).toBe(1);
  });
});
