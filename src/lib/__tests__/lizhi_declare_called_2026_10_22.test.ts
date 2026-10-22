import { describe, expect, it } from 'vitest';
import { isLizhiDeclareEntry } from '../riverMarks';

// 2026-10-22 通報 20261022_2 [Z1IG rev 2819]: p2 のリーチ宣言牌 gp を p1 がポンし、河の牌が `p0__+` になった。
// 表示は endsWith('__') でしか宣言牌を見ておらず、横向きが消えていた。
describe('鳴かれたリーチ宣言牌も宣言牌と読む', () => {
  it('ポン ・ 明槓の方向印が付いても宣言牌', () => {
    expect(isLizhiDeclareEntry('p0__+')).toBe(true);
    expect(isLizhiDeclareEntry('s5__-')).toBe(true);
    expect(isLizhiDeclareEntry('m9__=')).toBe(true);
    expect(isLizhiDeclareEntry('p0__')).toBe(true);
  });

  it('ツモ切りの _ と鳴かれただけの牌は宣言牌ではない', () => {
    expect(isLizhiDeclareEntry('s2_')).toBe(false);
    expect(isLizhiDeclareEntry('p0+')).toBe(false);
    expect(isLizhiDeclareEntry('p0_+')).toBe(false);
    expect(isLizhiDeclareEntry('z5')).toBe(false);
  });
});
