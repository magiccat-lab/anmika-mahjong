import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import type { PlayerId } from '../types';

// 2026-07-21 監査 D-06: FEVER 中のロン由来サイコロにぽっち倍率が乗っていた。
// 2026-07-15 裁定: ロン由来サイコロは FEVER の有無にかかわらずぽっちを除外する
// [Sol 再現: tier2 × ぽっち -2 × base 70 × 1hit が -280 になっていた。正は +140]。

function setupRonChance(): any {
  const s: any = get(game);
  s.pendingSaiKoro = {
    winner: 0 as PlayerId,
    chances: [{
      name: 'ロン由来サイ',
      baseChip: 70,
      shuvariApplicable: false,
      count: 1,
      plusMinus: '+' as const,
      rollCount: 4,
      mode: 'ron',
    }],
    currentIdx: 0,
    selectedCombo: [1, 2] as [number, number],
    rolls: [],
    finalized: false,
    summary: null,
  };
  return s;
}

describe('D-06: ロン由来サイコロのぽっち除外', () => {
  beforeEach(() => {
    game.reset();
  });

  it('FEVER tier2 + ぽっち-2 のロン由来 1hit は 70×2=140 オール [ぽっち非適用]', () => {
    const s = setupRonChance();
    s.game.feverActive[0] = true;
    s.game.feverTier[0] = 2;
    s.game.pochiMultiplier[0] = { chip: -2, point: 1 } as any;
    const before = { ...s.game.chipLedger };
    game.rollSaiKoroDice([1, 2]); // hit
    game.rollSaiKoroDice([1, 3]);
    game.rollSaiKoroDice([1, 4]);
    game.rollSaiKoroDice([1, 5]); // 4 投目で finalize
    const after: any = get(game);
    expect(after.pendingSaiKoro?.finalized).toBe(true);
    // +140 オール = winner +280 / 他家 -140 [旧実装は -280 オールだった]
    expect(after.game.chipLedger[0] - before[0]).toBe(280);
    expect(after.game.chipLedger[1] - before[1]).toBe(-140);
    // summary の表示倍率も同じ snapshot [140 = 70 × FEVER2]
    expect(after.pendingSaiKoro?.summary?.chipN).toBe(140);
  });

  it('ツモ由来は従来どおりぽっち倍率が乗る [70 × -2 = -140 オール]', () => {
    const s = setupRonChance();
    s.pendingSaiKoro.chances[0].mode = 'tsumo';
    s.game.pochiMultiplier[0] = { chip: -2, point: 1 } as any;
    const before = { ...s.game.chipLedger };
    game.rollSaiKoroDice([1, 2]);
    game.rollSaiKoroDice([1, 3]);
    game.rollSaiKoroDice([1, 4]);
    game.rollSaiKoroDice([1, 5]);
    const after: any = get(game);
    expect(after.game.chipLedger[0] - before[0]).toBe(-280);
    expect(after.game.chipLedger[1] - before[1]).toBe(140);
  });
});
