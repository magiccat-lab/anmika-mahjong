// [2026-10-13 リョー「あがりが13ハンをオーバーした時、オーバーした分の祝儀は入ってないんじゃね、
//  あとそのときにかんぱーまんつもは8ハン扱いで計算するのとかも大丈夫？」] 13 翻超過祝儀の総点検。
// 普通の手と嵌八萬 [ツモは 8 翻で数える] は払われていた。国士無双 [7 萬 = 1 萬] は母数が 0、
// 嵌八萬 + 789 三色と三連刻はアンミカの通常役が母数から抜けていたので直した。
// ルールブック 3-2: 本役満和了時、通常の役として翻数を数え上げ、13翻を超えた分 1翻につき1枚。
//   嵌八萬 (ツモ) でこの数え上げをする際、嵌八萬を8翻の役として数える。
import { describe, it, expect } from 'vitest';

import { Game3, buildShoupai } from '../game3';

type PlayerId = 0 | 1 | 2;
const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

function buildBase(hand: string[], baopai: string[], fubaopai: string[] | null): any {
  const g: any = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) g.shoupai.set(p, buildShoupai(hand));
  const dummy: any = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  g.shan._pai = ['p9'];            // 海底・河底にしない
  g.shan.setBaopai(baopai, fubaopai);
  g.diyizimo = false;
  g.huapai = { 0: [], 1: [], 2: [] };
  return g;
}
/** hule → applyChipsOnHule して「13翻超過 ×N」の N を返す [無ければ 0] */
function excessChips(g: any, result: any, loser: PlayerId | null): number {
  g.applyChipsOnHule(result, P0, loser);
  for (const e of g.chipBreakdown) {
    const m = /13翻超過 ×(\d+)/.exec(String(e.label));
    if (m) return Number(m[1]);
  }
  return 0;
}

