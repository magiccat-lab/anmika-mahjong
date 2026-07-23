import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyChipFromLoser, applyChipOall, type ChipState } from '../game3/chip';
import { Game3 } from '../game3';
import { createGameStore } from '../store';
import type { PlayerId } from '../types';

// [2026-07-23 4人回し Phase1, Sol設計] chip effect seam:
// 4人回しの room 4-way ledger が「サイコロ精算だけ抜け番も頭数に入れる」ため、
// 精算確定点で型付き effect を発行する。Sol レビュー観点をそのままテスト化:
//  (a) 種別が label 文字列に依存しない (b) actualN 確定点で 1 精算 = 1 発行
//  (c) 投機評価/巻き戻しで幻の effect が残らない (d) 複数精算で重複も欠落もない
//  (e) 既存 3-way ledger の数値は不変

function bareState(): ChipState {
  return {
    shuvariActive: { 0: false, 1: false, 2: false },
    feverActive: { 0: false, 1: false, 2: false },
    feverTier: { 0: 1, 1: 1, 2: 1 },
    pochiMultiplier: { 0: 1, 1: 1, 2: 1 },
    chipLedger: { 0: 0, 1: 0, 2: 0 },
    chipBreakdown: [],
    chipEffects: [],
  };
}

describe('chip effect seam [pure helpers]', () => {
  it('oall: 1精算=1発行、perPayer が倍率適用後の実額 = ledger 差分と一致', () => {
    const st = bareState();
    st.feverActive[0] = true;
    st.feverTier[0] = 2; // ×2
    applyChipOall(st, 0, 5, { label: '🎲 サイコロ テスト', settlementKind: 'dice' });
    expect(st.chipEffects).toHaveLength(1);
    const e = st.chipEffects![0];
    expect(e.kind).toBe('dice');
    expect(e.form).toBe('oall');
    expect(e.winner).toBe(0);
    expect(e.loser).toBeNull();
    expect(e.perPayer).toBe(10); // 5 × fever2
    // ledger 整合 [3人打ち: winner +2N、他 -N ずつ]
    expect(st.chipLedger).toEqual({ 0: 20, 1: -10, 2: -10 });
    expect(e.perPayer).toBe(-st.chipLedger[1]);
  });

  it('種別は settlementKind だけで決まる [label にサイコロ絵文字があっても normal]', () => {
    const st = bareState();
    applyChipOall(st, 1, 3, { label: '🎲 これはラベル詐欺' });
    expect(st.chipEffects![0].kind).toBe('normal');
    applyChipOall(st, 1, 3, { label: '普通のラベル', settlementKind: 'dice' });
    expect(st.chipEffects![1].kind).toBe('dice');
  });

  it('fromLoser: loser が effect に載る [通常ロンはぽっち bypass が仕様なので m=1]', () => {
    const st = bareState();
    st.pochiMultiplier[2] = { defen: -1, chip: -2 } as any; // 非フィーバー ron では効かない [2026-05-21 仕様]
    applyChipFromLoser(st, 2, 0, 7, { label: 'ロン祝儀' });
    const e = st.chipEffects![0];
    expect(e.form).toBe('fromLoser');
    expect(e.winner).toBe(2);
    expect(e.loser).toBe(0);
    expect(e.perPayer).toBe(7);
    expect(st.chipLedger[2]).toBe(7);
    expect(st.chipLedger[0]).toBe(-7);
  });

  it('負倍率 [逆ぽっちのツモ払い] は perPayer が負で符号ごと伝わる', () => {
    const st = bareState();
    st.pochiMultiplier[2] = { defen: -1, chip: -2 } as any;
    applyChipOall(st, 2, 7, { label: '逆ぽっち祝儀', mode: 'tsumo', settlementKind: 'dice' });
    const e = st.chipEffects![0];
    expect(e.perPayer).toBe(-14); // 7 × (-2): 「オール」が支払い側に反転
    expect(st.chipLedger[2]).toBe(-28);
    expect(st.chipLedger[0]).toBe(14);
    expect(st.chipLedger[1]).toBe(14);
  });

  it('chipEffects 未定義の素 state でも落ちない [optional sink]', () => {
    const st = bareState();
    delete (st as any).chipEffects;
    expect(() => applyChipOall(st, 0, 1, {})).not.toThrow();
  });
});

