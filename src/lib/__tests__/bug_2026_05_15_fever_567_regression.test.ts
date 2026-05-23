import { describe, it, expect } from 'vitest';
import { canFeverLizhi } from '../game3/feverLizhi';

// 2026-05-15 リョー指摘:
// canFeverLizhi が 7×3 のみ check で 「5-6-7 順子の余地」 を見ておらず
// 567 が取れる手でも fever 打ててしまう bug。
// 修正: 同 suit に 5 [赤 0 含む] か 6 が 1 枚でもあれば fever 不可。
// ankan の 7 は 確定暗刻 なので 例外。

function mkSp(bingpai: Record<string, number[]>, fulou: string[] = []): any {
  return { _bingpai: bingpai, _fulou: fulou };
}

describe('canFeverLizhi - 567 解釈余地 regression', () => {
  it('ケース 1: p7×3 + p5 + p6 [567 順子取れる手] → fever 不可', () => {
    const r = canFeverLizhi(
      mkSp({
        m: [0],
        // p[0]=赤5, p[5]=5, p[6]=6, p[7]=7
        p: [0, 0, 0, 0, 0, 1, 1, 3],
        s: [0],
      }),
    );
    expect(r.ok).toBe(false);
  });

  it('ケース 1b: p7×3 + p5 のみ [6 ナシ でも 567 取れる可能性ある] → fever 不可', () => {
    const r = canFeverLizhi(
      mkSp({
        m: [0],
        p: [0, 0, 0, 0, 0, 1, 0, 3],
        s: [0],
      }),
    );
    expect(r.ok).toBe(false);
  });

  it('ケース 1c: p7×3 + p6 のみ → fever 不可', () => {
    const r = canFeverLizhi(
      mkSp({
        m: [0],
        p: [0, 0, 0, 0, 0, 0, 1, 3],
        s: [0],
      }),
    );
    expect(r.ok).toBe(false);
  });

  it('ケース 1d: p7×3 + 赤 p0 [5 扱い] → fever 不可', () => {
    const r = canFeverLizhi(
      mkSp({
        m: [0],
        p: [1, 0, 0, 0, 0, 0, 0, 3],
        s: [0],
      }),
    );
    expect(r.ok).toBe(false);
  });

  it('ケース 2: p7×3 + p8 + p9 [78-9 順子 余り、 7 暗刻 確定] → fever OK', () => {
    const r = canFeverLizhi(
      mkSp({
        m: [0],
        p: [0, 0, 0, 0, 0, 0, 0, 3, 1, 1],
        s: [0],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.tiles).toEqual(['p7']);
  });

  it('ケース 3: p7 ankan [副露 p7777] → fever OK [副露あっても ankan は通す]', () => {
    const r = canFeverLizhi(
      mkSp(
        {
          m: [0],
          p: [0],
          s: [0],
        },
        ['p7777'],
      ),
    );
    expect(r.ok).toBe(true);
    expect(r.tiles).toEqual(['p7']);
  });

  it('ケース 3b: p7 ankan + 同 suit に p5 が手にあっても ankan は確定暗刻 → fever OK', () => {
    const r = canFeverLizhi(
      mkSp(
        {
          m: [0],
          p: [0, 0, 0, 0, 0, 1],
          s: [0],
        },
        ['p7777'],
      ),
    );
    expect(r.ok).toBe(true);
    expect(r.tiles).toEqual(['p7']);
  });

  it('ケース 4: p7×3 + 副露なし + 5/6/0 全くなし → fever OK', () => {
    const r = canFeverLizhi(
      mkSp({
        m: [0],
        p: [0, 1, 1, 1, 0, 0, 0, 3],
        s: [0],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.tiles).toEqual(['p7']);
  });

  it('ケース 5: 複数 suit、 m7×3 [5/6 ナシ] + p7×3 [p5 あり] → m7 のみ tier 1', () => {
    const r = canFeverLizhi(
      mkSp({
        m: [0, 0, 0, 0, 0, 0, 0, 3],
        p: [0, 0, 0, 0, 0, 1, 0, 3],
        s: [0],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.tiles).toEqual(['m7']);
    expect(r.tier).toBe(1);
  });

  it('ケース 6: s7 ankan + 同 suit に s6 [567 余地] でも ankan 確定 → s7 OK', () => {
    const r = canFeverLizhi(
      mkSp(
        {
          m: [0],
          p: [0],
          s: [0, 0, 0, 0, 0, 0, 1],
        },
        ['s7777'],
      ),
    );
    expect(r.ok).toBe(true);
    expect(r.tiles).toEqual(['s7']);
  });
});
