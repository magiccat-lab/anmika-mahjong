// [2026-11-18 isg. 通報「秋がリンシャンじゃない方からめくられていそう」→ リョー「秋のめくる向きを逆にしないと山の枚数減るから」]
// 秋の追加ドラは王牌の嶺上側 [嶺上の末尾、嶺上の番とは反対の端] から開き、ツモ山の枚数を減らさない。
// 嶺上が尽きていたらツモ山の王牌側から開く。カンドラは本家どおりツモ山の奥のまま。
import { describe, expect, it } from 'vitest';

import { Shan3, defaultSanmaRule, generateTilePool } from '../shan3';

function pool(): string[] {
  const tiles = generateTilePool(defaultSanmaRule());
  let seed = 11;
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

describe('秋の追加ドラは嶺上側から', () => {
  it('表 ・ 裏とも嶺上の末尾から開き、ツモ山の枚数と嶺上の番は変わらない', () => {
    const shan: any = new Shan3(defaultSanmaRule(), pool());
    const paishu = shan.paishu;
    const rinshan = [...shan._rinshan];
    const liveFront = shan._pai[0];

    const upper = shan.drawAkiDora(false);
    const lower = shan.drawAkiDora(true);

    expect(upper).toBe(rinshan[rinshan.length - 1]);
    expect(lower).toBe(rinshan[rinshan.length - 2]);
    expect(shan.baopai.at(-1)).toBe(upper);
    expect(shan.fubaopai.at(-1)).toBe(lower);
    expect(shan.paishu).toBe(paishu);
    expect(shan._pai[0]).toBe(liveFront);
    expect(shan.rinshanUsed).toBe(2);
    expect(shan.rinshanRemaining).toBe(14);
    // 次の嶺上ツモ [カン / 北抜き] は元の先頭のまま
    expect(shan._rinshan[0]).toBe(rinshan[0]);
  });

  it('嶺上が尽きていたらツモ山の王牌側から開く', () => {
    const shan: any = new Shan3(defaultSanmaRule(), pool());
    shan._rinshan = [];
    shan.rinshanUsed = 16;
    const paishu = shan.paishu;
    const liveFront = shan._pai[0];
    expect(shan.drawAkiDora(false)).toBe(liveFront);
    expect(shan.paishu).toBe(paishu - 1);
    expect(shan.rinshanUsed).toBe(16);
  });

  it('秋の残りは嶺上とツモ山の合計で数える', () => {
    const shan: any = new Shan3(defaultSanmaRule(), pool());
    expect(shan.akiDoraAvailable).toBe(shan.rinshanRemaining + shan.paishu);
    shan._pai = [];
    expect(shan.paishu).toBe(0);
    expect(shan.akiDoraAvailable).toBe(16);
  });

  it('カンドラは今までどおりツモ山の王牌側から開く', () => {
    const shan: any = new Shan3(defaultSanmaRule(), pool());
    const liveFront = shan._pai[0];
    const rinshanLen = shan._rinshan.length;
    shan.gangzimo();
    shan.kaigang();
    expect(shan.baopai[2]).toBe(liveFront);
    expect(shan._rinshan.length).toBe(rinshanLen - 1 - (shan.lastDrawnHuapai?.length ?? 0));
  });
});
