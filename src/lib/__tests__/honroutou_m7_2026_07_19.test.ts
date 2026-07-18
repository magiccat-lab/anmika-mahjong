import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 2026-07-19 リョー報告: 実対局 paifu で 中中中ポン + p999ポン + s999ポン + m7暗刻(ツモ) +
// 白ぽっち雀頭 の手に 混老頭(混老対) が付かず 対々和+中 のみで精算された。
// 原因は 2 段:
//   1. m7→m1 置換再判定の pickup リスト [upgradeNames] に 混老頭 が無かった
//   2. m7 ツモ和了だと置換 clone の _zimo が m7 のままで、 majiang-core の
//      hule_mianzi が和了牌 marker を付けられず置換判定ごと不成立だった
function freshGame(): Game3 {
  const g = new Game3();
  g.qipai();
  g.diyizimo = false;
  g.state.qijia = 0;
  g.state.jushu = 0;
  g.state.benbang = 0;
  g.state.lizhibang = 0;
  g.huapai = { 0: [], 1: [], 2: [] };
  (g.shan as any)._baopai = ['z1'];
  (g.shan as any)._fubaopai = [];
  return g;
}

function yakuNames(result: any): string[] {
  return (result?.hupai ?? []).map((h: any) => String(h.name));
}

describe('混老頭 [m7=1m 扱い] の適用漏れ 2026-07-19', () => {
  it('m7 ツモ和了 [対々和形] で 混老対 が付く [paifu 再現]', () => {
    const g = freshGame();
    const player = 0 as PlayerId;
    const sp = buildShoupai(['m7', 'm7', 'z5y', 'z5r']);
    sp._fulou = ['z777-', 'p999-', 's999-'];
    sp.zimo('m7');
    g.shoupai.set(player, sp);

    const result = g.hule(player);
    expect(result).not.toBeNull();
    const names = yakuNames(result);
    expect(names.some((n) => n.includes('混老対'))).toBe(true);
    expect(names.some((n) => n.includes('対々和'))).toBe(true);
    expect(names).not.toContain('混老頭');
    // 中1 + 対々和2 + 混老対6 = 9翻
    expect(result.fanshu).toBeGreaterThanOrEqual(9);
  });

  it('m7 ロン和了でも 混老対 が付く', () => {
    const g = freshGame();
    const player = 0 as PlayerId;
    const sp = buildShoupai(['m7', 'm7', 'z5y', 'z5r']);
    sp._fulou = ['z777-', 'p999-', 's999-'];
    g.shoupai.set(player, sp);

    const result = g.hule(player, 'm7', 1 as PlayerId);
    expect(result).not.toBeNull();
    const names = yakuNames(result);
    expect(names.some((n) => n.includes('混老対'))).toBe(true);
    expect(result.fanshu).toBeGreaterThanOrEqual(9);
  });

  it('m7 が絡まない通常の混老頭は従来どおり成立し続ける', () => {
    const g = freshGame();
    const player = 0 as PlayerId;
    const sp = buildShoupai(['p1', 'p1', 'z2', 'z2']);
    sp._fulou = ['z777-', 'p999-', 's999-'];
    sp.zimo('p1');
    g.shoupai.set(player, sp);

    const result = g.hule(player);
    expect(result).not.toBeNull();
    const names = yakuNames(result);
    expect(names.some((n) => n.includes('混老対'))).toBe(true);
  });

  it('m7 ツモの純チャン系 [既存置換 path] も _zimo swap 追加で壊れていない', () => {
    const g = freshGame();
    const player = 0 as PlayerId;
    // p123 + s123 + p789 + m7暗刻(ツモ完成) + s99 雀頭 → 全帯幺系が付く形
    const sp = buildShoupai(['m7', 'm7', 'p1', 'p2', 'p3', 'p7', 'p8', 'p9', 's1', 's2', 's3', 's9', 's9']);
    sp.zimo('m7');
    g.shoupai.set(player, sp);
    g.lizhi.add(player);

    const result = g.hule(player);
    expect(result).not.toBeNull();
    const names = yakuNames(result);
    // postprocess が 純全帯幺九 → 純チャンタ [6翻] に rename する
    expect(names.some((n) => n.includes('チャンタ') || n.includes('全帯幺'))).toBe(true);
  });
});
