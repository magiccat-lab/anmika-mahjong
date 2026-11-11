// [2026-11-12 リョー「事故演出起きた後逆ツモで演出もっかいきてるしBGMが次の局でも治らない」]
// 6HJK 東2局1本場: 席 2 がフィーバー続行で逆ツモを 4 回 (72 ・ 100 ・ 100 ・ 128 枚)。暗転は最初の 1 回だけ、曲は次の局で止める
import { describe, expect, it } from 'vitest';
import { jikoPreAllowed, jikoRoundSeat, jikoSongOutOfRound } from '../jikoSp';

describe('事故は起きるものさ は 1 つの局 ・ 席で 1 回', () => {
  it('同じ局 ・ 席で暗転した後の逆ツモは、枚数が違っても試し打ちを通さない', () => {
    const seen = new Set<string>();
    const round = '0-1-1';
    const fire: number[] = [];
    for (const loss of [72, 100, 100, 128]) {
      if (!jikoPreAllowed(round, 2, seen, false)) continue;
      const key = `${round}-2-${loss}`;
      if (seen.has(key) || seen.has(jikoRoundSeat(key))) continue;
      seen.add(key); seen.add(jikoRoundSeat(key));
      fire.push(loss);
    }
    expect(fire).toEqual([72]);
  });
  it('暗転中 (今のツモの分) は通す、別の席 ・ 次の局は出る', () => {
    const seen = new Set(['rp:0-1-1-2']);
    expect(jikoPreAllowed('0-1-1', 2, seen, true)).toBe(true);
    expect(jikoPreAllowed('0-1-1', 0, seen, false)).toBe(true);
    expect(jikoPreAllowed('0-2-0', 2, seen, false)).toBe(true);
  });
  it('曲は鳴らし始めた局の間だけ。次の局 ・ 次の試合の頭で止める', () => {
    expect(jikoSongOutOfRound(null, '0-2-0', 40)).toBe(false);
    expect(jikoSongOutOfRound('0-1-1', '0-1-1', 40)).toBe(false);
    expect(jikoSongOutOfRound('0-1-1', '0-2-0', 40)).toBe(true);
    expect(jikoSongOutOfRound('0-0-0', '0-0-0', 1)).toBe(true);
  });
});
