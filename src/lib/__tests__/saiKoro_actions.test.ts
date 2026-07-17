import { describe, it, expect, beforeEach } from 'vitest';
import { game, triggerSaiKoroIfAny } from '../store';
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

  it('通常サイコロはシュバ未宣言なら連続ゾロ目特典を付けない', () => {
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
    expect(entry).toBeUndefined();
  });

  it('役固有の常時シュバサイは未宣言でも連続ゾロ目特典を付ける', () => {
    const s = get(game);
    s.game.shuvariActive[0] = false;
    s.pendingSaiKoro = {
      winner: 0 as PlayerId,
      chances: [{ name: 'inherent shuba', baseChip: 1, shuvariApplicable: false, alwaysShuvari: true, count: 1, plusMinus: '+' as const }],
      currentIdx: 0,
      selectedCombo: [1, 2],
      rolls: [],
      finalized: false,
      summary: null,
    } as any;
    game.rollSaiKoroDice([2, 2]);
    game.rollSaiKoroDice([2, 2]);
    expect(get(game).game.chipBreakdown.at(-1)?.base).toBe(22);
  });

  it('シュバリー中は発生源を問わず連続ゾロ目祝儀だけを2倍にする', () => {
    const s = get(game);
    s.game.shuvariActive[0] = true;
    s.pendingSaiKoro = {
      winner: 0 as PlayerId,
      chances: [{ name: 'fixed dice', baseChip: 1, shuvariApplicable: false, count: 1, plusMinus: '+' as const }],
      currentIdx: 0,
      selectedCombo: [1, 2],
      rolls: [],
      finalized: false,
      summary: null,
    } as any;
    game.rollSaiKoroDice([2, 2]);
    game.rollSaiKoroDice([2, 2]);
    const zoro = get(game).game.chipBreakdown.at(-1);
    expect(zoro?.base).toBe(22);
    expect(zoro?.multiplier).toBe(2);
    expect(zoro?.total).toBe(44);
  });

  it('フィーバー継続中のロン由来サイコロにも逆ぽっちを適用する', () => {
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
    expect(entry?.multiplier).toBe(-4);
    expect(entry?.total).toBe(-16);
    expect(after.pendingSaiKoro?.summary?.chipN).toBe(-16);
  });

  it('countを独立した出目宣言セッションへ展開する', () => {
    const s = get(game);
    triggerSaiKoroIfAny(s, {
      saiKoroChances: [{ awardKey: 'double', name: 'double', baseChip: 70, shuvariApplicable: true, count: 2 }],
    }, 0);
    expect(s.pendingSaiKoro?.chances).toHaveLength(2);
    expect(s.pendingSaiKoro?.chances.every((c) => c.count === 1)).toBe(true);
    expect(s.pendingSaiKoro?.chances.map((c) => c.name)).toEqual(['double [1/2]', 'double [2/2]']);
  });

  it('rollCountでAll-Starの5投以上を保持する', () => {
    const s = get(game);
    s.pendingSaiKoro = {
      winner: 0 as PlayerId,
      chances: [{ name: 'rainbow all-star', baseChip: 1, shuvariApplicable: true, rollCount: 5, count: 1, plusMinus: '+' as const }],
      currentIdx: 0,
      selectedCombo: [1, 2],
      rolls: [],
      finalized: false,
      summary: null,
    } as any;
    for (let i = 0; i < 4; i++) game.rollSaiKoroDice([1, 2]);
    expect(get(game).pendingSaiKoro?.finalized).toBe(false);
    game.rollSaiKoroDice([1, 2]);
    expect(get(game).pendingSaiKoro?.finalized).toBe(true);
  });

  it('FEVER中の通常awardKeyは一度だけ、本役満は毎和了登録する', () => {
    const s = get(game);
    s.game.feverActive[0] = true;
    const ordinary = { saiKoroChances: [{ awardKey: 'all-star', name: 'all-star', baseChip: 70, shuvariApplicable: true, count: 1 }] };
    triggerSaiKoroIfAny(s, ordinary, 0);
    expect(s.pendingSaiKoro?.chances).toHaveLength(1);
    s.pendingSaiKoro = null;
    triggerSaiKoroIfAny(s, ordinary, 0);
    expect(s.pendingSaiKoro).toBeNull();

    const yakuman = { saiKoroChances: [{ awardKey: 'yakuman:四暗刻', name: '四暗刻', baseChip: 70, shuvariApplicable: true, count: 1 }] };
    triggerSaiKoroIfAny(s, yakuman, 0);
    expect(s.pendingSaiKoro?.chances).toHaveLength(1);
    s.pendingSaiKoro = null;
    triggerSaiKoroIfAny(s, yakuman, 0);
    expect(s.pendingSaiKoro?.chances).toHaveLength(1);
  });
});
