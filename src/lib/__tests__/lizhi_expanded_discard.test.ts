import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { createGameStore } from '../store';
import { buildShoupai } from '../game3';

describe('expanded riichi declaration discard', () => {
  it('Game3 itself rejects a forged FEVER check without a legal declaration discard', () => {
    const store = createGameStore();
    const state = get(store);
    const player = state.game.lunbanToPlayerId(state.game.state.lunban);
    const beforeDefen = state.game.state.defen[player];
    const beforeSticks = state.game.state.lizhibang;
    vi.spyOn(state.game, 'canLizhi').mockReturnValue(true);
    vi.spyOn(state.game, 'getLizhiCandidates').mockReturnValue(['p1']);
    vi.spyOn(state.game, 'feverCandidatesByDapai').mockReturnValue(new Map([
      ['p2', { ok: true, tiles: ['p7'], tier: 1 as const }],
    ]));

    expect(state.game.declareLizhi({
      fever: true,
      feverCheck: { ok: true, tiles: ['p7'], tier: 1 },
      feverDapai: 'p2',
    })).toBe(false);
    expect(state.game.lizhi.has(player)).toBe(false);
    expect(state.game.feverActive[player]).toBe(false);
    expect(state.game.state.defen[player]).toBe(beforeDefen);
    expect(state.game.state.lizhibang).toBe(beforeSticks);
  });

  it('does not enter FEVER pending without a post-discard candidate that also preserves riichi', () => {
    const store = createGameStore();
    const state = get(store);
    const player = state.game.lunbanToPlayerId(state.game.state.lunban);
    vi.spyOn(state.game, 'canLizhi').mockReturnValue(true);
    vi.spyOn(state.game, 'getLizhiCandidates').mockReturnValue(['p1']);
    vi.spyOn(state.game, 'feverCandidatesByDapai').mockReturnValue(new Map([
      ['p2', { ok: true, tiles: [], tier: 1 as const, rainbow: true }],
    ]));

    store.lizhi({ fever: true });

    const after = get(store);
    expect(after.lizhiPending).toBeNull();
    expect(after.game.lizhi.has(player)).toBe(false);
    expect(after.message).toContain('フィーバー条件未達');
  });

  it('accepts a physical gold tile through the expanded declaration candidate', () => {
    const game = createGameStore();
    game.resetDebug(
      ['p1', 'p1', 'p1', 'p2', 'p2', 'p2', 'p3', 'p3', 'p3', 's7', 's7', 's7', 's8'],
      [],
      { forceShan: ['gp'] },
    );
    const before = get(game);
    expect(before.lastZimo).toBe('gp');
    expect(before.game.getLizhiCandidates(0).map((pai) => pai.replace(/_$/, ''))).toContain('gp');

    game.lizhi({ open: true });
    expect(get(game).lizhiPendingFlags).toEqual({ open: true, shuvari: false, fever: false });
    game.discard('p0', { gold: true });

    const after = get(game);
    expect(after.game.lizhi.has(0)).toBe(true);
    expect(after.game.openLizhi.has(0)).toBe(true);
    expect(after.lizhiPending).toBeNull();
    expect(after.lizhiPendingFlags).toBeNull();
  });

  it('does not core-match a rainbow tile to a different physical FEVER candidate', () => {
    const game = createGameStore();
    const state = get(game);
    const player = state.game.lunbanToPlayerId(state.game.state.lunban);
    const sp = buildShoupai([
      'p1', 'p2', 'np3',
      's1', 's2', 'ns3',
      'z3', 'z3', 'nz3',
      'p4', 'p5', 'p6',
      'z1',
    ]);
    sp.zimo('p3');
    state.game.shoupai.set(player, sp);
    state.game.diyizimo = false;
    state.game.lastZimoInfo = { player, pai: 'p3', pochi: null, gold: false };
    state.lastZimo = 'p3';

    expect(state.game.feverCandidatesByDapai(player).has('p3')).toBe(true);
    expect(state.game.feverCandidatesByDapai(player).has('np3')).toBe(false);
    game.lizhi({ fever: true });
    game.discard('np3');

    const rejected = get(game);
    expect(rejected.lizhiPending).toBe(player);
    expect(rejected.game.lizhi.has(player)).toBe(false);
    expect(rejected.game.shoupai.get(player)?._bingpai?.__anmika?.np3).toBe(1);

    game.discard('p3');
    const accepted = get(game);
    expect(accepted.lizhiPending).toBeNull();
    expect(accepted.game.feverActive[player]).toBe(true);
    expect(accepted.game.shoupai.get(player)?._bingpai?.__anmika?.np3).toBe(1);
  });
});
