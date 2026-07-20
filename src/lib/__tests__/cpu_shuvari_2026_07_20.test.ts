// 2026-07-20 リョー指示「CPU のシュバ判断とか考えさせてね。ちゃんと高い手はシュバろう」
// シュバ = 半荘 1 回きりで当局の祝儀 ×2。見込み祝儀が基準を超えた時だけ切る。
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import {
  decideCpuShuvari,
  estimateShuvariChip,
  SHUVARI_THRESHOLD,
  SHUVARI_LATE_JUSHU,
} from '../store/cpuShuvari';
import type { PlayerId } from '../types';

const PLAIN = ['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 's7', 'z1'];

function buildG(hand: string[] = PLAIN): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) g.shoupai.set(p, buildShoupai(hand));
  const shanAny = g.shan as any;
  shanAny._pai = [];
  shanAny._baopai = ['z2', 'z2'];
  shanAny._fubaopai = [];
  return g;
}

describe('estimateShuvariChip: 見込み祝儀の枚数換算', () => {
  it('祝儀源ゼロの平手は 0 枚', () => {
    expect(estimateShuvariChip(buildG(), 0).score).toBe(0);
  });

  it('赤 5 は 1 枚 2 点', () => {
    const g = buildG(['p0', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 's7', 'z1']);
    expect(estimateShuvariChip(g, 0).score).toBe(2);
  });

  it('金 5 は 1 枚 4 点 [赤と二重計上しない]', () => {
    const g = buildG(['gp', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 's7', 'z1']);
    expect(estimateShuvariChip(g, 0).score).toBe(4);
  });

  it('虹 3 は 1 枚 7 点', () => {
    const g = buildG(['np3', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 's7', 'z1']);
    expect(estimateShuvariChip(g, 0).score).toBe(7);
  });

  it('抜き北は 1 枚 1 点', () => {
    const g = buildG();
    g.nukidora[0] = 2;
    g.nukidoraGold[0] = 1;
    expect(estimateShuvariChip(g, 0).score).toBe(3);
  });

  it('宣言牌に出す祝儀牌は見込みから外す', () => {
    const g = buildG(['np3', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 's7', 'z1']);
    expect(estimateShuvariChip(g, 0, 'np3').score).toBe(0);
  });
});

describe('decideCpuShuvari: 切るかどうか', () => {
  it('祝儀の薄い手ではシュバらない', () => {
    const d = decideCpuShuvari(buildG(), 0);
    expect(d.shuvari).toBe(false);
    expect(d.threshold).toBe(SHUVARI_THRESHOLD);
  });

  it('虹 + 金の高祝儀手ならシュバる', () => {
    const g = buildG(['np3', 'gp', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 's7', 'z1']);
    const d = decideCpuShuvari(g, 0);
    expect(d.score).toBe(11);
    expect(d.shuvari).toBe(true);
  });

  it('シュバ使用済なら何を持っていても切らない', () => {
    const g = buildG(['np3', 'gp', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 's7', 'z1']);
    g.shuvariUsed[0] = true;
    const d = decideCpuShuvari(g, 0);
    expect(d.shuvari).toBe(false);
    expect(d.reasons).toContain('シュバ使用済');
  });

  it('フィーバー tier で見込みが跳ね上がる', () => {
    // 赤 1 枚 [2 枚] 単体では基準未満だが、tier 4 なら 8 枚で到達する
    const g = buildG(['p0', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 's7', 'z1']);
    expect(decideCpuShuvari(g, 0).shuvari).toBe(false);
    const fever = decideCpuShuvari(g, 0, { feverTier: 4 });
    expect(fever.score).toBe(8);
    expect(fever.shuvari).toBe(true);
  });

  it('終盤は基準が下がって切りやすくなる', () => {
    const g = buildG(['gp', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 's7', 'z1']);
    // 金 1 枚 = 4 枚。序盤は基準 8 で見送り
    expect(decideCpuShuvari(g, 0).shuvari).toBe(false);
    g.state.jushu = SHUVARI_LATE_JUSHU;
    const late = decideCpuShuvari(g, 0);
    expect(late.threshold).toBe(SHUVARI_THRESHOLD - 4);
    expect(late.shuvari).toBe(true);
  });
});
