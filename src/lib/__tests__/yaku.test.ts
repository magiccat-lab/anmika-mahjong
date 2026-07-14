import { describe, it, expect } from 'vitest';
import { isKanpaman, doraIndicatorOf } from '../game3/yaku';
import { buildShoupai } from '../helpers';

describe('doraIndicatorOf [逆引き 神ぽっち用]', () => {
  it('数牌 [p/s] は n-1 を返す [循環、 1→9]', () => {
    // p2 がドラになる indicator は p1
    expect(doraIndicatorOf('p2')).toBe('p1');
    expect(doraIndicatorOf('p1')).toBe('p9'); // 循環
    expect(doraIndicatorOf('s9')).toBe('s8');
    expect(doraIndicatorOf('s5')).toBe('s4');
  });

  it('m7 ↔ m9 swap [ANMIKA 独自]', () => {
    expect(doraIndicatorOf('m7')).toBe('m9');
    expect(doraIndicatorOf('m9')).toBe('m7');
  });

  it('字牌 風 [z1-z4] は 1→4→3→2→1 循環', () => {
    // z1 がドラになる indicator は z4
    expect(doraIndicatorOf('z1')).toBe('z4');
    expect(doraIndicatorOf('z2')).toBe('z1');
    expect(doraIndicatorOf('z3')).toBe('z2');
    expect(doraIndicatorOf('z4')).toBe('z3');
  });

  it('字牌 三元 [z5-z7] は 5→7→6→5 循環', () => {
    expect(doraIndicatorOf('z5')).toBe('z7');
    expect(doraIndicatorOf('z6')).toBe('z5');
    expect(doraIndicatorOf('z7')).toBe('z6');
  });

  it('想定外 key [金 / 色付き / 華] は そのまま返す [防御的]', () => {
    expect(doraIndicatorOf('gp')).toBe('gp');
    expect(doraIndicatorOf('z5b')).toBe('z5b');
    expect(doraIndicatorOf('f1')).toBe('f1');
  });
});

describe('isKanpaman [間八萬厳密判定]', () => {
  it('shoupai 未定義で false', () => {
    expect(isKanpaman(null, 'z5')).toBe(false);
  });

  it('agariPai が z5 以外なら false', () => {
    const sp = buildShoupai(['m7', 'm9', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'p7', 'p7', 'p7', 's5', 's5']);
    expect(isKanpaman(sp, 'm7')).toBe(false);
    expect(isKanpaman(sp, null)).toBe(false);
  });

  it('m7 / m9 持ち で agariPai z5 でも m7/m9 のいずれか欠なら false', () => {
    // ガード check: m7 ナシ / m9 ナシ いずれでも false [先 step check]
    const sp = buildShoupai(['m9', 'p1', 'p2', 'p3', 's1', 's2', 's3', 's7', 's7', 's7', 's5', 's5']);
    sp.zimo('z5');
    expect(isKanpaman(sp, 'z5')).toBe(false);
  });

  it('副露ありなら false [面前限定]', () => {
    const sp = buildShoupai(['m7', 'm9', 'p1', 'p2', 'p3', 's1', 's2', 's3', 's5', 's5']);
    sp._fulou = ['p7p7p7+'];
    sp.zimo('z5');
    expect(isKanpaman(sp, 'z5')).toBe(false);
  });

  it('m7 ナシ で false', () => {
    const sp = buildShoupai(['m9', 'p1', 'p2', 'p3', 's1', 's2', 's3', 's7', 's7', 's7', 's5', 's5', 'p7']);
    sp.zimo('z5');
    expect(isKanpaman(sp, 'z5')).toBe(false);
  });
});

describe('isKanpaman claim boundary', () => {
  it('uses a green pochi ron tile as m8 without relying on a river entry', () => {
    const sp = buildShoupai(['m7', 'm9', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 's4', 's5', 's6', 's2', 's2']);

    expect(isKanpaman(sp, 'z5g-')).toBe(true);
  });

  it('replaces an already drawn z5 instead of adding the winning tile twice', () => {
    const sp = buildShoupai(['m7', 'm9', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 's4', 's5', 's6', 's2', 's2']);
    sp.zimo('z5');

    expect(isKanpaman(sp, 'z5')).toBe(true);
  });
});
