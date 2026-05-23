import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import type { PlayerId, Lunban } from '../types';

// 反時計回り rotation 仕様 [リョー指示 2026-05-13]:
//   qijia=0 で lunban 0→1→2 = player 0→2→1
//   公式: player = ((qijia - lunban) mod 3 + 3) mod 3
// 過去の反時計回り化漏れ bug [89d024b / 4fc759b] 防衛。
describe('Game3 lunbanToPlayerId [反時計回り]', () => {
  it('qijia=0: lunban 0→1→2 = player 0→2→1', () => {
    const g = new Game3();
    g.state.qijia = 0 as PlayerId;
    expect(g.lunbanToPlayerId(0 as Lunban)).toBe(0);
    expect(g.lunbanToPlayerId(1 as Lunban)).toBe(2);
    expect(g.lunbanToPlayerId(2 as Lunban)).toBe(1);
  });

  it('qijia=1: lunban 0→1→2 = player 1→0→2', () => {
    const g = new Game3();
    g.state.qijia = 1 as PlayerId;
    expect(g.lunbanToPlayerId(0 as Lunban)).toBe(1);
    expect(g.lunbanToPlayerId(1 as Lunban)).toBe(0);
    expect(g.lunbanToPlayerId(2 as Lunban)).toBe(2);
  });

  it('qijia=2: lunban 0→1→2 = player 2→1→0', () => {
    const g = new Game3();
    g.state.qijia = 2 as PlayerId;
    expect(g.lunbanToPlayerId(0 as Lunban)).toBe(2);
    expect(g.lunbanToPlayerId(1 as Lunban)).toBe(1);
    expect(g.lunbanToPlayerId(2 as Lunban)).toBe(0);
  });

  it('全 qijia で結果は 0/1/2 全て出現 [bijection]', () => {
    for (const q of [0, 1, 2] as const) {
      const g = new Game3();
      g.state.qijia = q;
      const seen = new Set<number>();
      for (const lb of [0, 1, 2] as const) {
        seen.add(g.lunbanToPlayerId(lb as Lunban));
      }
      expect(seen.size).toBe(3);
    }
  });

  it('qipai → dapai loop で player 順は qijia→反時計回り', () => {
    const g = new Game3();
    g.qipai();
    const qijia = g.state.qijia;
    const expectedOrder = [qijia, (qijia + 2) % 3, (qijia + 1) % 3]; // 反時計
    const observed: number[] = [];
    // 2026-05-14 flaky fix: z4 zimo は dapai('z4') で declareNukiBei に auto-route され
    // lunban 進まないため、 観測 player が重複する。 z4 が出たら nukiBei 後の replacement [sp._zimo]
    // を 再 dapai して lunban を進める
    const maxIter = 60;
    let lastObserved = -1;
    for (let i = 0; i < maxIter && observed.length < 3; i++) {
      const cur = g.lunbanToPlayerId(g.state.lunban);
      if (cur !== lastObserved) {
        observed.push(cur);
        lastObserved = cur;
      }
      const sp = g.shoupai.get(cur as 0|1|2);
      if (!sp?._zimo) {
        const z = g.zimo();
        if (!z) break;
      }
      // sp._zimo を 改めて取得 [zimo 後 or 既に load 済]
      const z = (sp as any)._zimo;
      if (!z || typeof z !== 'string') break;
      try {
        g.dapai(z);
      } catch { break; }
    }
    expect(observed).toEqual(expectedOrder);
  });
});