const KAN = ['m7', 'm9', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 's4', 's5', 's6', 's2', 's2'];            // + z5g ツモ/ロンで嵌八萬
const KAN789 = ['m7', 'm9', 'p7', 'p8', 'p9', 's7', 's8', 's9', 'p2', 'p3', 'p4', 's2', 's2'];        // 789 三色の嵌八萬
const KOKUSHI = ['m7', 'm9', 'p1', 'p9', 's1', 's9', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'];       // 7m = 1m

describe('13翻超過祝儀 [前から払われていた経路]', () => {
  it('数え役満ツモ: 立直1 ツモ1 一通2 裏12 = 16翻 → 3枚オール', () => {
    const g = buildBase(['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','z1','z1'], ['z7'], Array(6).fill('z4'));
    g.lizhi.add(P0);
    g.shoupai.get(P0).zimo('s3');
    const r = g.hule(P0, null, null);
    expect(r.fanshu).toBe(16);
    expect(excessChips(g, r, null)).toBe(3);
  });
  it('数え役満ロン: 放銃者払いで 13翻超過を払う', () => {
    const g = buildBase(['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','z1','z1'], ['z7'], Array(6).fill('z4'));
    g.lizhi.add(P0);
    const r = g.hule(P0, 's3', P1);
    expect(r.fanshu).toBe(15);
    expect(excessChips(g, r, P1)).toBe(2);
  });
  it('嵌八萬ツモは8翻で数える: 立直1 ツモ1 裏12 + 8 = 22翻 → 9枚', () => {
    const g = buildBase(KAN, ['z7'], Array(6).fill('s1'));
    g.lizhi.add(P0);
    g.shoupai.get(P0).zimo('z5g');
    const r = g.hule(P0, null, null);
    expect(r.damanguan).toBeGreaterThanOrEqual(1);
    expect(excessChips(g, r, null)).toBe(9);
  });
  it('嵌八萬ロン: 立直1 裏12 + 8 = 21翻 → 8枚', () => {
    const g = buildBase(KAN, ['z7'], Array(6).fill('s1'));
    g.lizhi.add(P0);
    g.discardLog[1] = [{ pai: 'z5g', pochi: 'green' }];
    const r = g.hule(P0, 'z5g', P1);
    expect(r.fanshu).toBe(21);
    expect(excessChips(g, r, P1)).toBe(8);
  });
  it('嵌八萬ツモ + 抜きドラ3 + 裏4: 立直1 ツモ1 裏4 抜3 + 8 = 17翻 → 4枚', () => {
    const g = buildBase(KAN, ['z7'], ['s1', 's1']);
    g.lizhi.add(P0);
    g.nukidora[P0] = 3;
    g.shoupai.get(P0).zimo('z5g');
    const r = g.hule(P0, null, null);
    expect(excessChips(g, r, null)).toBe(4);
  });
  it('嵌八萬ツモで13翻ちょうど [母数5 + 8] なら超過なし', () => {
    const g = buildBase(KAN, ['z7'], ['s1']);     // 裏2 → 立直1 ツモ1 裏2 = 4、+8 = 12
    g.lizhi.add(P0);
    g.nukidora[P0] = 1;                            // +1 = 13
    g.shoupai.get(P0).zimo('z5g');
    const r = g.hule(P0, null, null);
    expect(excessChips(g, r, null)).toBe(0);
  });
});

describe('13翻超過祝儀 [10-13 まで払われていなかった経路]', () => {
  it('国士無双 [7m=1m] ツモ: 立直 一発 ツモ 裏12 ほか 15翻超 → 超過祝儀が出る [実測 17翻 = 4枚]', () => {
    const g = buildBase(KOKUSHI, ['z7'], Array(6).fill('z1'));   // 裏: 東の表示 → 南 z2 が手に2枚 ×6 = 12
    g.lizhi.add(P0);
    g.yifaActive[P0] = true;
    g.shoupai.get(P0).zimo('z2');
    const r = g.hule(P0, null, null);
    expect(r.damanguan).toBeGreaterThanOrEqual(1);
    expect(excessChips(g, r, null)).toBe(4);
  });
  it('国士無双 [7m=1m] ロン: 立直 裏12 ほか 15翻 → 2枚、放銃者が払う', () => {
    const g = buildBase(KOKUSHI, ['z7'], Array(6).fill('z1'));
    g.lizhi.add(P0);
    const r = g.hule(P0, 'z2', P1);
    expect(r.damanguan).toBeGreaterThanOrEqual(1);
    expect(excessChips(g, r, P1)).toBe(2);
  });
  it('嵌八萬ツモ + 789三色 + 抜き2 + 裏4 は、同じ手のロン [21翻] より1翻多い 22翻 → 9枚', () => {
    const g = buildBase(KAN789, ['z7'], ['s1', 's1']);
    g.lizhi.add(P0);
    g.nukidora[P0] = 2;
    g.shoupai.get(P0).zimo('z5g');
    const r = g.hule(P0, null, null);
    expect(r.hupai.some((h: any) => String(h.name).startsWith('789 三色'))).toBe(true);
    // 立直1 ツモ1 三色同順2 789三色4 裏4 抜き2 + 嵌八萬8 = 22
    expect(excessChips(g, r, null)).toBe(9);
  });
  it('四暗刻に三連刻 [4翻] が付く手は、アンミカ独自の通常役も母数に数える', () => {
    const g = buildBase(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s1','s1','z1','z1'], ['z7'], ['p1', 'p2', 's9']);
    g.lizhi.add(P0);
    g.yifaActive[P0] = true;
    g.shoupai.get(P0).zimo('s1');
    const r = g.hule(P0, null, null);
    expect(r.hupai.some((h: any) => String(h.name).startsWith('三連刻'))).toBe(true);
    // 既存テスト yakuman_excess_han_2026_09_14 と同じ手。今は母数 17 [超過4枚]、三連刻4を足すと 21 → 8枚
    expect(excessChips(g, r, null)).toBe(8);
  });
  it('国士の 7 萬のドラは元の牌姿で数える [アンミカは 9 萬表示で 7 萬がドラ、裏 9 萬 ×3 で +3 枚]', () => {
    const plain = buildBase(KOKUSHI, ['z7'], Array(6).fill('z1'));
    plain.lizhi.add(P0);
    const base = plain.hule(P0, 'z2', P1);
    const withM9 = buildBase(KOKUSHI, ['z7'], [...Array(6).fill('z1'), 'm9', 'm9', 'm9']);
    withM9.lizhi.add(P0);
    const r = withM9.hule(P0, 'z2', P1);
    expect(excessChips(withM9, r, P1)).toBe(excessChips(plain, base, P1) + 3);
  });
  it('清老頭 [7 萬 = 1 萬] も 7 萬のドラを数える [裏 9 萬 ×2 で 7 萬 3 枚 = +6 枚]', () => {
    const HAND = ['m7', 'm7', 'm7', 'm9', 'm9', 'm9', 'p1', 'p1', 'p1', 'p9', 'p9', 'p9', 's1'];
    const plain = buildBase(HAND, ['z7'], Array(6).fill('s9'));   // 裏 s9 → s1 対子 = 12
    plain.lizhi.add(P0);
    plain.shoupai.get(P0).zimo('s1');
    const base = plain.hule(P0, null, null);
    expect(base.damanguan).toBeGreaterThanOrEqual(1);
    const withM9 = buildBase(HAND, ['z7'], [...Array(6).fill('s9'), 'm9', 'm9']);
    withM9.lizhi.add(P0);
    withM9.shoupai.get(P0).zimo('s1');
    const r = withM9.hule(P0, null, null);
    const plainExcess = excessChips(plain, base, null);
    expect(plainExcess).toBeGreaterThan(0);
    expect(excessChips(withM9, r, null)).toBe(plainExcess + 6);
  });
});

