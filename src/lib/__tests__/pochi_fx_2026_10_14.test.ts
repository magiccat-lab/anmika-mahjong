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
  // [4 版の 2] 開いた直後は予告 (稲妻と「ぽっちチャンス」)。指で絞る案内と確定の帯は予告の 1.6 秒の後
  it('裏向きの牌と予告を出す (めくる前は色の名前を出さない)', () => {
    const { body } = render(PochiSqueeze, { props: { color: 'blue', step: 3 } });
    expect(body).toContain('sq-cover');
    expect(body).toContain('ぽっちチャンス');
    expect(body).toContain('sq-bolt glow-gold');
    expect(body).not.toContain('下から上へ指で絞る');
    expect(body).not.toContain('青ぽっち');
  });
  it('確定 (正) なら予告の稲妻は虹、でかぽっちは筒子の絵', () => {
    const { body } = render(PochiSqueeze, { props: { color: 'green', deka: 'p1', kakutei: 'good' } });
    expect(body).toContain('sq-bolt glow-rainbow');
    expect(body).toContain('/tiles/Pin1.svg');
  });
  it('決め台詞の予告はカットインと「ぽっちチャンス」で、稲妻は出さない', () => {
    const { body } = render(PochiSqueeze, { props: { color: 'blue', step: 4, teaser: 'line' } });
    expect(body).toContain('白って 200 色あんねん');
    expect(body).toContain('sq-ci glow-rainbow');
    expect(body).toContain('ぽっちチャンス');
    expect(body).not.toContain('sq-bolt');
  });
  it('プレミアの時は予告の代わりにプレミア', () => {
    const { body } = render(PochiSqueeze, { props: { color: 'blue', step: 4, premium: true } });
    expect(body).toContain('アンミカーニバル');
    expect(body).not.toContain('sq-bolt');
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

// [2026-10-14 4 版の答え] ステップアップ ・ 溜め ・ プレミア
import { expectationStep, pochiTopStep, premiumRoll, stepAt, STEP_AT, TAME_FROM, TAME_TO, legacyGlowOfStep } from '../pochiFx';
describe('白ぽっちの強化 (4 版)', () => {
  it('逆は虹 (5 段目) まで上がらない、正は虹 3 割', () => {
    for (let i = 0; i < 1000; i++) expect(expectationStep(false, i / 1000)).toBeLessThan(4);
    const rainbow = Array.from({ length: 1000 }, (_, i) => expectationStep(true, i / 1000)).filter((k) => k === 4).length;
    expect(rainbow).toBe(300);
  });
  it('見えている牌で決まっていれば、正は虹まで ・ 逆は白で止める', () => {
    expect(pochiTopStep(true, 'good', 0.99)).toBe(4);
    expect(pochiTopStep(false, 'bad', 0.0)).toBe(0);
  });
  it('段は点がのぞく (0.44) より前に上がり切り、上限を越えない', () => {
    expect(STEP_AT[4]).toBeLessThan(0.44);
    expect(stepAt(0.05, 4)).toBe(-1);
    expect(stepAt(0.5, 4)).toBe(4);
    expect(stepAt(0.5, 2)).toBe(2);
  });
  it('溜めは点がのぞく所を挟む', () => {
    expect(TAME_FROM).toBeLessThan(0.44);
    expect(TAME_TO).toBeGreaterThan(0.44);
  });
  it('プレミアは虹の時の 1 割だけ', () => {
    expect(premiumRoll(4, 0.05)).toBe(true);
    expect(premiumRoll(4, 0.2)).toBe(false);
    expect(premiumRoll(3, 0.0)).toBe(false);
  });
  it('前の型の端末へは光り 2 段に直して渡す', () => {
    expect(legacyGlowOfStep(4)).toEqual(['gold', 'rainbow']);
    expect(legacyGlowOfStep(1)).toEqual(['white', 'white']);
  });
});
