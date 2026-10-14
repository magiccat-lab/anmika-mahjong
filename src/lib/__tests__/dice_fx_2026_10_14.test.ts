// [2026-10-14] サイコロの演出の決まり (diceFx)。出目 ・ 当たりには触らず、見せ方だけを決める
import { describe, it, expect } from 'vitest';
import { ballColor, planRoll, rollSeed, ZORO_WORD } from '../diceFx';

describe('diceFx', () => {
  it('虹の玉は当たりの時だけ', () => {
    for (let i = 0; i < 1000; i++) {
      const r = i / 1000;
      expect(ballColor('miss', r)).not.toBe('rainbow');
      expect(ballColor('zoro', r)).not.toBe('rainbow');
    }
    expect(ballColor('hit', 0.1)).toBe('rainbow');
  });

  it('外れは白が多く、当たりは金か虹が多い', () => {
    const count = (o: 'hit' | 'miss', c: string) => Array.from({ length: 1000 }, (_, i) => ballColor(o, i / 1000)).filter((x) => x === c).length;
    expect(count('miss', 'white')).toBeGreaterThan(600);
    expect(count('hit', 'rainbow') + count('hit', 'gold')).toBeGreaterThan(600);
  });

  it('色は同じ入力なら同じ (全員の画面で同じ色)', () => {
    expect(rollSeed([1, 0, 2, 3, 5])).toBe(rollSeed([1, 0, 2, 3, 5]));
    expect(rollSeed([1, 0, 2, 3, 5])).not.toBe(rollSeed([1, 0, 3, 3, 5]));
    for (let i = 0; i < 200; i++) {
      const v = rollSeed([i, i * 3, 7]);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('宣言の目が出た方を先に止めてリーチ', () => {
    const combo: [number, number] = [3, 5];
    expect(planRoll(combo, { dice: [3, 5], hit: true, zoro: false }, [1])).toMatchObject({ first: 0, reach: true, outcome: 'hit' });
    expect(planRoll(combo, { dice: [2, 5], hit: false, zoro: false }, [1])).toMatchObject({ first: 1, reach: true, outcome: 'miss' });
    expect(planRoll(combo, { dice: [2, 6], hit: false, zoro: false }, [1])).toMatchObject({ first: 0, reach: false, outcome: 'miss' });
    expect(planRoll(combo, { dice: [3, 3], hit: false, zoro: true }, [1])).toMatchObject({ reach: true, outcome: 'zoro' });
    expect(planRoll(combo, { dice: [4, 4], hit: false, zoro: true }, [1])).toMatchObject({ reach: false, outcome: 'zoro' });
  });

  it('ゾロ目の字は「ゾロ目 / リプレイ」', () => {
    expect(ZORO_WORD).toBe('ゾロ目 / リプレイ');
  });
});
