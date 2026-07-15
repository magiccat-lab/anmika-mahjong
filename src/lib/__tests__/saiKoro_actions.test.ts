import { describe, it, expect, beforeEach } from 'vitest';
import { game } from '../store';
import { get } from 'svelte/store';
import type { PlayerId } from '../types';

// SaiKoroModal action [selectSaiKoroCombo / rollSaiKoroDice / advanceSaiKoro] の no-op + 基本挙動 unit テスト
describe('saiKoro actions [no-op / 基本進行]', () => {
  beforeEach(() => {
    game.reset();
  });

  it('pendingSaiKoro ナシで selectSaiKoroCombo 呼んで throw ナシ', () => {
    expect(() => game.selectSaiKoroCombo(1, 2)).not.toThrow();
  });

  it('pendingSaiKoro ナシで rollSaiKoroDice 呼んで throw ナシ', () => {
    expect(() => game.rollSaiKoroDice([1, 2])).not.toThrow();
  });

  it('pendingSaiKoro ナシで advanceSaiKoro 呼んで throw ナシ', () => {
    expect(() => game.advanceSaiKoro()).not.toThrow();
  });

  it('pendingSaiKoro mock セット後 selectSaiKoroCombo で selectedCombo 更新', () => {
    const s = get(game);
    s.pendingSaiKoro = {
      winner: 0 as PlayerId,
      chances: [{ name: 'test', baseChip: 1, shuvariApplicable: true, count: 1, plusMinus: '+' as const }],
      currentIdx: 0,
      selectedCombo: null,
      rolls: [],
      finalized: false,
      summary: null,
    } as any;
    game.selectSaiKoroCombo(2, 5);
    const after = get(game);
    expect(after.pendingSaiKoro?.selectedCombo).toEqual([2, 5]);
  });

  it('rollSaiKoroDice [override=1,1 ゾロ目] で rolls に zoro=true entry 追加', () => {
    const s = get(game);
    s.pendingSaiKoro = {
      winner: 0 as PlayerId,
      chances: [{ name: 'test', baseChip: 1, shuvariApplicable: true, count: 1, plusMinus: '+' as const }],
      currentIdx: 0,
      selectedCombo: [1, 2],
      rolls: [],
      finalized: false,
      summary: null,
    } as any;
    game.rollSaiKoroDice([1, 1]);
    const after = get(game);
    expect(after.pendingSaiKoro?.rolls.length).toBe(1);
    expect(after.pendingSaiKoro?.rolls[0].zoro).toBe(true);
    expect(after.pendingSaiKoro?.rolls[0].hit).toBe(false); // ゾロ目は hit じゃない
  });

  it('rollSaiKoroDice [override=1,2 = selected] で hit=true', () => {
    const s = get(game);
    s.pendingSaiKoro = {
      winner: 0 as PlayerId,
      chances: [{ name: 'test', baseChip: 1, shuvariApplicable: true, count: 1, plusMinus: '+' as const }],
      currentIdx: 0,
      selectedCombo: [1, 2],
      rolls: [],
      finalized: false,
      summary: null,
    } as any;
    game.rollSaiKoroDice([1, 2]);
    const after = get(game);
    expect(after.pendingSaiKoro?.rolls[0].hit).toBe(true);
    expect(after.pendingSaiKoro?.rolls[0].zoro).toBe(false);
  });

  it('ロン由来サイコロ chip は 非フィーバーなら ぽっち bypass [2026-05-21]', () => {
    const s = get(game);
    s.game.pochiMultiplier[0] = { defen: -1, chip: -2 };
    s.pendingSaiKoro = {
      winner: 0 as PlayerId,
      chances: [{ name: 'ron dice', baseChip: 1, shuvariApplicable: true, count: 1, plusMinus: '+' as const, mode: 'ron' }],
      currentIdx: 0,
      selectedCombo: [1, 2],
      rolls: [],
      finalized: false,
      summary: null,
    } as any;
    for (let i = 0; i < 4; i++) game.rollSaiKoroDice([1, 2]);
    const after = get(game);
    const entry = after.game.chipBreakdown.at(-1);
    expect(entry?.label).toContain('ron dice');
    // 仕様 2026-05-21: ロン + 非フィーバーなら ぽっち bypass、 倍率 1
    expect(entry?.multiplier).toBe(1);
  });

  it('シュバサイならシュバ宣言なしでも連続ゾロ目特典を適用する', () => {
    const s = get(game);
    s.game.shuvariActive[0] = false;
    s.pendingSaiKoro = {
      winner: 0 as PlayerId,
      chances: [{ name: 'shuvari dice', baseChip: 1, shuvariApplicable: true, count: 1, plusMinus: '+' as const }],
      currentIdx: 0,
      selectedCombo: [1, 2],
      rolls: [],
      finalized: false,
      summary: null,
    } as any;
    game.rollSaiKoroDice([2, 2]);
    game.rollSaiKoroDice([2, 2]);
    const after = get(game);
    const entry = after.game.chipBreakdown.at(-1);
    expect(entry?.label).toContain('シュバゾロ連続特典');
    expect(entry?.base).toBe(22);
  });

  it('ロン由来サイコロはフィーバー中でもぽっちだけを除外する', () => {
    const s = get(game);
    s.game.feverActive[0] = true;
    s.game.feverTier[0] = 2;
    s.game.pochiMultiplier[0] = { defen: -1, chip: -2 };
    s.pendingSaiKoro = {
      winner: 0 as PlayerId,
      chances: [{ name: 'fever ron dice', baseChip: 1, shuvariApplicable: true, count: 1, plusMinus: '+' as const, mode: 'ron' }],
      currentIdx: 0,
      selectedCombo: [1, 2],
      rolls: [],
      finalized: false,
      summary: null,
    } as any;
    for (let i = 0; i < 4; i++) game.rollSaiKoroDice([1, 2]);
    const after = get(game);
    const entry = after.game.chipBreakdown.at(-1);
    expect(entry?.multiplier).toBe(2); // フィーバー×2のみ。ぽっち-2は掛けない。
    expect(entry?.total).toBe(8);
    expect(after.pendingSaiKoro?.summary?.chipN).toBe(8);
  });
});
