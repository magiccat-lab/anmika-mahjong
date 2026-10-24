// [2026-10-15 fx9 の答えの続き] 無演出 (B7 a) ・ NN金北のカットイン ・ 演出一覧の絵
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { OPENING_TABLE } from '../pochiFx';
import { pochiOpeningRows, pochiGlowRows, diceBallRows } from '../fxOdds';
import { NO_SET, kinpeiPairLabels, setCutinFor, setFlags } from '../setCutin';
import { CUTIN_TIER } from '../store';
import { FX_LABELS } from '../fxArtwork';

describe('無演出 (fx9 B7、先輩「無演出でもあたるように」) [2026-10-25 表の引きに直した]', () => {
  it('無演出は当たりの 6%、外れの 50% (仕様 ①)', () => {
    expect(OPENING_TABLE.none).toEqual([6, 50]);
  });
  it('演出一覧に無演出の行が出て、当たる事がある', () => {
    const row = pochiOpeningRows().find((r) => r.name.startsWith('無演出'))!;
    expect(row.none).toBe(true);
    expect(row.rate).toBeCloseTo(0.28, 9);
    expect(row.hit!).toBeCloseTo(6 / 56, 9);
    expect(pochiOpeningRows().reduce((a, r) => a + r.rate, 0)).toBeCloseTo(1, 6);
  });
});

describe('NN金北のカットイン (先輩「NN金北になったらカットインも入れてあげてほしい」)', () => {
  it('同じ季節の華 2 枚と金北で、その季節の字', () => {
    expect(setFlags(['f2', 'f2'], 1, 1).kin).toEqual(['f2']);
    expect(kinpeiPairLabels(NO_SET, setFlags(['f2', 'f2'], 1, 1))).toEqual(['夏夏金北']);
    expect(kinpeiPairLabels(NO_SET, setFlags(['f4', 'f1', 'f4'], 1, 1))).toEqual(['冬冬金北']);
    expect(kinpeiPairLabels(NO_SET, setFlags(['f1', 'f1', 'f3', 'f3'], 2, 1))).toEqual(['春春金北', '秋秋金北']);
  });
  it('金北が無い ・ 普通の北だけ ・ 華が 1 枚では出ない', () => {
    expect(kinpeiPairLabels(NO_SET, setFlags(['f2', 'f2'], 3, 0))).toEqual([]);
    expect(kinpeiPairLabels(NO_SET, setFlags(['f2'], 1, 1))).toEqual([]);
  });
  it('揃った時に 1 回だけ (前に揃っていた季節は出さない)', () => {
    const a = setFlags(['f2', 'f2'], 1, 1);
    expect(kinpeiPairLabels(a, a)).toEqual([]);
    expect(kinpeiPairLabels(a, setFlags(['f2', 'f2', 'f4', 'f4'], 1, 1))).toEqual(['冬冬金北']);
  });
  it('四華 ・ 四北の数え方は前のまま (金北は四北の数に入る)', () => {
    expect(setCutinFor(NO_SET, setFlags(['f1', 'f2', 'f3', 'f4'], 4, 1))).toBe('shikashipei');
  });
  it('帯の字は演出の字体のサブセットにある字だけ、尺は中', () => {
    expect(CUTIN_TIER.kinpei).toBe('mid');
    expect(FX_LABELS.kinpei).toBe('金北');
    const css = fs.readFileSync('src/app.css', 'utf-8');
    for (const ch of '春夏秋冬金') expect(css).toContain(`U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`);
  });
});

describe('演出一覧の絵 (先輩「ラフで画像とか入れてあげよう」)', () => {
  it('白ぽっちの表の行には本物の卓で撮った絵があり、サイコロの玉は玉の色', () => {
    for (const r of pochiOpeningRows()) expect(r.img, r.name).toBeTruthy();
    for (const r of [...pochiOpeningRows(), ...pochiGlowRows()]) {
      if (r.img) expect(fs.existsSync(`public/fx_odds/${r.img}.webp`), r.img).toBe(true);
    }
    expect(diceBallRows().map((r) => r.ball)).toEqual(['rainbow', 'gold', 'blue', 'white']);
  });
});
