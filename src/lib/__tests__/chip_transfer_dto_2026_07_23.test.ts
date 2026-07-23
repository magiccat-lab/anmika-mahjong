import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection } from '../../../server/ws_server';
import { buildChipTransferRows } from '../chipTransfer';
import { Game3, buildShoupai } from '../game3';
import { createGameStore } from '../store';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import type { PlayerId } from '../types';

// [2026-07-23 Sol設計 chipTransfer DTO]
// 1. 表示行分解 [greedy]: 旧実装の payer×payee 全組合せ列挙は複数支払×複数受取で
//    合計が過大表示になっていた
// 2. applyHule が chipTotal 確定と同時に result.chipTransfer [before/after/delta] を焼き込む
// 3. authority result → captureSeatProjection → client hydrate の 3 点 roundtrip で field が残る

describe('buildChipTransferRows [greedy 分解]', () => {
  it('単純ツモ [2人が winner に支払い]', () => {
    const rows = buildChipTransferRows({ 0: 4, 1: -2, 2: -2 });
    expect(rows).toEqual([
      { from: 1, to: 0, count: 2 },
      { from: 2, to: 0, count: 2 },
    ]);
  });

  it('複数支払×複数受取で行合計 = 実移動枚数 [旧実装は過大表示]', () => {
    // (-2, -2, +3, +1) 相当: 旧実装は 4 行 min の総和 6 枚に見えていた
    const rows = buildChipTransferRows({ 0: -2, 1: -2, 2: 4 } as any);
    const total = rows.reduce((s, r) => s + r.count, 0);
    expect(total).toBe(4);
    // 3 席なので実ケースで再現: payer2 → payee2 の混成
    const rows2 = buildChipTransferRows({ 0: -2, 1: 3, 2: -1 });
    expect(rows2).toEqual([
      { from: 0, to: 1, count: 2 },
      { from: 2, to: 1, count: 1 },
    ]);
    expect(rows2.reduce((s, r) => s + r.count, 0)).toBe(3);
  });

  it('移動なしは空、非ゼロサム入力でも捏造行を作らない', () => {
    expect(buildChipTransferRows({ 0: 0, 1: 0, 2: 0 })).toEqual([]);
    // 受取だけ [想定外入力]: 支払い元が無いので行は出さない
    expect(buildChipTransferRows({ 0: 5, 1: 0, 2: 0 })).toEqual([]);
  });
});

describe('applyHule の chipTransfer 焼き込み', () => {
  function chipMovingHule(): { g: Game3; winner: PlayerId; result: any } {
    // D-09 fixture 流用: 役満扱いの result でチップ移動を発生させる
    const g = new Game3({ qijia: 0 });
    g.qipai();
    const winner = 0 as PlayerId;
    const sp = buildShoupai(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's7', 's8', 's9', 'z1', 'z1', 'p5', 'p5']);
    sp._zimo = 'p5';
    g.shoupai.set(winner, sp);
    const result: any = {
      hupai: [{ name: '立直', fanshu: 1 }, { name: '清一色', fanshu: 6 }],
      fanshu: 13,
      fu: 40,
      defen: 16000,
      defen3: 16000,
      fenpei: [0, 0, 0, 0],
      damanguan: 1,
      _chipLedgerBeforeThis: { 0: g.chipLedger[0], 1: g.chipLedger[1], 2: g.chipLedger[2] },
    };
    return { g, winner, result };
  }

  it('delta[winner] === chipTotal、delta はゼロサム、after - before = delta', () => {
    const { g, winner, result } = chipMovingHule();
    g.applyHule(result, winner, null);
    const ct = result.chipTransfer;
    expect(ct).toBeTruthy();
    expect(ct.v).toBe(1);
    expect(ct.delta[winner]).toBe(result.chipTotal);
    expect(result.chipTotal).toBeGreaterThan(0);
    expect(ct.delta[0] + ct.delta[1] + ct.delta[2]).toBe(0);
    for (const p of [0, 1, 2] as PlayerId[]) {
      expect(ct.after[p] - ct.before[p]).toBe(ct.delta[p]);
      expect(ct.after[p]).toBe(g.chipLedger[p]);
    }
  });

  it('hule event にも同じ chipTransfer が乗る [戦績集計用]', () => {
    const { g, winner, result } = chipMovingHule();
    g.applyHule(result, winner, null);
    const huleEvents = (g.events as any[]).filter((e) => e.type === 'hule');
    expect(huleEvents.length).toBeGreaterThan(0);
    const ev = huleEvents[huleEvents.length - 1];
    expect(ev.chipTransfer).toEqual(result.chipTransfer);
  });
});

describe('authority → projection → hydrate roundtrip', () => {
  it('lastHuleResult.chipTransfer が 3 点を通して保持される', () => {
    const authority = createRoomAuthority({
      preShuffledPool: generateTilePool(defaultSanmaRule()).map(String),
      qijia: 0,
    });
    const fixture = {
      v: 1,
      before: { 0: 0, 1: 0, 2: 0 },
      after: { 0: 10, 1: -4, 2: -6 },
      delta: { 0: 10, 1: -4, 2: -6 },
    };
    const state = authority.canonicalState();
    state.roundEnded = true;
    state.lastWinner = 0;
    state.lastHuleResult = {
      fanshu: 3,
      defen: 5800,
      hupai: [{ name: '立直', fanshu: 1 }],
      chipTransfer: fixture,
    };

    const recipient = 1 as const;
    const projection: any = captureSeatProjection(authority, recipient);
    expect(projection.store.lastHuleResult?.chipTransfer).toEqual(fixture);

    const game = createGameStore();
    game.initOnlineGame({
      ws: { readyState: 0, send() {} } as unknown as WebSocket,
      qijia: 0,
      mySeat: recipient,
      blindStart: {
        hands: { 0: [], 1: [], 2: [] },
        firstZimo: '',
        paishu: projection.shan.paishu,
        baopai: projection.shan.baopai,
        fubaopai: null,
      },
    });
    expect(game.hydrateOnlineProjection(projection)).toBe(true);
    const hydrated: any = get(game);
    expect(hydrated.lastHuleResult?.chipTransfer).toEqual(fixture);
    // 表示行も DTO から一意に出る
    expect(buildChipTransferRows(hydrated.lastHuleResult.chipTransfer.delta)).toEqual([
      { from: 1, to: 0, count: 4 },
      { from: 2, to: 0, count: 6 },
    ]);
  });
});
