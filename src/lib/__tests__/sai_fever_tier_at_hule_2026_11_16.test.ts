import { describe, it, expect, beforeEach } from 'vitest';
import { game, triggerSaiKoroIfAny } from '../store';
import { get } from 'svelte/store';
import type { PlayerId } from '../types';

// [2026-11-16 通報 20261116_2 部屋 4OU4 rev 1940「ダブフィーサイコロは140」]
// ダブルフィーバーのロンで冬を使い切り、hule の中でフィーバーが終わった。四華のサイコロは
// 振る時点の feverActive=false を読んで ×1 [1 hit 70 オール] になっていた。和了の時点の段で ×2 [140 オール] に払う
describe('サイコロは和了の時点のフィーバー段で払う', () => {
  beforeEach(() => {
    game.reset();
  });

  const rollOneHit = () => {
    game.selectSaiKoroCombo(1, 4);
    game.rollSaiKoroDice([5, 6]);
    game.rollSaiKoroDice([1, 4]);
    game.rollSaiKoroDice([3, 1]);
    game.rollSaiKoroDice([1, 5]);
  };

  it('hule の中でフィーバーが終わっても、ダブルフィーバーのアガリの四華サイコロは 1 hit 140 オール', () => {
    const s = get(game);
    s.game.feverActive[0] = false; // 冬の自動使用で endFever 済み
    s.game.feverTier[0] = 1;
    const result = { saiKoroChances: [{ awardKey: '四華', name: '四華', baseChip: 70, shuvariApplicable: true, count: 1, plusMinus: '+', mode: 'ron' }], _feverAtHule: true, _feverTierAtHule: 2 };
    triggerSaiKoroIfAny(s, result, 0 as PlayerId);
    expect(get(game).pendingSaiKoro?.chances[0]).toMatchObject({ feverTierAtHule: 2 });
    const before = { ...get(game).game.chipLedger };
    rollOneHit();
    const after = get(game);
    expect(after.game.chipLedger[0] - before[0]).toBe(280);
    expect(after.game.chipLedger[1] - before[1]).toBe(-140);
    expect(after.pendingSaiKoro?.summary?.chipN).toBe(140);
  });

  it('フィーバー外のアガリ [段 0] は今フィーバー中でも ×1', () => {
    const s = get(game);
    s.game.feverActive[0] = true;
    s.game.feverTier[0] = 2;
    const result = { saiKoroChances: [{ awardKey: '四華', name: '四華', baseChip: 70, shuvariApplicable: true, count: 1, plusMinus: '+', mode: 'ron' }], _feverAtHule: false, _feverTierAtHule: 0 };
    triggerSaiKoroIfAny(s, result, 0 as PlayerId);
    const before = { ...get(game).game.chipLedger };
    rollOneHit();
    expect(get(game).game.chipLedger[1] - before[1]).toBe(-70);
  });

  it('段を持たない chance [流し役満など] は今の feverActive で払う [従来どおり]', () => {
    const s = get(game);
    s.game.feverActive[0] = true;
    s.game.feverTier[0] = 2;
    const result = { saiKoroChances: [{ awardKey: '四華', name: '四華', baseChip: 70, shuvariApplicable: true, count: 1, plusMinus: '+', mode: 'ron' }] };
    triggerSaiKoroIfAny(s, result, 0 as PlayerId);
    const before = { ...get(game).game.chipLedger };
    rollOneHit();
    expect(get(game).game.chipLedger[1] - before[1]).toBe(-140);
  });
});
