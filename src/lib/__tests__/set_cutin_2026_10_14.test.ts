// [2026-10-14 リョー「四華とか四北がそろったらカットイン出るようにして」]
// 揃った瞬間だけ出る事、数え方が和了の判定 [game3] と同じ事
import { describe, expect, it } from 'vitest';
import { NO_SET, setCutinFor, setFlags } from '../setCutin';
import { CUTIN_TIER } from '../store';
import { FX_LABELS } from '../fxArtwork';

describe('setFlags: 四華 ・ 八華 ・ 四北の数え方', () => {
  it('春夏秋冬が 1 枚ずつで四華、3 種では揃わない', () => {
    expect(setFlags(['f1', 'f2', 'f3'], 0).hua).toBe(0);
    expect(setFlags(['f1', 'f2', 'f3', 'f4'], 0).hua).toBe(1);
    // 同じ季節 4 枚は四華ではない
    expect(setFlags(['f1', 'f1', 'f2', 'f2'], 0).hua).toBe(0);
  });
  it('華 8 枚で八華', () => {
    expect(setFlags(['f1', 'f1', 'f2', 'f2', 'f3', 'f3', 'f4', 'f4'], 0).hua).toBe(2);
  });
  it('抜いた北 [金北を足した数] が 4 枚で四北', () => {
    expect(setFlags([], 3).bei).toBe(false);
    expect(setFlags([], 4).bei).toBe(true);
    expect(setFlags(null, 4).bei).toBe(true);
  });
});

describe('setCutinFor: 新しく揃った時だけ出す', () => {
  const shika = setFlags(['f1', 'f2', 'f3', 'f4'], 0);
  const hachika = setFlags(['f1', 'f1', 'f2', 'f2', 'f3', 'f3', 'f4', 'f4'], 0);
  const shipei = setFlags([], 4);

  it('揃っていない ・ 前と同じ時は出ない', () => {
    expect(setCutinFor(NO_SET, NO_SET)).toBeNull();
    expect(setCutinFor(shika, shika)).toBeNull();
    expect(setCutinFor(shipei, shipei)).toBeNull();
  });
  it('四華 ・ 四北 ・ 八華', () => {
    expect(setCutinFor(NO_SET, shika)).toBe('shika');
    expect(setCutinFor(NO_SET, shipei)).toBe('shipei');
    expect(setCutinFor(shika, hachika)).toBe('hachika');
    expect(setCutinFor(NO_SET, hachika)).toBe('hachika');
  });
  it('片方が揃っている所にもう片方が揃うと組み合わせの名前', () => {
    expect(setCutinFor(shika, { hua: 1, bei: true })).toBe('shikashipei');
    expect(setCutinFor(shipei, { hua: 1, bei: true })).toBe('shikashipei');
    expect(setCutinFor({ hua: 1, bei: true }, { hua: 2, bei: true })).toBe('hachikashipei');
    expect(setCutinFor(hachika, { hua: 2, bei: true })).toBe('hachikashipei');
  });
  it('字と尺が決まっている [字は演出の字体のサブセットにある物だけ]', () => {
    for (const id of ['shika', 'shipei', 'hachika', 'shikashipei', 'hachikashipei'] as const) {
      expect(FX_LABELS[id]).toMatch(/^[四八華北]+$/);
      expect(CUTIN_TIER[id]).toBeTruthy();
    }
  });
});
