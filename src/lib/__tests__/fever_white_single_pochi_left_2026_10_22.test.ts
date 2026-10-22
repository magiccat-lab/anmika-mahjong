import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game, confirmPendingFeverBeforeDraw } from '../store';
import { buildShoupai } from '../game3';
import { toCorePai } from '../helpers';
import type { PlayerId } from '../types';

// 2026-10-22 通報 [Z1IG rev 2589]: 白単騎のフィーバーが宣言直後に流局し、
// 「待ち牌が山に残っていない」と出た。山には z5g / z5r / z5y が生きていた。
// 白は 4 枚とも色付きのぽっちで、ルール 5-3 によりぽっちだけの残りは待ちとみなさないので流局は正しい。
// 文言だけ「山に白ぽっちしか残っていない」に分ける。

describe('白単騎フィーバーの流局の文言', () => {
  beforeEach(() => {
    game.reset();
  });

  function armWhiteSingle(): any {
    const s: any = get(game);
    const g = s.game;
    const sp = buildShoupai(['m7', 'm7', 'm7', 'p2', 'p2', 'p2', 'p6', 'p7', 'p8', 's4', 's5', 's6', 'z5b']);
    g.shoupai.set(1 as PlayerId, sp);
    g.lizhi.add(1 as PlayerId);
    g.feverActive[1] = true;
    g.feverDeclareTing[1] = ['z5'];
    return s;
  }

  it('山に白ぽっちが残っていれば 5-3 の流局と書く', () => {
    const s = armWhiteSingle();
    const wall = ((s.game.shan as any)._pai as string[]).filter((p) => toCorePai(p) !== 'z5');
    wall.push('z5g', 'z5r', 'z5y');
    (s.game.shan as any)._pai = wall;
    const after = confirmPendingFeverBeforeDraw(s);
    expect(after.pendingPingju || after.roundEnded).toBe(true);
    expect(String(after.message)).toContain('白ぽっちしか残っていない');
    expect(String(after.message)).not.toContain('待ち牌が山に残っていない');
  });

  it('山に白が 1 枚も無ければ今までどおり「山に残っていない」', () => {
    const s = armWhiteSingle();
    (s.game.shan as any)._pai = ((s.game.shan as any)._pai as string[]).filter((p) => toCorePai(p) !== 'z5');
    const after = confirmPendingFeverBeforeDraw(s);
    expect(after.pendingPingju || after.roundEnded).toBe(true);
    expect(String(after.message)).toContain('待ち牌が山に残っていない');
  });
});