describe('chip effect seam [Game3 統合]', () => {
  it('Game3 は sink を持ち、takeChipEffects は 1 回で drain される', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    g.applyChipOall(0, 2, { label: 'a', settlementKind: 'dice' });
    g.applyChipOall(1, 3, { label: 'b' });
    expect(g.chipEffects).toHaveLength(2);
    const taken = g.takeChipEffects();
    expect(taken.map((e) => e.kind)).toEqual(['dice', 'normal']);
    expect(g.chipEffects).toHaveLength(0);
    expect(g.takeChipEffects()).toHaveLength(0);
  });

  it('投機評価の巻き戻し [captureSnapshot→精算→applySnapshot] で effect が截断される', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    g.applyChipOall(0, 1, { label: '確定分' });
    const snap = g.captureSnapshot();
    g.applyChipOall(1, 5, { label: '投機分', settlementKind: 'dice' });
    g.applyChipFromLoser(1, 2, 3, { label: '投機分2' });
    expect(g.chipEffects).toHaveLength(3);
    g.applySnapshot(snap);
    // ledger と同時に effect も 1 件目まで巻き戻る [幻の精算を残さない]
    expect(g.chipEffects).toHaveLength(1);
    expect(g.chipEffects[0].label).toBe('確定分');
    expect(g.chipLedger).toEqual({ 0: 2, 1: -1, 2: -1 });
  });

  it('validation mirror 等の clone は sink を共有しない', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    const cloneEffects = structuredClone(g.chipEffects);
    g.applyChipOall(0, 1, {});
    expect(g.chipEffects).toHaveLength(1);
    expect(cloneEffects).toHaveLength(0);
  });
});

describe('chip effect seam [サイコロ実経路]', () => {
  const game = createGameStore();
  beforeEach(() => {
    game.reset();
  });

  function inject(chance: Record<string, unknown>) {
    const s = get(game);
    s.pendingSaiKoro = {
      winner: 0 as PlayerId,
      chances: [chance],
      currentIdx: 0,
      selectedCombo: [1, 2],
      rolls: [],
      finalized: false,
      summary: null,
    } as any;
  }

  it('出目当て finalize で kind=dice の effect が 1 回だけ出る', () => {
    inject({ name: 'test', baseChip: 70, shuvariApplicable: true, count: 1, plusMinus: '+', rollCount: 1 });
    const before = get(game).game.takeChipEffects().length; // 前提クリア
    expect(before).toBe(0);
    game.rollSaiKoroDice([1, 2]); // hit + rollCount=1 → 即 finalize
    const s = get(game);
    const effects = s.game.chipEffects as any[];
    const dice = effects.filter((e) => e.kind === 'dice');
    expect(dice).toHaveLength(1);
    expect(dice[0].winner).toBe(0);
    expect(dice[0].perPayer).toBe(70);
    // ledger 側 [既存 3-way 計算が不変であること]
    expect(s.game.chipLedger).toEqual({ 0: 140, 1: -70, 2: -70 });
  });

  it('ゾロ目連続特典 [シュバサイ] も dice 種別で発行される', () => {
    inject({ name: 'test', baseChip: 1, shuvariApplicable: true, alwaysShuvari: true, count: 1, plusMinus: '+', rollCount: 4 });
    game.rollSaiKoroDice([3, 3]);
    game.rollSaiKoroDice([4, 4]); // 2連続ゾロ → 特典 44 オール
    const s = get(game);
    const dice = (s.game.chipEffects as any[]).filter((e) => e.kind === 'dice');
    expect(dice).toHaveLength(1);
    expect(dice[0].perPayer).toBe(44);
    expect(dice[0].label).toContain('ゾロ目連続特典');
  });

  it('ハズレ [hit 0] finalize では dice effect は出ない [欠落でなく仕様]', () => {
    inject({ name: 'test', baseChip: 70, shuvariApplicable: true, count: 1, plusMinus: '+', rollCount: 1 });
    game.rollSaiKoroDice([5, 6]); // selectedCombo=[1,2] に不一致
    const s = get(game);
    expect((s.game.chipEffects as any[]).filter((e) => e.kind === 'dice')).toHaveLength(0);
    expect(s.game.chipLedger).toEqual({ 0: 0, 1: 0, 2: 0 });
  });
});
