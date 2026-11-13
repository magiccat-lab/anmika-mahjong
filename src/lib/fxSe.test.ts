import { describe, it, expect } from 'vitest';
import { huleFxLevel } from './store';
import { playDiscardSe, _resetDiscardSeForTest, DISCARD_SE_MIN_GAP_MS } from './fxSe';

describe('[2026-11-13 H1] 和了の重さ', () => {
  it('満貫未満 0 / 満貫 1 / 跳満以上 2 / 役満 2 / 結果なし 0', () => {
    expect(huleFxLevel(null)).toBe(0);
    expect(huleFxLevel({ fanshu: 3, fu: 30 })).toBe(0);
    expect(huleFxLevel({ fanshu: 4, fu: 30 })).toBe(1);
    expect(huleFxLevel({ fanshu: 5, fu: 30 })).toBe(1);
    expect(huleFxLevel({ fanshu: 6, fu: 30 })).toBe(2);
    expect(huleFxLevel({ fanshu: 13, fu: 30 })).toBe(2);
    expect(huleFxLevel({ fanshu: 0, fu: 30, damanguan: 1 })).toBe(2);
  });
});
describe('[2026-11-13 H2] 打牌音の間引き', () => {
  it('90ms 未満の連打は 1 音にまとめる', () => {
    _resetDiscardSeForTest();
    expect(playDiscardSe(1000)).toBe(true);
    expect(playDiscardSe(1000 + DISCARD_SE_MIN_GAP_MS - 1)).toBe(false);
    expect(playDiscardSe(1000 + DISCARD_SE_MIN_GAP_MS)).toBe(true);
  });
});
