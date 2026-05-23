import { describe, it, expect, beforeEach } from 'vitest';
import { game } from '../store';
import { get } from 'svelte/store';
import { buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// CPU リーチ smart 判定 [リョー指示 2026-05-14]: 待ち枯渇なら declareLizhi 見送り
describe('cpuStep の CPU リーチ smart', () => {
  beforeEach(() => game.reset());

  it('cpuStep 実行で throw ナシ + 局進行', () => {
    const s = get(game);
    s.cpu = { 0: true, 1: true, 2: true };
    for (let i = 0; i < 30; i++) {
      expect(() => game.cpuStep()).not.toThrow();
      const after = get(game);
      if (after.roundEnded) break;
    }
  });

  it('テンパイ手 + 待ち枯渇 [全 4 枚 見える] で CPU lizhi 見送り', () => {
    const s = get(game);
    s.cpu[0] = true;
    // P0 テンパイ手: s8 単騎、 s8 を 他 player 河に 4 枚見えてる
    s.game.shoupai.set(0 as PlayerId, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']));
    const sp = s.game.shoupai.get(0 as PlayerId) as any;
    sp.zimo('s9');
    s.game.state.lunban = 0;
    // s8 が全 4 枚見えてる state を演出 [他 player 河に 4 枚]
    const he1 = s.game.he.get(1 as PlayerId) as any;
    he1._pai = ['s8', 's8'];
    const he2 = s.game.he.get(2 as PlayerId) as any;
    he2._pai = ['s8', 's8'];
    // canLizhi は true [テンパイ + zimo あり]
    expect(s.game.canLizhi(0 as PlayerId)).toBe(true);
    // cpuStep を 1 回呼んで、 lizhi 宣言されてない事 確認
    // ただし cpuStep 内部で 待ち枯渇 → declareLizhi skip するだけで、 dapai は実行する
    const lizhiBefore = s.game.lizhi.has(0 as PlayerId);
    game.cpuStep();
    const after = get(game);
    const lizhiAfter = after.game.lizhi.has(0 as PlayerId);
    // 枯渇なので リーチ 宣言されない
    expect(lizhiAfter).toBe(lizhiBefore); // false → false
  });

  // NOTE: 「待ち 1 枚以上 で CPU リーチ 宣言する」 は cpuStep 内部 update 経由で
  //       game.lizhi.add される flow が複雑、 testing harness 経由で再現が脆い。
  //       smart 判定 ロジック自体は src/lib/store/cpuActions.ts:41-65 にあり、
  //       一旦 「枯渇で見送り」 unit のみ verify。
});
