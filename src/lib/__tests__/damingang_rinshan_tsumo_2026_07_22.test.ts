// 2026-07-22 リョー報告: ミンカンして嶺上ツモしたらつもれなくなった。
// damingangImpl が槓で消費した打牌を lastDapai に残し、ツモ宣言UIのゲート
// [!lastDapai] を塞いでいた。成功時に lastDapai を必ず消す。
import { describe, it, expect } from 'vitest';
import { damingangImpl } from '../store/fulouActions';

function stubState(overrides: any = {}): any {
  return {
    lastDapai: { player: 1, pai: 'm9' },
    lastZimo: null,
    message: null,
    awaitingRonDecision: true,
    awaitingFulou: true,
    ponCandidates: [],
    kanCandidates: [],
    ronPassedPlayers: [],
    ronDeclaredPlayers: [],
    ronResults: [],
    game: {
      declareDamingang: () => 's5',
      shan: { paishu: 10 },
    },
    ...overrides,
  };
}

describe('大明槓後の嶺上ツモ [2026-07-22]', () => {
  it('成功時に lastDapai が消え、嶺上牌が lastZimo に入る', () => {
    const out = damingangImpl(stubState(), 0, 'm9999');
    expect(out.lastDapai).toBe(null);
    expect(out.lastZimo).toBe('s5');
    expect(out.awaitingRonDecision).toBe(false);
    expect(out.awaitingFulou).toBe(false);
  });

  it('不正 mianzi [rollback] では lastDapai を保持 [候補待ち継続]', () => {
    const out = damingangImpl(stubState({ game: { declareDamingang: () => null, shan: { paishu: 10 } } }), 0, 'mXXXX');
    expect(out.lastDapai).toEqual({ player: 1, pai: 'm9' });
  });
});
