import { describe, expect, it } from 'vitest';
import { kanButtonLabel, kanKind, kanTileName } from '../kanLabel';

describe('カンボタンの文字 [2026-10-25 リョー「何をカンするか書いて」]', () => {
  it('暗槓は牌の名前つき、 赤・金の 5 は 5 と読む', () => {
    expect(kanButtonLabel('m1111')).toBe('暗カン 1萬');
    expect(kanButtonLabel('p5550')).toBe('暗カン 5筒');
    expect(kanButtonLabel('s5500')).toBe('暗カン 5索');
    expect(kanButtonLabel('z1111')).toBe('暗カン 東');
    expect(kanButtonLabel('z7777')).toBe('暗カン 中');
  });
  it('加槓と大明槓を分ける', () => {
    expect(kanKind('m555=0')).toBe('加カン');
    expect(kanButtonLabel('z222+2')).toBe('加カン 南');
    expect(kanButtonLabel('s9999-')).toBe('カン 9索');
  });
  it('候補が 2 つなら違う文字になる', () => {
    expect(kanButtonLabel('m3333')).not.toBe(kanButtonLabel('p3333'));
  });
  it('読めない表記は種類だけ', () => {
    expect(kanTileName('')).toBe('');
    expect(kanButtonLabel('x')).toBe('暗カン');
  });
});
