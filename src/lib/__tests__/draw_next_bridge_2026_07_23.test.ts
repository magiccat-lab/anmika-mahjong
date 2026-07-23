import { describe, expect, it } from 'vitest';
import { evaluateDrawNextBridge } from '../drawNextBridge';
import type { PlayerId } from '../types';

// [2026-07-23 Sol総点検 P1] needsZimo 停止修復橋の発火判定一本化。
// 旧実装は timer 内再検証が槍槓/流局/サイコロ/リーチ宣言窓を見ておらず、
// 窓中の誤発火で _autoDrawNextKey を先消費 → 窓解除が events 長不変だと
// 橋が再発火できず本物の停止を直せなくなっていた。

const SELF = 0 as PlayerId;
const RK = '0-0-0';

function mkState(over: Record<string, any> = {}, zimoSelf: string | null = null) {
  const shoupai = new Map<number, any>();
  shoupai.set(0, { _zimo: zimoSelf });
  shoupai.set(1, { _zimo: null });
  shoupai.set(2, { _zimo: null });
  return {
    roundEnded: false,
    lastZimo: null,
    awaitingRonDecision: false,
    awaitingFulou: false,
    pendingQianggang: null,
    pendingPingju: null,
    pendingSaiKoro: null,
    lizhiPending: null,
    pendingFeverContinue: null,
    pendingFuyu: null,
    pendingKinpei: null,
    pendingKamiPochi: null,
    pendingPochiSwap: null,
    game: {
      state: { changbang: 0, jushu: 0, benbang: 0, lunban: 0 },
      lunbanToPlayerId: (l: number) => l,
      shoupai,
    },
    ...over,
  };
}

describe('evaluateDrawNextBridge', () => {
  it('本物の停止 [自手番/zimoなし/窓なし] は send', () => {
    expect(evaluateDrawNextBridge(mkState(), SELF, RK)).toBe('send');
  });

  it('一時的な判定窓は全部 rearm [key を解放して橋を再アームさせる]', () => {
    const windows: Array<Record<string, any>> = [
      { awaitingRonDecision: true },
      { awaitingFulou: true },
      { pendingQianggang: { player: 1 } },
      { pendingPingju: { reason: 'x' } },
      { pendingSaiKoro: { chances: [] } },
      { lizhiPending: 0 },
      { pendingFeverContinue: { winner: 0 } },
      { pendingFuyu: { player: 0 } },
      { pendingKinpei: { player: 0 } },
      { pendingKamiPochi: { player: 0 } },
      { pendingPochiSwap: { player: 0 } },
    ];
    for (const w of windows) {
      expect(evaluateDrawNextBridge(mkState(w), SELF, RK), JSON.stringify(w)).toBe('rearm');
    }
  });

  it('lizhiPending は seat 0 [falsy な 0] でも窓として扱う', () => {
    expect(evaluateDrawNextBridge(mkState({ lizhiPending: 0 }), SELF, RK)).toBe('rearm');
  });

  it('槍槓窓 → 解除 [events 長不変] のシーケンスで、解除後に send へ戻る', () => {
    // 窓中: rearm [誤送信しない + App 側は key を解放する]
    expect(evaluateDrawNextBridge(mkState({ pendingQianggang: { player: 2 } }), SELF, RK)).toBe('rearm');
    // 窓解除後も停止が残っている: 同じ roundKey のまま send [橋が再発火できる]
    expect(evaluateDrawNextBridge(mkState(), SELF, RK)).toBe('send');
  });

  it('状態が進行済みのケースは keep [key は消費のままでよい]', () => {
    // 自分に zimo が到着
    expect(evaluateDrawNextBridge(mkState({}, 'm1'), SELF, RK)).toBe('keep');
    // lastZimo が到着
    expect(evaluateDrawNextBridge(mkState({ lastZimo: 'p5' }), SELF, RK)).toBe('keep');
    // 手番が他家に移動
    const other = mkState();
    other.game.state.lunban = 1;
    expect(evaluateDrawNextBridge(other, SELF, RK)).toBe('keep');
    // 局が移動 [roundKey 不一致]
    expect(evaluateDrawNextBridge(mkState(), SELF, '0-1-0')).toBe('keep');
    // 局終了
    expect(evaluateDrawNextBridge(mkState({ roundEnded: true }), SELF, RK)).toBe('keep');
    // store 不在
    expect(evaluateDrawNextBridge(null, SELF, RK)).toBe('keep');
  });
});
