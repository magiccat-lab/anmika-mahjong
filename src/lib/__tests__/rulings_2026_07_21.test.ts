import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game, resolvePreSettlementPochiChoices } from '../store';
import { buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 2026-07-21 リョー裁定の回帰テスト
// 裁定1: 連続ゾロ目特典は出目当てと同じ倍率 [FEVER tier / ぽっち] を受ける [シュバサイ限定は維持]
// 裁定2: 神ぽっち target は局中固定せず、和了ごとに現手牌の最多牌で再計算する
// 裁定6: FEVER ロン継続の再開席は放銃者の次 [ronfrom 未保持の旧 state は winner 基準]

function setupZoroChance(mode: 'tsumo' | 'ron' = 'tsumo'): any {
  const s: any = get(game);
  s.pendingSaiKoro = {
    winner: 0 as PlayerId,
    chances: [{
      name: 'テストサイ',
      baseChip: 70,
      shuvariApplicable: true,
      alwaysShuvari: true,
      count: 1,
      plusMinus: '+' as const,
      rollCount: 4,
      mode,
    }],
    currentIdx: 0,
    selectedCombo: [1, 2] as [number, number],
    rolls: [],
    finalized: false,
    summary: null,
  };
  return s;
}

describe('裁定1 [2026-07-21]: 連続ゾロ目特典の倍率', () => {
  beforeEach(() => {
    game.reset();
  });

  it('非 FEVER・ぽっち無しは従来どおり 22 オール [n=2]', () => {
    const s = setupZoroChance('tsumo');
    const before = { ...s.game.chipLedger };
    game.rollSaiKoroDice([2, 2]); // 1 回目ゾロ [特典なし]
    game.rollSaiKoroDice([2, 2]); // 2 回目ゾロ [連続特典 22]
    const after: any = get(game);
    expect(after.game.chipLedger[0] - before[0]).toBe(44); // 22 オール = +22×2
    expect(after.game.chipLedger[1] - before[1]).toBe(-22);
    expect(after.game.chipLedger[2] - before[2]).toBe(-22);
  });

  it('FEVER tier2 中は基本 22 に FEVER×2 が乗って 44 オール', () => {
    const s = setupZoroChance('tsumo');
    s.game.feverActive[0] = true;
    s.game.feverTier[0] = 2;
    const before = { ...s.game.chipLedger };
    game.rollSaiKoroDice([2, 2]);
    game.rollSaiKoroDice([2, 2]);
    const after: any = get(game);
    expect(after.game.chipLedger[0] - before[0]).toBe(88); // 44 オール
    expect(after.game.chipLedger[1] - before[1]).toBe(-44);
    expect(after.game.chipLedger[2] - before[2]).toBe(-44);
  });

  it('逆ぽっち [chip -2] は倍率適用で払いに反転する [33 → -66 オール]', () => {
    const s = setupZoroChance('tsumo');
    s.game.pochiMultiplier[0] = { chip: -2, point: 1 } as any;
    const before = { ...s.game.chipLedger };
    game.rollSaiKoroDice([3, 3]);
    game.rollSaiKoroDice([3, 3]); // 基本 33 × ぽっち -2 = -66 オール
    const after: any = get(game);
    expect(after.game.chipLedger[0] - before[0]).toBe(-132);
    expect(after.game.chipLedger[1] - before[1]).toBe(66);
    expect(after.game.chipLedger[2] - before[2]).toBe(66);
  });

  it('1 のゾロ目は基本 111 [FEVER tier3 で ×4 = 444 オール]', () => {
    const s = setupZoroChance('tsumo');
    s.game.feverActive[0] = true;
    s.game.feverTier[0] = 3;
    const before = { ...s.game.chipLedger };
    game.rollSaiKoroDice([1, 1]);
    game.rollSaiKoroDice([1, 1]);
    const after: any = get(game);
    expect(after.game.chipLedger[0] - before[0]).toBe(888); // 444 オール
    expect(after.game.chipLedger[1] - before[1]).toBe(-444);
  });
});

describe('裁定2 [2026-07-21]: 神ぽっち target 和了ごと再計算', () => {
  beforeEach(() => {
    game.reset();
  });

  it('前回和了の choice が残っていても現手牌の最多牌で選び直す', () => {
    const s: any = get(game);
    const g = s.game;
    g.shan.baopai[0] = 'z5b'; // 表示牌 1 枚目を正ぽっちに
    // 前回和了 [同一 FEVER 続行] の残骸: p1 を選んでいた
    g.kamiPochiDoraChoices[0]['baopai:0'] = 'p1';
    // 現手牌は s9 が最多
    g.shoupai.set(
      0 as PlayerId,
      buildShoupai(['s9', 's9', 's9', 'm1', 'm2', 'm3', 'p2', 'p3', 'p4', 'z1', 'z1', 'z2', 'z3']),
    );
    g.saveSnapshot();
    const marker = { fanshu: 1 };
    const res = resolvePreSettlementPochiChoices(
      s,
      { fanshu: 0 },
      { winner: 0 as PlayerId, isRon: false, ronfrom: null },
      () => marker,
    );
    expect(res.pending).toBe(false);
    expect(res.result).toBe(marker); // choice を選び直したので再計算が走った
    expect(g.kamiPochiDoraChoices[0]['baopai:0']).toBe('s9');
  });

  it('choice 未確定の occurrence も従来どおり最多牌で確定する', () => {
    const s: any = get(game);
    const g = s.game;
    g.shan.baopai[0] = 'z5g';
    g.shoupai.set(
      0 as PlayerId,
      buildShoupai(['p7', 'p7', 'p7', 'm1', 'm2', 'm3', 's2', 's3', 's4', 'z1', 'z1', 'z2', 'z3']),
    );
    g.saveSnapshot();
    const marker = { fanshu: 2 };
    const res = resolvePreSettlementPochiChoices(
      s,
      { fanshu: 0 },
      { winner: 0 as PlayerId, isRon: false, ronfrom: null },
      () => marker,
    );
    expect(res.pending).toBe(false);
    expect(g.kamiPochiDoraChoices[0]['baopai:0']).toBe('p7');
  });
});

describe('裁定6 [2026-07-21]: FEVER ロン継続の再開席', () => {
  beforeEach(() => {
    game.reset();
  });

  function setupFeverRonContinue(pending: { winner: number; isRon: boolean; ronfrom?: number | null }) {
    const s: any = get(game);
    const g = s.game;
    g.feverActive[pending.winner as PlayerId] = true;
    s.lastWinner = pending.winner;
    s.lastHuleResult = {};
    s.pendingFeverContinue = pending;
    return s;
  }

  it('ronfrom [放銃者] の次の席からツモが再開する', () => {
    setupFeverRonContinue({ winner: 0, isRon: true, ronfrom: 2 });
    game.continueFever();
    const after: any = get(game);
    // 反時計回り: 放銃者 p2 の次 = p1
    const cur = after.game.lunbanToPlayerId(after.game.state.lunban);
    expect(cur).toBe(1);
  });

  it('winner 自身が基準にならない [winner=0, ronfrom=1 なら次は p0]', () => {
    setupFeverRonContinue({ winner: 0, isRon: true, ronfrom: 1 });
    game.continueFever();
    const after: any = get(game);
    const cur = after.game.lunbanToPlayerId(after.game.state.lunban);
    expect(cur).toBe(0);
  });

  it('ronfrom 未保持の旧 state は従来どおり winner の次から再開する', () => {
    setupFeverRonContinue({ winner: 0, isRon: true });
    game.continueFever();
    const after: any = get(game);
    // 旧挙動: winner p0 の次 = p2
    const cur = after.game.lunbanToPlayerId(after.game.state.lunban);
    expect(cur).toBe(2);
  });
});
