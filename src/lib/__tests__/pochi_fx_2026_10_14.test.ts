import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PochiSqueeze from '../PochiSqueeze.svelte';
import { expectationGlow, kakuteiOf, pochiRevealText, publicPochiCandidates } from '../pochiFx';

// [2026-10-14 リョー、演出のラフ 1〜3 版] 白ぽっち ・ でかぽっちの絞り
describe('pochiFx', () => {
  it('めくれた後の字は色の名前と効果 (3 版 T1 a)、でかぽっちはでかぽっち', () => {
    expect(pochiRevealText('blue')).toEqual({ word: '青ぽっち', tag: 'チップ ×2' });
    expect(pochiRevealText('red')).toEqual({ word: '赤ぽっち', tag: '逆払い ×2' });
    expect(pochiRevealText('green', true)).toEqual({ word: 'でかぽっち', tag: 'チップ ×1' });
  });
  it('枠の光り: 逆では虹を出さない。正では虹が出る事がある', () => {
    for (let r = 0; r < 1; r += 0.01) expect(expectationGlow(false, r)).not.toContain('rainbow');
    expect(expectationGlow(true, 0.1)).toEqual(['gold', 'rainbow']);
    expect(expectationGlow(true, 0.9)).toEqual(['white', 'white']);
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

describe('PochiSqueeze', () => {
  it('裏向きの牌と、指で絞る案内を出す (めくる前は色の名前を出さない)', () => {
    const { body } = render(PochiSqueeze, { props: { color: 'blue' } });
    expect(body).toContain('sq-cover');
    expect(body).toContain('下から上へ指で絞る');
    expect(body).not.toContain('青ぽっち');
  });
  it('確定の時は絞りの前に確定の帯、でかぽっちは筒子の絵', () => {
    const { body } = render(PochiSqueeze, { props: { color: 'green', deka: 'p1', kakutei: 'good' } });
    expect(body).toContain('確定');
    expect(body).toContain('/tiles/Pin1.svg');
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
