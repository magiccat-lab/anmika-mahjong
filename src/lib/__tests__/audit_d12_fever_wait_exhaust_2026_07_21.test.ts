import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game, confirmPendingFeverBeforeDraw } from '../store';
import { buildShoupai } from '../game3';
import { toCorePai } from '../helpers';
import type { PlayerId } from '../types';

// 2026-07-21 監査 D-12: 成立済み FEVER の最後の待ち牌を見逃す [ロン pass で河に確定]
// と、待ち枯れ check が宣言直後にしかなく待ち 0 のまま進行していた。
// confirmPendingFeverBeforeDraw [全ツモ直前の共通点] で全成立済み FEVER を判定する。

describe('D-12: FEVER 待ち枯れの再判定', () => {
  beforeEach(() => {
    game.reset();
  });

  function armFeverSingleWait(): any {
    const s: any = get(game);
    const g = s.game;
    const sp = buildShoupai(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 'p7', 'p8', 'p9', 's1', 's2', 's3', 's9']);
    g.shoupai.set(0 as PlayerId, sp);
    g.lizhi.add(0 as PlayerId);
    g.feverActive[0] = true;
    g.feverDeclareTing[0] = ['s9'];
    return s;
  }

  it('待ち牌が山から消えていれば次ツモ前に流局する', () => {
    const s = armFeverSingleWait();
    const g = s.game;
    (g.shan as any)._pai = ((g.shan as any)._pai as string[]).filter((p) => toCorePai(p) !== 's9');
    const after = confirmPendingFeverBeforeDraw(s);
    expect(after.pendingPingju || after.roundEnded).toBe(true);
    expect(String(after.message)).toContain('待ち牌全消失');
  });

  it('待ち牌が山に残っていれば通常進行する', () => {
    const s = armFeverSingleWait();
    const g = s.game;
    const hasWait = ((g.shan as any)._pai as string[]).some((p) => toCorePai(p) === 's9');
    if (!hasWait) (g.shan as any)._pai.push('s9');
    const after = confirmPendingFeverBeforeDraw(s);
    expect(after.pendingPingju).toBe(false);
    expect(after.roundEnded).toBe(false);
  });
});
