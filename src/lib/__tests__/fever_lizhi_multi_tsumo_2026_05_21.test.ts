import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import { applyFeverAutoTsumokiri, type StoreState } from '../store';

function setLunbanToPlayer(g: Game3, player: 0 | 1 | 2): void {
  g.state.lunban = (((g.currentOya - player) % 3 + 3) % 3) as any;
}

function makeStoreState(g: Game3, lastZimo: string): StoreState {
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

describe('fever lizhi multi-tsumo regression 2026-05-21', () => {
  it('fever 本人の canTsumo=true zimo でも自動ツモ切りして次 zimo に進む', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as const;
    setLunbanToPlayer(g, player);
    g.shoupai.set(player, buildShoupai([
      'm1', 'm1', 'm1',
      'p1', 'p1', 'p1',
      's1', 's1', 's1',
      'z5', 'z5',
      'z6', 'z6',
    ]));
    g.shoupai.get(player)?.zimo('z6');
    g.lizhi.add(player);
    g.feverActive[player] = true;
    g.feverTier[player] = 1;
    (g.shan as any)._pai = ['m2', 'm3', 'm4', 'm5'].reverse();

    const origCanRon = g.canRon.bind(g);
    const origGetPonCandidates = g.getPonCandidates.bind(g);
    const origGetDamingangCandidates = g.getDamingangCandidates.bind(g);
    try {
      g.canRon = () => false;
      g.getPonCandidates = () => [];
      g.getDamingangCandidates = () => [];

      const s = makeStoreState(g, 'z6');
      expect(g.canTsumo(player)).toBe(true);

      const after = applyFeverAutoTsumokiri(s);

      expect(after.game.he.get(player)?._pai.some((p: string) => p.startsWith('z6'))).toBe(true);
      expect(after.game.shoupai.get(player)?._zimo).not.toBe('z6');
      expect(after.lastZimo).not.toBe('z6');
    } finally {
      g.canRon = origCanRon;
      g.getPonCandidates = origGetPonCandidates;
      g.getDamingangCandidates = origGetDamingangCandidates;
    }
  });
});
