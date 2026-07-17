import { describe, it, expect } from 'vitest';
import {
  toCorePai,
  isGoldPai,
  normalizeBaopaiForMajiang,
  pochiColorFromPai,
  isPositiveZ5,
  isNegativeZ5,
  fanshuLevel,
  LEVEL_TO_FANSHU,
  isValidAnmikaTile,
  buildShoupai,
} from '../helpers';

describe('toCorePai', () => {
  it('z5* 4 色は z5 に潰す', () => {
    expect(toCorePai('z5b')).toBe('z5');
    expect(toCorePai('z5r')).toBe('z5');
    expect(toCorePai('z5g')).toBe('z5');
    expect(toCorePai('z5y')).toBe('z5');
  });
  it('金牌 key を 数牌 / 字牌に展開', () => {
    expect(toCorePai('gp')).toBe('p0');
    expect(toCorePai('gs')).toBe('s0');
    expect(toCorePai('gN')).toBe('z4');
  });
  it('通常牌は変えない', () => {
    expect(toCorePai('m7')).toBe('m7');
    expect(toCorePai('p3')).toBe('p3');
    expect(toCorePai('z1')).toBe('z1');
    expect(toCorePai('z5')).toBe('z5');
  });
});

describe('isGoldPai', () => {
  it('gp/gs/gN だけ true', () => {
    expect(isGoldPai('gp')).toBe(true);
    expect(isGoldPai('gs')).toBe(true);
    expect(isGoldPai('gN')).toBe(true);
    expect(isGoldPai('p0')).toBe(false);
    expect(isGoldPai('z4')).toBe(false);
    expect(isGoldPai('m1')).toBe(false);
  });
});

describe('normalizeBaopaiForMajiang [アンミカ独自ドラ]', () => {
  it('m7 表示牌 → m8 擬似 [m8 → m9 がアンミカ ドラ規則 m7→m9]', () => {
    expect(normalizeBaopaiForMajiang('m7')).toBe('m8');
  });
  it('m9 表示牌 → m6 擬似 [m6 → m7 がアンミカ ドラ規則 m9→m7]', () => {
    expect(normalizeBaopaiForMajiang('m9')).toBe('m6');
  });
  it('他の牌は normalizePai 通り', () => {
    expect(normalizeBaopaiForMajiang('z5b')).toBe('z5');
    expect(normalizeBaopaiForMajiang('p3')).toBe('p3');
    expect(normalizeBaopaiForMajiang('gp')).toBe('p0');
  });
});

describe('pochiColorFromPai', () => {
  it('z5* の色を抽出', () => {
    expect(pochiColorFromPai('z5b')).toBe('blue');
    expect(pochiColorFromPai('z5r')).toBe('red');
    expect(pochiColorFromPai('z5g')).toBe('green');
    expect(pochiColorFromPai('z5y')).toBe('yellow');
  });
  it('通常牌は null', () => {
    expect(pochiColorFromPai('z5')).toBeNull();
    expect(pochiColorFromPai('m7')).toBeNull();
    expect(pochiColorFromPai('gp')).toBeNull();
  });
});

describe('isPositiveZ5 / isNegativeZ5', () => {
  it('正ぽっち = 緑/青、 逆ぽっち = 赤/黄', () => {
    expect(isPositiveZ5('z5g')).toBe(true);
    expect(isPositiveZ5('z5b')).toBe(true);
    expect(isPositiveZ5('z5r')).toBe(false);
    expect(isPositiveZ5('z5y')).toBe(false);
    expect(isNegativeZ5('z5r')).toBe(true);
    expect(isNegativeZ5('z5y')).toBe(true);
    expect(isNegativeZ5('z5g')).toBe(false);
    expect(isNegativeZ5('z5b')).toBe(false);
  });
});

