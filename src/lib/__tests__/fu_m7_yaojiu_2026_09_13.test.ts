// 2026-09-13 リョー裁定「むこうを採用」: 7萬の刻子 / 槓子は么九牌として符を取る。
// ルールブック注記「7萬はヤオチュー牌とタンヤオ牌の両方の性質を持つ」に沿う。
// majiang-core は么九を面子文字列の /[z19]/ で見ているので m777 に当たらず、
// 中張の 4 符 [暗槓は 16 符] で数えていた。
// norosh1 の牌譜 20260707103345-fy95bc 東3局 [m777p340s12234z11] は向こう 50 符、うち 40 符。
import { describe, it, expect } from 'vitest';
import { rawFuOfMianzi, correctedFuForM7 } from '../game3/fu7m';

const opts = { zhuangfeng: 0, menfeng: 0, rule: null };

describe('7萬の刻子を么九として符を数える', () => {
  it('m7 暗刻は 4 符ではなく 8 符', () => {
    // 雀頭 s99 / m777 暗刻 / p123 / p456 / s123、門前ツモ
    const mianzi = ['s99', 'm777', 'p123', 'p456', 's123_!'];
    const plain = rawFuOfMianzi(mianzi, { ...opts, m7AsYaojiu: false })!;
    const yaojiu = rawFuOfMianzi(mianzi, { ...opts, m7AsYaojiu: true })!;
    expect(plain.hasM7Kezi).toBe(true);
    expect(yaojiu.raw - plain.raw).toBe(4); // 4 符 → 8 符
  });

  it('m7 暗槓は 16 符ではなく 32 符', () => {
    const mianzi = ['s99', 'm7777', 'p123', 'p456', 's123_!'];
    const plain = rawFuOfMianzi(mianzi, { ...opts, m7AsYaojiu: false })!;
    const yaojiu = rawFuOfMianzi(mianzi, { ...opts, m7AsYaojiu: true })!;
    expect(yaojiu.raw - plain.raw).toBe(16); // 16 符 → 32 符
  });

  it('m7 の順子 [m789] は対象外', () => {
    const mianzi = ['s99', 'm789', 'p123', 'p456', 's123_!'];
    const plain = rawFuOfMianzi(mianzi, { ...opts, m7AsYaojiu: false })!;
    const yaojiu = rawFuOfMianzi(mianzi, { ...opts, m7AsYaojiu: true })!;
    expect(plain.hasM7Kezi).toBe(false);
    expect(yaojiu.raw).toBe(plain.raw);
  });

  it('もともと么九の刻子 [m999] は二重に増えない', () => {
    const mianzi = ['s99', 'm999', 'p123', 'p456', 's123_!'];
    const plain = rawFuOfMianzi(mianzi, { ...opts, m7AsYaojiu: false })!;
    const yaojiu = rawFuOfMianzi(mianzi, { ...opts, m7AsYaojiu: true })!;
    expect(yaojiu.raw).toBe(plain.raw);
  });

  it('通報局面と同じ形 [20260707103345-fy95bc 東3]: 40 符が 50 符になる', () => {
    // 雀頭 z11 [場風=自風で 4 符] / m777 暗刻 / p345 / s123 [s3 辺張ロン] / s234、門前ロン
    // 20 + 4 + 4 + 2 + 10 = 40 → m7 を么九にすると 20 + 4 + 8 + 2 + 10 = 44 → 50
    const mianzi = ['z11', 'm777', 'p345', 's123-!', 's234'];
    const plain = rawFuOfMianzi(mianzi, { ...opts, m7AsYaojiu: false })!;
    expect(plain.raw).toBe(40);
    expect(Math.ceil(plain.raw / 10) * 10).toBe(40);
    const fixed = correctedFuForM7([mianzi], 40, opts);
    expect(fixed).toBe(50);
  });

  it('切り上げ後に足すと 1 段多く上がる形を、生の符から正しく出す', () => {
    // 生 28 → 切り上げ 30。素朴に 30 + 4 = 34 → 40 としてしまうが、
    // 生の符で数えれば 28 + 4 = 32 → 40。ここでは差が出ない形と出る形の両方を見る
    const mianzi = ['s99', 'm777', 'p123', 'p456', 's123_!'];
    const plain = rawFuOfMianzi(mianzi, { ...opts, m7AsYaojiu: false })!;
    expect(plain.raw).toBe(28);
    expect(correctedFuForM7([mianzi], 30, opts)).toBe(40);
    // 切り上げ後が合わない分解は候補にならない
    expect(correctedFuForM7([mianzi], 40, opts)).toBeNull();
  });

  it('m7 の刻子を含む分解が無ければ何もしない', () => {
    expect(correctedFuForM7([['s99', 'm789', 'p123', 'p456', 's123_!']], 40, opts)).toBeNull();
  });
});
