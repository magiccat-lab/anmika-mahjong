import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import { game } from '../store';
import type { PlayerId } from '../types';

describe('fever continuation discard reactions', () => {
  it('allows non-fever players to ron a discard made by the fever player', () => {
    const g = new Game3();
    g.qipai();
    g.feverActive[0] = true;
    g.shoupai.set(1 as PlayerId, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']));
    g.lizhi.add(1 as PlayerId);
    expect(g.canRon(1 as PlayerId, 's8', 0 as PlayerId)).toBe(true);
    expect(g.canRon(1 as PlayerId, 's8', 2 as PlayerId)).toBe(false);
  });

  it('continueFever preserves ron pending state after discarding the tsumo tile', () => {
    game.reset();
    const s: any = get(game);
    const g = s.game;
    g.feverActive[0] = true;
    g.shoupai.set(1 as PlayerId, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']));
    g.lizhi.add(1 as PlayerId);
    const p0 = buildShoupai(['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','m9']);
    p0.zimo('s8');
    g.shoupai.set(0 as PlayerId, p0);
    g.state.lunban = 0 as any;
    s.lastZimo = 's8';
    s.lastWinner = 0;
    s.lastHuleResult = {};
    s.pendingFeverContinue = { winner: 0, isRon: false };

    game.continueFever();

    const after: any = get(game);
    expect(after.lastDapai).toEqual({ player: 0, pai: 's8' });
    expect(after.awaitingRonDecision).toBe(true);
    expect(after.message).toContain('ロン可能');
  });
});
