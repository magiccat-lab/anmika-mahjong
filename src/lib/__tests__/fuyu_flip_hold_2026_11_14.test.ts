// [2026-11-14 isg. 通報 SB9Z rev 1771]「冬冬金北を上がるとサイコロを振らない」
// CPU の冬冬金北の和了は、画面の冬めくり (22 枚で約 22 秒) を見終わるまでサイコロを出さないのに、
// サーバーは 1.5 秒で出目宣言を始め、めくりの間にサイコロから次局まで済んでいた。
import { describe, expect, it } from 'vitest';
import { FUYU_FLIP_BAND_MS, fuyuFlipHoldMs } from '../../../server/ws_server';

function state(opts: { fuyu: number; log: Array<{ tier: string }>; ron?: boolean; finished?: boolean }): any {
  const result = { fuyuLog: opts.log };
  const hua = Array.from({ length: opts.fuyu }, () => 'f4');
  return {
    lastHuleResult: result,
    lastWinner: 1,
    ronResults: opts.ron ? [{ player: 1, result }] : [],
    game: { state: { finished: !!opts.finished }, effectiveHuapaiAtHule: () => hua },
  };
}

const lower22 = Array.from({ length: 22 }, (_, i) => ({ tier: i % 2 ? 'lower' : 'upper' }));

describe('CPU の冬冬金北はめくりの尺だけ最初のサイコロを待つ [2026-11-14]', () => {
  it('SB9Z と同じ 22 枚: 帯 + 0.9 秒 + 22 × 0.65 秒 + 閉じる 3.25 秒', () => {
    expect(fuyuFlipHoldMs(state({ fuyu: 2, log: lower22 }))).toBe(FUYU_FLIP_BAND_MS + 900 + 22 * 650 + 3_250);
    expect(fuyuFlipHoldMs(state({ fuyu: 2, log: lower22, ron: true }))).toBeGreaterThan(20_000);
  });

  it('めくりが出ない和了は待たない (冬 1 枚 ・ 下段なし ・ 冬の記録なし ・ 半荘終わり)', () => {
    expect(fuyuFlipHoldMs(state({ fuyu: 1, log: lower22 }))).toBe(0);
    expect(fuyuFlipHoldMs(state({ fuyu: 2, log: [{ tier: 'upper' }] }))).toBe(0);
    expect(fuyuFlipHoldMs(state({ fuyu: 2, log: [] }))).toBe(0);
    expect(fuyuFlipHoldMs(state({ fuyu: 2, log: lower22, finished: true }))).toBe(0);
    expect(fuyuFlipHoldMs({ lastHuleResult: null })).toBe(0);
  });
});
