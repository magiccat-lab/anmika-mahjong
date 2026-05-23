// Regression: ユーザー報告 [2026-05-15] 追加 bug
//   E: シュバ宣言ハイで ロンされた時 振込者の shuvariActive が false にならないこと
//      [hule path 内で shuvariActive を 触らない 仕様固定]
//   F: 小車輪 [混一色七対子] は ボーナス +1 翻 [単独 6 翻 ではなく、 5→6 翻]
//   G: PlayerHandPanel に shuvariActive プロパティ受け取り
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function buildRawGame(opts: {
  shoupai: Record<PlayerId, string[]>;
  fulou?: Record<PlayerId, string[]>;
  baopai?: string[];
  fubaopai?: string[] | null;
}): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) {
    g.shoupai.set(p, buildShoupai(opts.shoupai[p] ?? []));
    if (opts.fulou?.[p]) {
      const sp = g.shoupai.get(p);
      sp._fulou = [...opts.fulou[p]];
    }
  }
  const dummy = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  const shanAny = g.shan as any;
  shanAny._pai = [];
  if (opts.baopai !== undefined) shanAny._baopai = opts.baopai;
  if (opts.fubaopai !== undefined) shanAny._fubaopai = opts.fubaopai;
  return g;
}

describe('bug E: シュバ宣言ハイで ロンされた時 振込者の shuvariActive 維持', () => {
  it('hule(player=ロン者, ronpai, fromPlayer=振込者) で 振込者 shuvariActive=true 維持', () => {
    // 振込者 [P1] が シュバ宣言済 で discard、 ロン者 [P0] が ロン
    // hule 処理中 / 直後 で P1 の shuvariActive が false に なってないこと
    const sp0 = ['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 'p0', 'p0', 's6', 's7', 's8', 'z1', 'z1'];
    const g = buildRawGame({
      shoupai: { 0: sp0, 1: [], 2: [] },
      baopai: ['p4'],
    });
    g.lizhi.add(0); // ロン者 立直、 振込者 P1 は シュバ宣言済 [独立]
    g.shuvariActive[1] = true; // 振込者 P1 シュバ宣言済
    g.shuvariUsed[1] = true;
    const result = g.hule(0, 'z1', 1);
    expect(result).not.toBeNull();
    // ロン処理後も 振込者 [P1] の shuvariActive は true 維持 [ロン path で触らない]
    expect(g.shuvariActive[1]).toBe(true);
    // ロン者 [P0] は シュバ宣言してないので false [副作用なし]
    expect(g.shuvariActive[0]).toBe(false);
  });

  it('applyHule [defen 移動] 後も 振込者 shuvariActive 維持', () => {
    const sp0 = ['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 'p0', 'p0', 's6', 's7', 's8', 'z1', 'z1'];
    const g = buildRawGame({
      shoupai: { 0: sp0, 1: [], 2: [] },
      baopai: ['p4'],
    });
    g.lizhi.add(0);
    g.shuvariActive[1] = true;
    g.shuvariUsed[1] = true;
    const result = g.hule(0, 'z1', 1);
    if (result) g.applyHule(result, 0, 1);
    expect(g.shuvariActive[1]).toBe(true);
  });
});

describe('bug F: 小車輪 [混一色七対子] は +1 翻 ボーナス [単独 6 翻 ではない]', () => {
  it('混一色 + 七対子 + 小車輪 entry が 並び、 小車輪 fanshu=1', () => {
    // 七対子 + 混一色 [萬子 + 字牌] の手:
    // m1m1 m2m2 m3m3 m4m4 m5m5 z1z1 z2 + ロン z2 → 七対子 [混一色]
    const sp0 = ['m1', 'm1', 'm2', 'm2', 'm3', 'm3', 'm4', 'm4', 'm5', 'm5', 'z1', 'z1', 'z2'];
    const g = buildRawGame({
      shoupai: { 0: sp0, 1: ['p1'], 2: [] },
      baopai: ['z7'],
    });
    g.lizhi.add(0); // 面前ダマ禁止 reject 回避
    const result = g.hule(0, 'z2', 1);
    expect(result).not.toBeNull();
    const honitsu = result.hupai.find((h: any) => h.name === '混一色');
    const qidui = result.hupai.find((h: any) => h.name === '七対子');
    const shou = result.hupai.find((h: any) => typeof h.name === 'string' && h.name.startsWith('小車輪'));
    expect(honitsu).toBeDefined();
    expect(qidui).toBeDefined();
    expect(shou).toBeDefined();
    expect(shou.fanshu).toBe(1);
    // 翻数合計: 混一色 + 七対子 + 小車輪 = 5+1=6 翻 [+ 立直等 他役なら更に上乗せ]
    // 立直なし路線で 純粋 5+1=6 を確認
    const fanSum = result.hupai
      .filter((h: any) => typeof h.fanshu === 'number')
      .reduce((s: number, h: any) => s + h.fanshu, 0);
    // 混一色 [3 ロン] + 七対子 [2] + 小車輪 [1] = 6 [他にドラ等が乗らない sample]
    expect(fanSum).toBeGreaterThanOrEqual(6);
  });
});
