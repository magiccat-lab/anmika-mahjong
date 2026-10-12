// 2026-10-12 通報 (isg.、単人戦の最終局): 「三連刻の判定がおかしい 33344455567s」。
// アガリ形は s333 s444 s567 s55 + p567 (p7 ロン)。s5 は雀頭と順子に使っていて刻子ではないのに、
// 枚数が 3 枚あるだけで 三連刻 [s3-5] が付いていた。
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function buildRawGame(shoupai: Record<PlayerId, string[]>): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  g.state.benbang = 0;
  for (const p of [0, 1, 2] as PlayerId[]) g.shoupai.set(p, buildShoupai(shoupai[p] ?? []));
  const dummy = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  const shanAny = g.shan as any;
  shanAny._pai = [];
  shanAny._baopai = ['z2', 'z2'];
  g.lizhi.add(0); // アンミカは門前ロンにリーチが要る (通報の手もリーチ一発)
  return g;
}

const hasSanren = (result: any) =>
  result.hupai.some((h: any) => typeof h.name === 'string' && h.name.startsWith('三連刻'));

describe('三連刻は 3 つとも刻子として使える時だけ', () => {
  it('通報の形: s333 s444 s567 s55 + p567 → 三連刻にしない', () => {
    const sp0 = ['s3', 's3', 's3', 's4', 's4', 's4', 's5', 's5', 's5', 's6', 's7', 'p5', 'p6'];
    const result = buildRawGame({ 0: sp0, 1: [], 2: [] }).hule(0, 'p7', 1);
    expect(result).toBeTruthy();
    expect(hasSanren(result)).toBe(false);
  });

  it('通報の牌そのまま (金の p5 ・ s5、赤 s5、虹の s3) でも 三連刻にしない', () => {
    const sp0 = ['gp', 'gs', 'ns3', 'p6', 's0', 's3', 's3', 's4', 's4', 's4', 's5', 's6', 's7'];
    const result = buildRawGame({ 0: sp0, 1: [], 2: [] }).hule(0, 'p7', 1);
    expect(result).toBeTruthy();
    expect(hasSanren(result)).toBe(false);
  });

  it('刻子 3 つ + 順子 + 雀頭に取れる形は今まで通り 三連刻', () => {
    const sp0 = ['s3', 's3', 's3', 's4', 's4', 's4', 's5', 's5', 's5', 's6', 's7', 's8', 'p7'];
    const result = buildRawGame({ 0: sp0, 1: [], 2: [] }).hule(0, 'p7', 1);
    expect(result).toBeTruthy();
    expect(hasSanren(result)).toBe(true);
  });
});
