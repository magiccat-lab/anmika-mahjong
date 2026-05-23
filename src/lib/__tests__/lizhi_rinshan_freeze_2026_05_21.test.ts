import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import { autoLizhiInline, type StoreState } from '../store';
import type { PlayerId } from '../types';

function makeState(g: Game3, lastZimo: string): StoreState {
  return {
    game: g,
    lastZimo,
    lastDapai: null,
    lastWinner: null,
    lastHuleResult: null,
    awaitingRonDecision: false,
    ronPassedPlayers: [],
    ronDeclaredPlayers: [],
    ronResults: [],
    awaitingFulou: false,
    ponCandidates: [],
    kanCandidates: [],
    roundEnded: false,
    message: null,
    cpu: { 0: false, 1: false, 2: false },
    lizhiPending: null,
    pendingKinpei: null,
    pendingFuyu: null,
    pendingFeverContinue: null,
    pendingPingju: false,
    pendingQianggang: null,
    pendingSaiKoro: null,
    stamps: { 0: null, 1: null, 2: null },
    cutin: null,
    cutinQueue: [],
  };
}

describe('リーチ後 北抜き 嶺上 replacement regression 2026-05-21', () => {
  it('event 281 shape: canTsumo false の p7 replacement はツモ切りされて手番が進む', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.state.lunban = 0;
    g.diyizimo = false;
    g.shoupai.set(player, buildShoupai([
      'p2','p2','p4','p4','s2','s2','s4','s4','s8','z6','z6','z7','z7',
    ]));
    const sp = g.shoupai.get(player) as any;
    sp.zimo('p7');
    g.lizhi.add(player);
    g.nukidora[player] = 1;
    g.lingshangActive[player] = true;
    g.lastZimoInfo = { player, pai: 'p7', pochi: null, gold: false };

    expect(g.canTsumo(player)).toBe(false);
    const next = autoLizhiInline(makeState(g, 'p7'));

    expect(next.game.state.lunban).toBe(1);
    expect(next.game.shoupai.get(player)?._zimo).toBeNull();
    expect((next.game.he.get(player) as any)._pai.at(-1)).toBe('p7');
    expect(next.game.events.at(-2)).toMatchObject({ type: 'dapai', player, pai: 'p7' });
    expect(next.awaitingRonDecision).toBe(false);
    expect(next.awaitingFulou).toBe(false);
    expect(next.lastZimo).toBeTruthy();
  });
});
