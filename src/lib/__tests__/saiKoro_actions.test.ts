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

  it('シュバ未宣言なら連続ゾロ目特典は付かない [2026-07-20 リョー裁定: シュバサイ限定]', () => {
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
    expect(after.game.chipBreakdown.some((e) => e.label?.includes('ゾロ目'))).toBe(false);
  });

  it('シュバ非適用サイコロはシュバ宣言中でも連続ゾロ目特典が付かない', () => {
    const s = get(game);
    s.game.shuvariActive[0] = true;
    s.pendingSaiKoro = {
      winner: 0 as PlayerId,
      chances: [{ name: 'non shuvari dice', baseChip: 1, shuvariApplicable: false, count: 1, plusMinus: '+' as const }],
      currentIdx: 0,
      selectedCombo: [1, 2],
      rolls: [],
      finalized: false,
      summary: null,
    } as any;
    game.rollSaiKoroDice([2, 2]);
    game.rollSaiKoroDice([2, 2]);
    const after = get(game);
    expect(after.game.chipBreakdown.some((e) => e.label?.includes('ゾロ目'))).toBe(false);
  });

  it('シュバ宣言中のシュバ適用サイコロには連続ゾロ目特典が付く', () => {
    const s = get(game);
    s.game.shuvariActive[0] = true;
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
    expect(entry?.base).toBe(22);
    expect(entry?.multiplier).toBe(1);
    expect(entry?.total).toBe(22);
  });

  it('払いサイコロ [逆ぽっち] の連続ゾロ目特典は倍率適用で払いになる [2026-07-21 リョー裁定]', () => {
    const s = get(game);
    // 2026-07-20 裁定でゾロ目特典はシュバサイ限定 [発動条件は維持]。
    // 2026-07-21 裁定 [Google Doc 準拠] で額は出目当てと同じ倍率を受ける:
    // シュバは chip 倍率に乗らず [bypass]、ぽっち -2 が乗って 22 → -44 オール
    // [旧 2026-07-18 の「同額のまま符号だけ反転」は上書き]
    s.game.shuvariActive[0] = true;
    s.game.pochiMultiplier[0] = { defen: -1, chip: -2 };
    s.pendingSaiKoro = {
      winner: 0 as PlayerId,
      chances: [{ name: 'pay dice', baseChip: 70, shuvariApplicable: true, count: 1, plusMinus: '+' as const, mode: 'tsumo' }],
      currentIdx: 0,
      selectedCombo: [1, 2],
      rolls: [],
      finalized: false,
      summary: null,
    } as any;
    const ledgerBefore = { ...s.game.chipLedger };
    game.rollSaiKoroDice([2, 2]);
    game.rollSaiKoroDice([2, 2]);
    const after = get(game);
    const entry = after.game.chipBreakdown.at(-1);
    expect(entry?.base).toBe(22);
    expect(entry?.multiplier).toBe(-2);
    expect(entry?.total).toBe(-44);
    // winner が 44 オール払い → 本人 -88、他家 +44 ずつ
    expect(after.game.chipLedger[0] - ledgerBefore[0]).toBe(-88);
    expect(after.game.chipLedger[1] - ledgerBefore[1]).toBe(44);
    expect(after.game.chipLedger[2] - ledgerBefore[2]).toBe(44);
  });

  it('連続ゾロ目特典は2回目の出目で額が決まる [1→111 / n→n*11]', () => {
    const s = get(game);
    s.game.shuvariActive[0] = true;
    s.pendingSaiKoro = {
      winner: 0 as PlayerId,
      chances: [{ name: 'ones dice', baseChip: 1, shuvariApplicable: true, count: 1, plusMinus: '+' as const }],
      currentIdx: 0,
      selectedCombo: [1, 2],
      rolls: [],
      finalized: false,
      summary: null,
    } as any;
    game.rollSaiKoroDice([5, 5]);
    game.rollSaiKoroDice([1, 1]);
    const after = get(game);
    const entry = after.game.chipBreakdown.at(-1);
    expect(entry?.base).toBe(111);
    expect(entry?.total).toBe(111);
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

  it('シュバリー中でも連続ゾロ目祝儀は固定額 [リョー裁定: 倍率は上がらない]', () => {
    const s = get(game);
    s.game.shuvariActive[0] = true;
    s.pendingSaiKoro = {
      winner: 0 as PlayerId,
      chances: [{ name: 'fixed dice', baseChip: 1, shuvariApplicable: true, count: 1, plusMinus: '+' as const }],
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
    expect(zoro?.multiplier).toBe(1);
    expect(zoro?.total).toBe(22);
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