describe('fanshuLevel', () => {
  it('翻数 → Lv', () => {
    expect(fanshuLevel(1, 30)).toBe(1);
    expect(fanshuLevel(2, 30)).toBe(2);
    expect(fanshuLevel(3, 30)).toBe(3);
    expect(fanshuLevel(4, 30)).toBe(4);
    expect(fanshuLevel(5, 30)).toBe(4);
    expect(fanshuLevel(6, 30)).toBe(5);
    expect(fanshuLevel(7, 30)).toBe(5);
    expect(fanshuLevel(8, 30)).toBe(6);
    expect(fanshuLevel(10, 30)).toBe(6);
    expect(fanshuLevel(11, 30)).toBe(7);
    expect(fanshuLevel(12, 30)).toBe(7);
    expect(fanshuLevel(13, 30)).toBe(8);
    expect(fanshuLevel(17, 30)).toBe(8);
    expect(fanshuLevel(18, 30)).toBe(9);
    expect(fanshuLevel(23, 30)).toBe(9);
    expect(fanshuLevel(24, 30)).toBe(10);
  });
  it('切上満貫: fu * 2^(fanshu+2) === 1920 → Lv4 [4 翻 30 符 等]', () => {
    // 1 翻 240 符は実在しないが式上は: 240 * 2^3 = 1920
    expect(fanshuLevel(1, 240)).toBe(4);
  });
  it('0 翻は Lv0', () => {
    expect(fanshuLevel(0, 30)).toBe(0);
  });
});

describe('isValidAnmikaTile', () => {
  it('m は 7 / 9 のみ true、 他 n は false', () => {
    for (let n = 1; n <= 9; n++) {
      expect(isValidAnmikaTile('m', n)).toBe(n === 7 || n === 9);
    }
  });
  it('p/s/z は n に関わらず true [別 path で gate]', () => {
    for (const s of ['p', 's', 'z']) {
      for (let n = 1; n <= 9; n++) {
        expect(isValidAnmikaTile(s, n)).toBe(true);
      }
    }
  });
});

describe('buildShoupai', () => {
  it('色付き z5* / 金牌を normalize して Shoupai を作る', () => {
    const sp = buildShoupai(['z5b', 'z5r', 'gp', 'gs', 'gN', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'm7', 'm9']);
    expect(sp).toBeTruthy();
    expect(sp._bingpai).toBeDefined();
    // z5 が 2 枚 [b + r → z5 plain × 2]
    expect(sp._bingpai.z[5]).toBe(2);
    // gp → p0、 gs → s0、 gN → z4
    expect(sp._bingpai.p[0]).toBe(1);
    expect(sp._bingpai.s[0]).toBe(1);
    expect(sp._bingpai.z[4]).toBe(1);
  });

  it('通常牌をツモると前回の expanded zimo identity を残さない', () => {
    const sp = buildShoupai([
      'p1', 'p2', 'p3', 'p5', 'p6', 'p7',
      's1', 's2', 's3', 's4', 's5', 'm7', 'm9',
    ]);
    sp._anmikaZimo = 'np3';
    sp.zimo('p4');
    expect(sp._zimo).toBe('p4');
    expect(sp._anmikaZimo).toBeNull();
  });

  it('cloneでも副露の呼び牌と手出し物理牌を独立して保持する', () => {
    const sp = buildShoupai(['gp', 'np3', 'z5b', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'm7', 'm9', 'z1', 'z2']);
    sp._anmikaFulou = [{ mianzi: 'p000+', from: 1, taken: 'gp' }];
    sp._anmikaFulouPhysical = [{ mianzi: 'p000+', consumed: ['gp', 'p0'] }];

    const cloned = sp.clone();

    expect(cloned._anmikaFulou).toEqual(sp._anmikaFulou);
    expect(cloned._anmikaFulouPhysical).toEqual(sp._anmikaFulouPhysical);
    cloned._anmikaFulou[0].taken = 'p0';
    cloned._anmikaFulouPhysical[0].consumed[0] = 'p0';
    expect(sp._anmikaFulou[0].taken).toBe('gp');
    expect(sp._anmikaFulouPhysical[0].consumed[0]).toBe('gp');
  });
});

describe('LEVEL_TO_FANSHU', () => {
  it('Lv 配列の長さ 11 [0-10]', () => {
    expect(LEVEL_TO_FANSHU).toHaveLength(11);
  });
  it('Lv→翻 の代表値', () => {
    expect(LEVEL_TO_FANSHU[1]).toBe(1);
    expect(LEVEL_TO_FANSHU[4]).toBe(4);
    expect(LEVEL_TO_FANSHU[5]).toBe(6);
    expect(LEVEL_TO_FANSHU[8]).toBe(13);
    expect(LEVEL_TO_FANSHU[10]).toBe(24);
  });
});
