// Regression: ユーザー報告 [2026-05-15] bug A/B/C/D
//   A: 神ぽっち shift / 金赤 5 ドラ count 漏れ [majiang-core hule.js の `replace(/0/, '5')` 非 g]
//   B: シュバ棒倍率は winner only [ロン者本人のシュバのみ ×2、 振込者のシュバは無関係]
//   C: ドラ count 確認 [西ロン case の dora 翻 数] — 既存挙動の固定 [user 認識違い疑い]
//   D: 冬めくり 副露 5 牌 collision [副露 'm555+' を 2 文字 ずつ slice してた bug]
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function buildRawGame(opts: {
  shoupai: Record<PlayerId, string[]>;
  fulou?: Record<PlayerId, string[]>;
  shanRemaining?: string[];
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
  shanAny._pai = [...(opts.shanRemaining ?? [])].reverse();
  if (opts.baopai !== undefined) shanAny._baopai = opts.baopai;
  if (opts.fubaopai !== undefined) shanAny._fubaopai = opts.fubaopai;
  return g;
}

describe('bug A: majiang-core 0 牌複数枚 ドラ count 漏れ 補正', () => {
  it('baopai p4 [→p5 ドラ] + 手牌 p0 2 枚 → ドラ count 2 [赤/金 両方]', () => {
    // 手牌 13 枚: m123 p123 p00 s678 z11 [p0 を 2 枚]、 ロン z1 [対子和了]
    // majiang-core は paistr toString で n_pai=2 の 5 を 0 に圧縮 → "p100p2300"... 等
    // 実際 p0=2 + p5=0 → suitstr "p1230" or 同 [p の 1,2,3 と 0 を含む]、 0 は文字列中 1 個
    // ind p4 → p5 next、 regex /5/g → 副露無しの suitstr 中に 5 が見えるか試す
    // → bingpai[p][5] 内訳: p0=2 + p5=0 → toString は p5 を 0 表記に変換 → "p12300"
    //   regex /5/ では 5 は match されない、 anmika 補正 (zeroDeficit p = 1) で +1 が加算される
    const sp0 = ['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 'p0', 'p0', 's6', 's7', 's8', 'z1', 'z1'];
    const g = buildRawGame({
      shoupai: { 0: sp0, 1: [], 2: [] },
      shanRemaining: [],
      baopai: ['p4'],
    });
    g.lizhi.add(0);
    const result = g.hule(0, 'z1', 1);
    expect(result).not.toBeNull();
    const doraEntries = (result.hupai ?? []).filter((h: any) => h.name === 'ドラ' || h.name === 'ドラ [赤/金 5 補正]');
    const totalDora = doraEntries.reduce((s: number, h: any) => s + (h.fanshu ?? 0), 0);
    const aka = (result.hupai ?? []).find((h: any) => h.name === '赤ドラ');
    // ドラ = p5 系 [純粋 5 + 0 牌] 計 2 枚 = 2
    expect(totalDora).toBe(2);
    // 赤ドラ = paistr 中の '0' の数 = 2 [majiang-core が直接 carve out]
    expect(aka?.fanshu ?? 0).toBe(2);
  });

  it('baopai p4 + 手牌 p0 1 + p5 1 → 補正 0、 ドラ count 2 [二重計上 防止 / 既存挙動維持]', () => {
    // p0 1 枚 + p5 1 枚 → majiang-core が両方 [bingpai[p][5]=2] count、 ドラ 2 翻、
    // fix で 0 牌 1 枚なら zeroDeficit=0 で補正 0 [旧 削除前 code は ここで +1 して 3 翻 = 二重]
    const sp0 = ['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 'p0', 'p5', 's6', 's7', 's8', 'z1', 'z1'];
    const g = buildRawGame({
      shoupai: { 0: sp0, 1: [], 2: [] },
      shanRemaining: [],
      baopai: ['p4'],
    });
    g.lizhi.add(0);
    const result = g.hule(0, 'z1', 1);
    expect(result).not.toBeNull();
    const doraEntries = (result.hupai ?? []).filter((h: any) => h.name === 'ドラ' || h.name === 'ドラ [赤/金 5 補正]');
    const totalDora = doraEntries.reduce((s: number, h: any) => s + (h.fanshu ?? 0), 0);
    expect(totalDora).toBe(2);
  });
});

describe('bug B: シュバ棒倍率は winner 本人のみ [振込者のシュバは無関係]', () => {
  it('winner shuvari + loser shuvari 両方 active でも 倍率は ×2 [winner only]', () => {
    const g = new Game3();
    g.qipai();
    g.shuvariActive[0] = true;
    g.shuvariActive[1] = true; // 振込者も シュバ
    const m = g.computeChipMultiplier(0); // winner=0
    expect(m).toBe(2);
  });
  it('winner shuvari off + loser shuvari on → 倍率 1 [winner 倍率のみ参照]', () => {
    const g = new Game3();
    g.qipai();
    g.shuvariActive[0] = false;
    g.shuvariActive[1] = true;
    const m = g.computeChipMultiplier(0);
    expect(m).toBe(1);
  });
  it('winner shuvari + 青ぽっち [pochiMultiplier=2] で 倍率 4 [winner 自身の積]', () => {
    const g = new Game3();
    g.qipai();
    g.shuvariActive[0] = true;
    g.pochiMultiplier[0] = { defen: 1, chip: 2 };
    const m = g.computeChipMultiplier(0);
    // 仕様確認: shuvari 2 × pochi 2 = 4 [winner 本人の組合せ、 これは正、 user スクショ ×4 の真因]
    expect(m).toBe(4);
  });
});

describe('bug C: ドラ count 西ロン case 確認 [user 認識違い疑い]', () => {
  it('baopai z2 [南→西 ドラ] + 手牌 z3 ×2 + ロン z3 + 抜き北 1 → ドラ 3 翻 / 抜きドラ 1 翻', () => {
    const sp0 = ['z3', 'z3', 'z7', 'z7', 'z7', 'm1', 'm2', 'm3', 'p1', 'p2', 'p3', 's5', 's5'];
    const g = buildRawGame({
      shoupai: { 0: sp0, 1: [], 2: [] },
      baopai: ['z2'],
    });
    g.lizhi.add(0);
    g.nukidora[0] = 1;
    const result = g.hule(0, 'z3', 1);
    expect(result).not.toBeNull();
    const dora = (result.hupai ?? []).find((h: any) => h.name === 'ドラ');
    const nuki = (result.hupai ?? []).find((h: any) => typeof h.name === 'string' && h.name.startsWith('抜きドラ'));
    expect(dora?.fanshu ?? 0).toBe(3);
    expect(nuki?.fanshu ?? 0).toBe(1);
  });
});

describe('bug D: 冬めくり 副露牌の 5 が genbutsu にカウントされる [副露表記 parse fix]', () => {
  it("副露 'p555+' [ポン p5 ×3] が genbutsuCount に 3 枚反映 → 冬めくり p5 で 3 hit", () => {
    // 手牌 spec: p5 ポン副露 + 雀頭 + 残り 適当、 huapai f4×1 [冬]、 baopai 任意
    // 副露 'p555+': p5 を 3 枚 ポン
    const sp0 = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 's2', 's3', 's4', 'z1']; // 10 枚 + 副露 3 = 13
    const g = buildRawGame({
      shoupai: { 0: sp0, 1: [], 2: [] },
      fulou: { 0: ['p555+'], 1: [], 2: [] },
      baopai: ['z2'],
    });
    g.huapai[0] = ['f4'];
    // shan に 「冬めくり」 用に p5 1 枚を仕込んで 1 回の めくりで 3 hit を観測
    const shanAny = g.shan as any;
    shanAny._pai = ['p5'];
    // applyFuyuChip 直接呼び出し
    g.applyFuyuChip(0, null, 1, false);
    const log = (g as any)._huleChipCtx().shan._fuyuRevealed ?? [];
    // めくり結果は g.shan 経由で取得不能なので chipBreakdown で確認
    const lastEntry = g.chipBreakdown.at(-1);
    // base = hits * chipPerHit、 chipPerHit=1 [副露あり = isFulou]、 1 hit = 3 [genbutsu p5 が 3 枚]
    expect(lastEntry?.label?.startsWith('冬')).toBe(true);
    // base 3 [3 hit × 1 chipPerHit] のはず、 旧 bug 時は 1 [genbutsu p5 が 1 枚しか count されない]
    expect(lastEntry?.base).toBe(3);
    void log;
  });

  it("副露 'p050+' [赤/金 5 を含む副露] の 0 牌 が genbutsuCount に正しく反映", () => {
    // 副露 'p050+' = p0,p5,p0 [pon 5 with 0×2 + 5×1]
    const sp0 = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 's2', 's3', 's4', 'z1'];
    const g = buildRawGame({
      shoupai: { 0: sp0, 1: [], 2: [] },
      fulou: { 0: ['p050+'], 1: [], 2: [] },
      baopai: ['z2'],
    });
    g.huapai[0] = ['f4'];
    const shanAny = g.shan as any;
    shanAny._pai = ['p5'];
    g.applyFuyuChip(0, null, 1, false);
    const lastEntry = g.chipBreakdown.at(-1);
    // p5 めくり → matches に p5 + p0 含む、 genbutsu p0=2 + p5=1 = 3 hit、 chipPerHit=1 → base 3
    expect(lastEntry?.label?.startsWith('冬')).toBe(true);
    expect(lastEntry?.base).toBe(3);
  });
});
