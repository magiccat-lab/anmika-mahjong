import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game, confirmPendingFeverBeforeDraw } from '../store';
import { buildShoupai } from '../game3';
import { feverWaitInfoFromLiveWall } from '../game3/feverLizhi';
import { toCorePai } from '../helpers';
import type { PlayerId } from '../types';

// 2026-10-22 通報 [Z1IG rev 2589]: 白単騎のフィーバーが宣言直後に流局した。山には z5g / z5r / z5y が生きていた。
// リョー「白単騎待ちとして見るから3枚残り扱いになるよ、これはただの白単騎待ちだから」。
// ルール 5-3 (ぽっちだけの残りは待ちとみなさない) は、ぽっちを他の待ちの代わりに数えない話で、白単騎には当てない。

describe('白単騎フィーバーは山の白を待ちとして数える', () => {
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

  it('山に白が 3 枚あれば流局せず、残り 3 枚と数える', () => {
    const s = armWhiteSingle();
    const wall = ((s.game.shan as any)._pai as string[]).filter((p) => toCorePai(p) !== 'z5');
    wall.push('z5g', 'z5r', 'z5y');
    (s.game.shan as any)._pai = wall;
    expect(s.game.isFeverWaitExhausted(1)).toBe(false);
    const after = confirmPendingFeverBeforeDraw(s);
    expect(after.pendingPingju || after.roundEnded).toBeFalsy();
    expect(feverWaitInfoFromLiveWall(['z5'], wall)[0].remain).toBe(3);
  });

  it('山に白が 1 枚も無ければ今までどおり「山に残っていない」で流局', () => {
    const s = armWhiteSingle();
    (s.game.shan as any)._pai = ((s.game.shan as any)._pai as string[]).filter((p) => toCorePai(p) !== 'z5');
    const after = confirmPendingFeverBeforeDraw(s);
    expect(after.pendingPingju || after.roundEnded).toBe(true);
    expect(String(after.message)).toContain('待ち牌が山に残っていない');
  });

  it('白以外の待ちは、山に白ぽっちしか無ければ 5-3 で流局のまま', () => {
    const s = armWhiteSingle();
    s.game.feverDeclareTing[1] = ['s9'];
    const wall = ((s.game.shan as any)._pai as string[]).filter((p) => toCorePai(p) !== 's9' && toCorePai(p) !== 'z5');
    wall.push('z5g', 'z5r', 'z5y');
    (s.game.shan as any)._pai = wall;
    (s.game.shan as any)._rinshan = ((s.game.shan as any)._rinshan as string[] ?? []).filter((p) => toCorePai(p) !== 's9');
    expect(s.game.isFeverWaitExhausted(1)).toBe(true);
  });
});
