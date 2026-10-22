// 分析の嵌八萬 (7萬 9萬 の嵌張): 7萬を 1萬にした手では形にならないが、門前ならシャンテンとテンパイに数える
// [10-23 先輩「間8mを含めた効率の精査」]
import { describe, expect, it } from 'vitest';
// @ts-ignore - majiang-core 型定義なし
import Majiang from '@kobalab/majiang-core';
import { isKanpamanTenpai, kanpamanValue, kanpamanXt, swapM7 } from '../../../tools/lib/chip_value.mts';
import { mcOption } from '../../../tools/lib/mc_eval.mts';

const sw = (h: string) => swapM7(Majiang.Shoupai.fromString(h));
const param = Majiang.Util.hule_param({ lizhi: 1 });

describe('嵌八萬', () => {
  it('門前の 7萬 9萬 は嵌張に数え、嵌八萬だけのテンパイを見分ける', () => {
    const h = sw('m79p345s22345s456');
    expect(Majiang.Util.xiangting(h)).toBe(1);
    expect(kanpamanXt(h)).toBe(0);
    expect(isKanpamanTenpai(h)).toBe(true);
    expect(kanpamanValue(h, param, undefined, [], () => 0)).toBeGreaterThan(0);
    // 普通のテンパイは嵌八萬に数えない
    expect(isKanpamanTenpai(sw('m77p345s22345s456'))).toBe(false);
  });

  it('鳴いていれば嵌八萬にしない (リーチできない)', () => {
    expect(kanpamanXt(sw('m79p345s22345,s456-'))).toBe(99);
  });

  it('モンテカルロで嵌八萬のテンパイはぽっちでアガる', () => {
    const kinds = ['p1', 'p2', 's1', 's9', 'z5'];
    const r = mcOption(sw('m79p345s22345s456'), {
      kinds, unseen: (t) => (t === 'z5' ? 4 : 3), draws: 10, param, river: new Set(), seed: 7, endRate: 0, pochiWild: true,
    }, 200, new Map());
    expect(r.win).toBeGreaterThan(0.5);
  });
});
