// 2026-07-16 リョー裁定: 流局時のテンパイ料 場4000。
// 1人聴牌: +4000 [ノーテン2人が2000ずつ] / 2人聴牌: +2000ずつ [ノーテン1人が4000]。
// 全員聴牌・全員ノーテン・フィーバーアガリ済み流局は移動なし。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game, applyPingjuTransition } from '../store';
import { buildShoupai } from '../game3';

const TENPAI = [
  'p2', 'p3', 'p4',
  'p5', 'p6', 'p7',
  's2', 's3', 's4',
  's5', 's6',
  'm2', 'm2',
];
const NOTEN = [
  'm2', 'm7', 'm9',
  'p1', 'p4', 'p9',
  's1', 's5', 's9',
  'z1', 'z2', 'z3',
  'z6',
];

function setHands(hands: string[][]): any {
  const s: any = get(game);
  for (const p of [0, 1, 2]) s.game.shoupai.set(p, buildShoupai(hands[p]));
  return s;
}

describe('流局テンパイ料 [場4000]', () => {
  beforeEach(() => {
    game.reset();
  });

  it('1人聴牌: +4000 / -2000 / -2000', () => {
    let s = setHands([TENPAI, NOTEN, NOTEN]);
    s = applyPingjuTransition(s, 'test:');
    expect(s.game.state.defen[0]).toBe(39000);
    expect(s.game.state.defen[1]).toBe(33000);
    expect(s.game.state.defen[2]).toBe(33000);
    expect(s.pendingPingju).toBe(true);
  });

  it('2人聴牌: +2000 / +2000 / -4000', () => {
    let s = setHands([TENPAI, TENPAI, NOTEN]);
    s = applyPingjuTransition(s, 'test:');
    expect(s.game.state.defen[0]).toBe(37000);
    expect(s.game.state.defen[1]).toBe(37000);
    expect(s.game.state.defen[2]).toBe(31000);
  });

  it('全員聴牌は移動なし', () => {
    let s = setHands([TENPAI, TENPAI, TENPAI]);
    s = applyPingjuTransition(s, 'test:');
    for (const p of [0, 1, 2]) expect(s.game.state.defen[p]).toBe(35000);
  });

  it('全員ノーテンは移動なし', () => {
    let s = setHands([NOTEN, NOTEN, NOTEN]);
    s = applyPingjuTransition(s, 'test:');
    for (const p of [0, 1, 2]) expect(s.game.state.defen[p]).toBe(35000);
  });

  it('フィーバーアガリ済み流局は移動なし', () => {
    let s = setHands([TENPAI, NOTEN, NOTEN]);
    s.game.feverWinCount[0] = 1;
    s = applyPingjuTransition(s, 'test:');
    for (const p of [0, 1, 2]) expect(s.game.state.defen[p]).toBe(35000);
  });

  it('フィーバーリーチ中 [未アガリ] の流局は宣言者だけ強制テンパイ [+4000/-2000/-2000]', () => {
    // 2026-07-16 リョー裁定: 他家が実テンパイでも数えない
    let s = setHands([NOTEN, TENPAI, TENPAI]);
    s.game.feverActive[0] = true;
    s = applyPingjuTransition(s, 'test:');
    expect(s.game.state.defen[0]).toBe(39000);
    expect(s.game.state.defen[1]).toBe(33000);
    expect(s.game.state.defen[2]).toBe(33000);
  });
});
