import { describe, expect, it } from 'vitest';
import { kakuteiOf, pochiRevealText, publicPochiCandidates } from '../pochiFx';

// [2026-10-14 リョー、演出のラフ 1〜3 版] 白ぽっち ・ でかぽっちの絞り
describe('pochiFx', () => {
  it('めくれた後の字は色の名前と効果 (3 版 T1 a)、でかぽっちはでかぽっち', () => {
    expect(pochiRevealText('blue')).toEqual({ word: '青ぽっち', tag: 'チップ ×2' });
    expect(pochiRevealText('red')).toEqual({ word: '赤ぽっち', tag: '逆払い ×2' });
    expect(pochiRevealText('green', true)).toEqual({ word: 'でかぽっち', tag: 'チップ ×1' });
  });
  it('見えている白ぽっちを除いて、残りが正だけ ・ 逆だけなら確定', () => {
    const game = (river: string[], dora: string[] = []) => ({
      discardLog: { 0: river.map((c) => ({ pai: 'z5', pochi: c })), 1: [], 2: [] },
      shoupai: { get: () => ({ _anmikaFulouPhysical: [] }) },
      shan: { baopai: dora },
    });
    expect(publicPochiCandidates(game(['red', 'yellow']))).toEqual(['blue', 'green']);
    expect(kakuteiOf(publicPochiCandidates(game(['red', 'yellow'])))).toBe('good');
    expect(kakuteiOf(publicPochiCandidates(game(['blue'], ['z5g'])))).toBe('bad');
    expect(kakuteiOf(publicPochiCandidates(game(['red'])))).toBeNull();
  });
});

// [2026-10-14 リョー「フィーバー時にポッチの残り状況も待ちと一緒に見せたい」「これは他家の手牌はいれずにね」]
import { pochiLeftForViewer, pochiColorOfKey } from '../pochiFx';
describe('フィーバー中のぽっちの残り', () => {
  const game = (discards: Record<number, string[]>, baopai: string[] = [], hands: Record<number, string[]> = {}) => ({
    discardLog: [0, 1, 2].map((p) => (discards[p] ?? []).map((c) => ({ pochi: c }))),
    shoupai: { get: (p: number) => ({ _anmikaFulouPhysical: [], _hand: hands[p] ?? [] }) },
    shan: { baopai },
  });
  it('河 ・ ドラ表示 ・ 自分の手牌に出た色を除く', () => {
    expect(pochiLeftForViewer(game({ 1: ['red'] }, ['z5y']), ['m1', 'bu'])).toEqual(['green']);
  });
  it('他の人の手牌は数えない (持っていても残りに入る)', () => {
    // 他の人の手牌は shoupai の中にあっても見ない。自分の手牌として渡した物だけ除く
    expect(pochiLeftForViewer(game({}, [], { 1: ['z5b'] }), [])).toEqual(['blue', 'red', 'green', 'yellow']);
  });
  it('表示の鍵から色', () => {
    expect([pochiColorOfKey('bu'), pochiColorOfKey('z5r'), pochiColorOfKey('bg'), pochiColorOfKey('p5')]).toEqual(['blue', 'red', 'green', null]);
  });
});

// [2026-10-14 4 版の答え] ステップアップ ・ 溜め ・ プレミアは 2026-10-25 にムービー + PUSH へ作り直した (pochi_movie_2026_10_25.test.ts)
