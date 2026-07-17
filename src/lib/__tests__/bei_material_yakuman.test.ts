import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

describe('北の手牌使用制限', () => {
  it('北を雀頭に使う非役満ツモはリーチ後でも不可', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    const player = 0 as PlayerId;
    const sp = buildShoupai(['p1','p2','p3','p4','p5','p6','s1','s2','s3','s7','s8','s9','z4']);
    sp.zimo('z4');
    g.shoupai.set(player, sp);
    g.lizhi.add(player);

    expect(g.canTsumo(player)).toBe(false);
    expect(g.hule(player)).toBeNull();
  });

  it('北を刻子に使う非役満ツモはリーチ後でも不可', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    const player = 0 as PlayerId;
    const sp = buildShoupai(['p1','p2','p3','p4','p5','p6','s1','s2','s3','z4','z4','z4','z5']);
    sp.zimo('z5');
    g.shoupai.set(player, sp);
    g.lizhi.add(player);

    expect(g.canTsumo(player)).toBe(false);
    expect(g.hule(player)).toBeNull();
  });

  it('北を雀頭に使う非役満ロンはリーチ後でも不可', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    const player = 0 as PlayerId;
    const fromPlayer = 1 as PlayerId;
    g.shoupai.set(player, buildShoupai(['p1','p2','p3','p4','p5','p6','s1','s2','s3','s7','s8','z4','z4']));
    g.lizhi.add(player);

    expect(g.canRon(player, 's9', fromPlayer)).toBe(false);
    expect(g.hule(player, 's9', fromPlayer)).toBeNull();
  });

  it('北を含む役満は許可', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    const player = 0 as PlayerId;
    const sp = buildShoupai(['z1','z1','z1','z2','z2','z2','z3','z3','z3','z4','z4','z5','z5']);
    sp.zimo('z5');
    g.shoupai.set(player, sp);
    g.lizhi.add(player);

    expect(g.canTsumo(player)).toBe(true);
    const result = g.hule(player);
    expect(result).toBeTruthy();
    expect(result.damanguan).toBeGreaterThan(0);
  });
});
