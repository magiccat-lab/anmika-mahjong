import { describe, it, expect } from 'vitest';
// @ts-ignore
import Majiang from '@kobalab/majiang-core';
import { Game3, buildShoupai, normalizeBaopaiForMajiang } from '../game3';
import { anmikaHuleRule, normalizeBaopaiForSwappedM7, swapM7, winDetail, CPU_SW_KINDS, type ChipEnv } from '../game3/cpuValue';
import type { PlayerId } from '../types';

const env: ChipEnv = { nuki: 0, fuyu: 0, hua: 0, fulou: false, shuba: false, nInd: 1 };
const unseen = () => 1;
function param(ind: string[], norm: (p: string) => string) {
  return Majiang.Util.hule_param({
    rule: anmikaHuleRule(), zhuangfeng: 0, menfeng: 1, lizhi: 1,
    baopai: ind.map(norm), fubaopai: null, changbang: 0, lizhibang: 0,
  });
}
const M7_HAND = ['p1','p2','p3','p4','p5','p6','s7','s8','s9','m7','m7','m7','z1'];
const M9_HAND = ['p1','p2','p3','p4','p5','p6','s7','s8','s9','m9','m9','m9','z1'];

describe('review 11-02 #9: CPU テンパイ価値 (swapM7 した手) で 9萬表示のドラ 7萬 を数える', () => {
  it('real hule (unswapped) counts m7 x3 as dora with m9 indicator', () => {
    const sp = buildShoupai(M7_HAND);
    const r0 = Majiang.Util.hule(sp.clone(), 'z1-', param([], normalizeBaopaiForMajiang));
    const r1 = Majiang.Util.hule(sp.clone(), 'z1-', param(['m9'], normalizeBaopaiForMajiang));
    expect(r1.fanshu - r0.fanshu).toBe(3);
  });

  it('swapped-hand normalization maps indicators to the swapped positions', () => {
    expect(normalizeBaopaiForSwappedM7('m9')).toBe('m9'); // dora m1 (= swapped m7)
    expect(normalizeBaopaiForSwappedM7('m7')).toBe('m8'); // dora m9
    expect(normalizeBaopaiForSwappedM7('p3')).toBe('p3');
  });

  it('cpu value (swapped) counts both m7 dora (m9 ind) and m9 dora (m7 ind)', () => {
    const sw = swapM7(buildShoupai(M7_HAND).clone());
    const a = winDetail(sw, 'z1', false, param([], normalizeBaopaiForSwappedM7), env, CPU_SW_KINDS, unseen, 0);
    const b = winDetail(sw, 'z1', false, param(['m9'], normalizeBaopaiForSwappedM7), env, CPU_SW_KINDS, unseen, 0);
    const sw2 = swapM7(buildShoupai(M9_HAND).clone());
    const c = winDetail(sw2, 'z1', false, param([], normalizeBaopaiForSwappedM7), env, CPU_SW_KINDS, unseen, 0);
    const d = winDetail(sw2, 'z1', false, param(['m7'], normalizeBaopaiForSwappedM7), env, CPU_SW_KINDS, unseen, 0);
    expect(d.value).toBeGreaterThan(c.value);
    expect(b.value).toBeGreaterThan(a.value);
  });

  it('Game3 tenpaiDiscardValue_ sees the m7 dora under a 9萬 indicator', () => {
    const g = new Game3();
    g.qipai();
    const me = g.lunbanToPlayerId(g.state.lunban) as PlayerId;
    const sp = buildShoupai(M7_HAND);
    sp.zimo('s1');
    const shan = g.shan as any;
    const valueWith = (ind: string): number => {
      shan._baopai.length = 0;
      shan._baopai.push(ind);
      return (g as any).tenpaiDiscardValue_(me, sp, 's1', () => 0, (p: string) => p);
    };
    const oneDora = valueWith('p9'); // dora p1 x1
    const m7Dora = valueWith('m9'); // dora m7 x3
    expect(m7Dora).toBeGreaterThan(oneDora);
  });
});
