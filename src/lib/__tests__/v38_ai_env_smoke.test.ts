// V38: AI v5 env smoke test [reset / step / random policy で 1 episode 完走]
import { describe, it, expect } from 'vitest';
import { AnmikaEnv, OBS_DIM, ACTION_SPACE_SIZE } from '../../ai/env';

describe('V38-A AnmikaEnv reset', () => {
  it('reset で OBS_DIM サイズの obs / legal_mask 返す', () => {
    const env = new AnmikaEnv();
    const obs = env.reset(42);
    expect(obs.obs.length).toBe(OBS_DIM);
    expect(obs.legal_mask.length).toBe(ACTION_SPACE_SIZE);
    expect(obs.done).toBe(false);
    expect(obs.player).toBe(0);
    // 少なくとも 1 つ legal action がある
    const legalCount = obs.legal_mask.filter((b) => b).length;
    expect(legalCount, 'reset 直後に legal action が無い').toBeGreaterThan(0);
  });
});

describe('V38-B AnmikaEnv random policy で 1 episode 完走', () => {
  it('100 step 以内で done=true に到達 [安全上限]、 throw ナシ', () => {
    const env = new AnmikaEnv({ maxRounds: 4 });
    let obs = env.reset(123);
    let steps = 0;
    let totalReward = 0;
    while (!obs.done && steps < 1000) {
      // legal action から random pick、 無ければ pass
      const legals: number[] = [];
      for (let i = 0; i < obs.legal_mask.length; i++) if (obs.legal_mask[i]) legals.push(i);
      const action = legals.length > 0 ? legals[Math.floor(Math.random() * legals.length)] : 94 /* PASS */;
      obs = env.step(action);
      totalReward += obs.reward;
      steps += 1;
    }
    console.log(`[V38-B] steps=${steps} totalReward=${totalReward.toFixed(2)} done=${obs.done}`);
    expect(steps).toBeLessThan(1000);
  });
});

describe('V38-C 3 試合 連戦 random policy で安定', () => {
  it('3 episode 連続 で完走、 throw ナシ', () => {
    for (let ep = 0; ep < 3; ep++) {
      const env = new AnmikaEnv({ maxRounds: 4 });
      let obs = env.reset(ep);
      let steps = 0;
      while (!obs.done && steps < 1000) {
        const legals: number[] = [];
        for (let i = 0; i < obs.legal_mask.length; i++) if (obs.legal_mask[i]) legals.push(i);
        const action = legals.length > 0 ? legals[Math.floor(Math.random() * legals.length)] : 94;
        obs = env.step(action);
        steps += 1;
      }
      expect(obs.done, `ep ${ep} done に到達せず`).toBe(true);
    }
  });
});
