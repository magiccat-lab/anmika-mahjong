// 2026-07-21 リョー要望: 打牌アドバイスモード [CPU戦のみ、💡ボタンで候補表示]。
// adviseDiscard は pickBestDiscard と同じ evaluateDiscardRows_ を使う単一の物差し。
// ここでは (1) 推奨とCPU実選択の一致 (2) 安全度ラベルの根拠 (3) 強制ツモ切りの表現
// (4) 評価が山 [shan] を一切動かさないこと、を固定する。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

function shanFingerprint(g: any) {
  return JSON.stringify({
    baopai: [...g.shan.baopai],
    fubaopai: [...(g.shan.fubaopai ?? [])],
    paishu: g.shan.paishu,
    pai: [...(g.shan as any)._pai],
  });
}

function setHand(s: any, player: number, tiles13: string[], zimo: string) {
  s.game.shoupai.set(player, buildShoupai(tiles13));
  (s.game.shoupai.get(player) as any).zimo(zimo);
  s.lastZimo = zimo;
}

describe('adviseDiscard [打牌アドバイス]', () => {
  beforeEach(() => { game.reset(); });

  it('通常手: 候補が出て、1位の推奨は pickBestDiscard と一致する', () => {
    const s: any = get(game);
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    setHand(s, cur, [
      'p2', 'p3', 'p4',
      'p6', 'p7', 'p9',
      's2', 's3', 's4',
      's6', 's8',
      'z1', 'z1',
    ], 'z3');
    const rows = s.game.adviseDiscard(cur, 5);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
    const picked = s.game.pickBestDiscard(cur);
    const recommended = rows.filter((r: any) => r.recommended);
    expect(recommended.length).toBe(1);
    expect(recommended[0].pai).toBe(picked);
    // 並びは向聴優先: 先頭は最小向聴
    const minXt = Math.min(...rows.map((r: any) => r.xiangting));
    expect(rows[0].xiangting).toBe(minXt);
  });

  it('リーチ家がいる時: 現物候補に safety=10 が付き、ベタオリ圏では上位に来る', () => {
    const s: any = get(game);
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    const opp = ((cur + 1) % 3) as any;
    // 相手リーチ + 河に z1 [現物]
    s.game.lizhi.add(opp);
    const oppHe = s.game.he.get(opp);
    oppHe._pai.push('z1');
    // 自分はバラバラの2シャンテン以上 [fold圏] で z1 現物持ち。
    // 幺九字の種類を絞って国士シャンテンが低く出ないようにする
    // [初版は雑多な字牌構成が偶然国士1シャンテンになり fold に入らなかった]
    setHand(s, cur, [
      'p1', 'p4', 'p7',
      's1', 's4', 's7',
      'z1', 'z1', 'z2',
      'z2', 'z3',
      'm7', 'm7',
    ], 'z7');
    const rows = s.game.adviseDiscard(cur, 13);
    const z1row = rows.find((r: any) => r.base === 'z1');
    expect(z1row).toBeTruthy();
    expect(z1row.hasLizhiOpponent).toBe(true);
    expect(z1row.safety).toBe(10);
    // fold圏では安全度最優先 → 現物が先頭
    expect(rows[0].safety).toBe(10);
    // CPU実選択との一致 [fold時も同じ物差し]
    const picked = s.game.pickBestDiscard(cur);
    expect(rows.find((r: any) => r.recommended)?.pai).toBe(picked);
  });

  it('他家フィーバー中: 強制ツモ切り1行 [forced=fever] になり、CPU選択とも一致', () => {
    const s: any = get(game);
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    const opp = ((cur + 1) % 3) as any;
    s.game.feverActive[opp] = true;
    setHand(s, cur, [
      'p2', 'p3', 'p4',
      'p6', 'p7', 'p9',
      's2', 's3', 's4',
      's6', 's8',
      'z1', 'z1',
    ], 'p9');
    const rows = s.game.adviseDiscard(cur, 5);
    expect(rows.length).toBe(1);
    expect(rows[0].forced).toBe('fever');
    expect(rows[0].recommended).toBe(true);
    expect(rows[0].pai).toBe('p9');
    expect(s.game.pickBestDiscard(cur)).toBe('p9');
  });

  it('adviseDiscard は山を一切動かさない', () => {
    const s: any = get(game);
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    setHand(s, cur, [
      'p2', 'p3', 'p4',
      'p6', 'p7', 'p9',
      's2', 's3', 's4',
      's6', 's8',
      'z1', 'z1',
    ], 'z3');
    const before = shanFingerprint(s.game);
    s.game.adviseDiscard(cur, 5);
    s.game.pickBestDiscard(cur);
    expect(shanFingerprint(s.game)).toBe(before);
  });
});
