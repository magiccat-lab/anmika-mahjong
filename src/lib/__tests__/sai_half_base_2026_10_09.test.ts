// [2026-10-09 リョー「今ベース35サイになってる奴は全部ベース70の振る回数を2回にしてほしい」]
// 旧 35 枚 × 4 回 [鳴き四華 ・ 鳴き四華四北の 1 回目 ・ でかぽっち] は 70 枚 × 2 回振り。
// 面前の四華は 70 枚 × 4 回のまま。でかぽっちは dekapochi_real_wait / z5_lifecycle_audit が縛る
import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function buildRawGame(hand: string[], fulou: string[]): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) g.shoupai.set(p, buildShoupai(p === 0 ? hand : []));
  if (fulou.length) g.shoupai.get(0)._fulou = [...fulou];
  const dummy = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  const shanAny = g.shan as any;
  shanAny._pai = [];
  shanAny._baopai = ['z2'];
  return g;
}

const huaSai = (result: any) => (result?.saiKoroChances ?? []).filter((c: any) => String(c.awardKey).startsWith('四華'));

describe('ベース 35 のサイコロは 70 × 2 回 [2026-10-09]', () => {
  it('鳴き四華: 70 枚を 2 回振り', () => {
    // p234 s234 s678 z1 + 中ポン、z1 単騎をロン
    const g = buildRawGame(['p2', 'p3', 'p4', 's2', 's3', 's4', 's6', 's7', 's8', 'z1'], ['z777=']);
    g.huapai[0] = ['f1', 'f2', 'f3', 'f4'];
    const result = g.hule(0 as PlayerId, 'z1', 1 as PlayerId);
    expect(result).not.toBeNull();
    expect(huaSai(result)).toEqual([expect.objectContaining({ awardKey: '四華', baseChip: 70, rollCount: 2 })]);
  });

  it('面前の四華は 70 枚 × 4 回のまま', () => {
    const g = buildRawGame(['p2', 'p3', 'p4', 's2', 's3', 's4', 's6', 's7', 's8', 'z7', 'z7', 'z7', 'z1'], []);
    g.lizhi.add(0);
    g.huapai[0] = ['f1', 'f2', 'f3', 'f4'];
    const result = g.hule(0 as PlayerId, 'z1', 1 as PlayerId);
    expect(result).not.toBeNull();
    const [sai] = huaSai(result);
    expect(sai).toEqual(expect.objectContaining({ awardKey: '四華', baseChip: 70 }));
    expect(sai.rollCount ?? 4).toBe(4);
  });

  it('暗槓だけの四華は面前なので 70 枚 × 4 回 [10-10 通報「4花のサイコロ」、リーチ + p3333 暗槓]', () => {
    const g = buildRawGame(['p2', 'p3', 'p4', 's2', 's3', 's4', 's6', 's7', 's8', 'z1'], ['z7777']);
    g.lizhi.add(0);
    g.huapai[0] = ['f1', 'f2', 'f3', 'f4'];
    const result = g.hule(0 as PlayerId, 'z1', 1 as PlayerId);
    expect(result).not.toBeNull();
    const [sai] = huaSai(result);
    expect(sai).toEqual(expect.objectContaining({ awardKey: '四華', baseChip: 70 }));
    expect(sai.rollCount ?? 4).toBe(4);
  });

  it('鳴き四華四北: 1 回目は 70 × 2 回振り、2 回目は 70 × 4 回', () => {
    const g = buildRawGame(['p2', 'p3', 'p4', 's2', 's3', 's4', 's6', 's7', 's8', 'z1'], ['z777=']);
    g.huapai[0] = ['f1', 'f2', 'f3', 'f4'];
    g.nukidora[0] = 4;
    const result = g.hule(0 as PlayerId, 'z1', 1 as PlayerId);
    expect(result).not.toBeNull();
    const sai = huaSai(result);
    expect(sai.map((c: any) => [c.awardKey, c.baseChip, c.rollCount ?? 4])).toEqual([
      ['四華四北:1', 70, 2],
      ['四華四北:2', 70, 4],
    ]);
  });
});
