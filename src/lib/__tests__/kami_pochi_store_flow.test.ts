import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { buildShoupai } from '../game3';
import { createGameStore, enterFuyuKamiPochiStage } from '../store';

function basicResult(extra: Record<string, unknown> = {}) {
  return {
    hupai: [{ name: '立直', fanshu: 1 }],
    fanshu: 1,
    fu: 30,
    damanguan: 0,
    defen: 1000,
    fenpei: [0, 0, 0, 0],
    ...extra,
  };
}

describe('store kami-pochi decision pipeline', () => {
  it('auto-assigns every unselected positive dora indicator to the most common hand tile without a modal', () => {
    // リョー裁定 2026-07-20: 神ぽっちは人間にも選択モーダルを出さず自動高め取り
    const store = createGameStore();
    const state = get(store);
    const player = state.game.lunbanToPlayerId(state.game.state.lunban);
    state.game.shoupai.set(player, buildShoupai(['p5', 'p5', 'p5', 's1', 's2']));
    (state.game.shan as any)._baopai = ['z5b'];
    vi.spyOn(state.game, 'canTsumo').mockReturnValue(true);
    vi.spyOn(state.game, 'hule').mockImplementation(() => basicResult());
    vi.spyOn(state.game, 'applyHule').mockImplementation(() => undefined);

    store.tsumo();

    const completed = get(store);
    expect(completed.pendingKamiPochi).toBeNull();
    expect(completed.game.kamiPochiDoraChoices[player]['baopai:0']).toBe('p5');
    expect(completed.lastWinner).toBe(player);
    expect(completed.roundEnded).toBe(true);
  });

  it('pauses only when all-mighty high candidates have equal chip expectation', () => {
    const store = createGameStore();
    const state = get(store);
    const player = state.game.lunbanToPlayerId(state.game.state.lunban);
    vi.spyOn(state.game, 'canTsumo').mockReturnValue(true);
    vi.spyOn(state.game, 'hule').mockImplementation(() => {
      if (state.game.pochiSwapChoice[player]) return basicResult({ _allmightyPochi: state.game.pochiSwapChoice[player] });
      return basicResult({
        _allmightyPochi: 'p2',
        _pochiSwapPending: {
          winner: player,
          kind: 'white',
          candidates: [
            { target: 'p2', expectedChip: 2, fanshu: 2, damanguan: 0 },
            { target: 's2', expectedChip: 2, fanshu: 2, damanguan: 0 },
          ],
          decisionOwners: [player],
        },
      });
    });
    vi.spyOn(state.game, 'applyHule').mockImplementation(() => undefined);

    store.tsumo();
    expect(get(store).pendingPochiSwap?.candidates.map((candidate) => candidate.target)).toEqual(['p2', 's2']);

    store.selectPochiSwap('s2');

    const completed = get(store);
    expect(completed.pendingPochiSwap).toBeNull();
    expect(completed.game.pochiSwapChoice[player]).toBe('s2');
    expect(completed.lastWinner).toBe(player);
    expect(completed.roundEnded).toBe(true);
  });

  it('resolves a Winter positive pochi automatically without pausing settlement', () => {
    // リョー裁定 2026-07-20: 冬の神ぽっちも自動高め取り。
    // 空手牌では華 candidate [常に華総数+1 hit] が最大なので f1 相当が選ばれる
    const store = createGameStore();
    const state = get(store);
    const winner = 0 as const;
    state.game.shoupai.set(winner, buildShoupai([]));
    state.game.huapai[winner] = [];
    (state.game.shan as any)._pai = ['z5b'];
    expect(state.game.applyFuyuChip(winner, null, 1, false).status).toBe('pending');
    state.lastWinner = winner;
    state.lastHuleResult = basicResult();
    state.ronResults = [];
    state.roundEnded = false;

    expect(enterFuyuKamiPochiStage(state, { winner, isRon: false, ronfrom: null })).toBe(false);
    expect(state.pendingKamiPochi).toBeNull();
    expect(state.lastHuleResult.fuyuLog).toEqual([{ pai: 'z5b', tier: 'upper', hit: 1 }]);
    expect(state.game.chipLedger).toEqual({ 0: 4, 1: -2, 2: -2 });
  });
});
