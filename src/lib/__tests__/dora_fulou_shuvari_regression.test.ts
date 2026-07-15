// Regression: ユーザー報告 [2026-05-15]
// bug [1] ドラ翻 が 抜き北 を二重カウントしてる疑い
// bug [2] 副露 [鳴き] 状態で シュバ倍率 ×2 が立ってる
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function buildRawGame(opts: {
  shoupai: Record<PlayerId, string[]>;
  shanRemaining?: string[];
  baopai?: string[];
  fubaopai?: string[] | null;
  qijia?: PlayerId;
  benbang?: number;
  changshu?: number;
  jushu?: number;
  changbang?: number;
}): Game3 {
  const g = new Game3({ qijia: opts.qijia ?? 0, changshu: opts.changshu ?? 1 });
  g.state.benbang = opts.benbang ?? 0;
  if (opts.jushu !== undefined) g.state.jushu = opts.jushu;
  if (opts.changbang !== undefined) g.state.changbang = opts.changbang;
  for (const p of [0, 1, 2] as PlayerId[]) {
    g.shoupai.set(p, buildShoupai(opts.shoupai[p] ?? []));
  }
  const dummy = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  const shanAny = g.shan as any;
  shanAny._pai = [...(opts.shanRemaining ?? [])].reverse();
  if (opts.baopai !== undefined) shanAny._baopai = opts.baopai;
  // Tests using this raw builder must not inherit random ura indicators merely
  // because they mark a hand as riichi.
  shanAny._fubaopai = opts.fubaopai === undefined ? [] : opts.fubaopai;
  return g;
}

describe('bug[1A] 赤 5 [p0/s0] が ドラ entry に 二重計上されない', () => {
  it('baopai p4 [→ p5 ドラ] + 手牌 p0 1 枚 → ドラ 1 翻 [二重 +1 しない]', () => {
    // 手 13 枚: m123 p123 p05 s678 z11、 ロン z1 → 立直 + ドラ
    // majiang-core 自身が p0 を ドラとしてカウント済 [bingpai[p][5]=2 内訳 p0+p5]
    // anmika の goldRedExtra が さらに +1 する 旧 bug: ドラ 3 翻 → fix で 2 翻
    const sp0 = ['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 'p0', 'p5', 's6', 's7', 's8', 'z1', 'z1'];
    const g = buildRawGame({
      shoupai: { 0: sp0, 1: [], 2: [] },
      shanRemaining: [],
      baopai: ['p4'], // → p5 ドラ
    });
    g.lizhi.add(0);
    const result = g.hule(0, 'z1', 1);
    expect(result).not.toBeNull();
    const dora = result.hupai.find((h: any) => h.name === 'ドラ' || h.name === 'ドラ [金/赤 5 追加]');
    const aka = result.hupai.find((h: any) => h.name === '赤ドラ');
    // ドラ = p5 純粋 1枚 + p0 1枚 = 2 [majiang-core が両方計上]
    // 旧 code は さらに +1 して 3 を返してた
    expect(dora?.fanshu ?? 0).toBe(2);
    expect(aka?.fanshu ?? 0).toBe(1);
  });
});

describe('bug[1] ドラ翻 + 抜き北 [二重カウント禁止]', () => {
  it('baopai z2 [南] → ドラ z3 [西]、 手牌 西2 + ロン西 + 抜き北×1 → ドラ翻=3 / 抜きドラ=1', () => {
    // 手牌 13 枚: 西2 + 中3 [暗刻] + 一気通貫っぽい形
    // 中刻 + 西2 + 萬123 + 筒123 + 索5対子、 ロン西 で 西刻
    const sp0 = ['z3', 'z3', 'z7', 'z7', 'z7', 'm1', 'm2', 'm3', 'p1', 'p2', 'p3', 's5', 's5'];
    const g = buildRawGame({
      shoupai: { 0: sp0, 1: [], 2: [] },
      shanRemaining: ['m1', 'm2', 'm3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z2'],
      baopai: ['z2'], // 南 → ドラ西
    });
    g.lizhi.add(0); // ダマ禁止回避 [面前なら lizhi 必須]
    g.nukidora[0] = 1; // 抜き北 1 枚
    const result = g.hule(0, 'z3', 1);
    expect(result).not.toBeNull();
    const dora = result.hupai.find((h: any) => h.name === 'ドラ');
    const nuki = result.hupai.find((h: any) => typeof h.name === 'string' && h.name.startsWith('抜きドラ'));
    const kitaDora = result.hupai.find((h: any) => typeof h.name === 'string' && h.name.startsWith('北ドラ'));
    expect(dora?.fanshu ?? 0).toBe(3); // 西 3 枚 = ドラ 3 翻
    expect(nuki?.fanshu ?? 0).toBe(1); // 抜き北 1 枚 = 1 翻
    expect(kitaDora).toBeUndefined(); // baopai は z3 [西] ではないので 北ドラ補正は出てはいけない
  });

  it('baopai z3 [西] → ドラ z4 [北]、 抜き北×1 のみ → 北ドラ補正 1 翻 + 抜きドラ 1 翻', () => {
    // 手牌 z4 ナシ [全部抜き済]、 baopai z3 → ドラ z4
    const sp0 = ['z7', 'z7', 'z7', 'm1', 'm2', 'm3', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's5'];
    const g = buildRawGame({
      shoupai: { 0: sp0, 1: [], 2: [] },
      shanRemaining: [],
      baopai: ['z3'], // 西 → ドラ北
    });
    g.lizhi.add(0);
    g.nukidora[0] = 1;
    const result = g.hule(0, 's5', 1);
    expect(result).not.toBeNull();
    const dora = result.hupai.find((h: any) => h.name === 'ドラ');
    const nuki = result.hupai.find((h: any) => typeof h.name === 'string' && h.name.startsWith('抜きドラ'));
    const kitaDora = result.hupai.find((h: any) => typeof h.name === 'string' && h.name.startsWith('北ドラ'));
    expect(dora?.fanshu ?? 0).toBe(0); // 手牌に z4 0 枚 [抜き済]
    expect(nuki?.fanshu ?? 0).toBe(1); // 抜き北 1 翻
    expect(kitaDora?.fanshu ?? 0).toBe(1); // baopai z3 ×1 × 抜き 1 = 1 翻
  });
});

describe('bug[2] 副露 [鳴き] 状態で シュバ倍率 ×2 立たない', () => {
  it('明刻ポン後の declarePon で shuvariActive を 強制 false に', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    // 仮想的に shuvariActive を立てた後 [本来 declareLizhi 経由のみ、 ここは regression 的に直設定]、
    // declarePon で false に落ちることを確認
    g.shuvariActive[player] = true;
    // ポン用の手牌 [簡易構築: m5 を 2 枚以上持たせる]
    const sp = g.shoupai.get(player);
    sp._bingpai.m[5] = 2;
    // dapai 元 player [反時計周り 上家]
    const fromPlayer = ((player + 1) % 3) as PlayerId;
    // m5 を河に置いた状態で declarePon を呼ぶ
    // mianzi format: 'm555+' [下家から] / 'm555=' [対面] / 'm555-' [上家から]
    // 反時計周り: from = player+1 mod 3 → diff = 1 → 上家 → '-'
    // [game3.ts L1198 lunban 計算と整合]
    const fromHe = g.he.get(fromPlayer);
    fromHe.dapai('m5');
    const ok = g.declarePon(player, 'm555-', fromPlayer);
    expect(ok).toBe(true);
    expect(g.shuvariActive[player]).toBe(false);
  });

  it('declareDamingang [大明槓] でも shuvariActive を 強制 false に', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    g.shuvariActive[player] = true;
    const sp = g.shoupai.get(player);
    sp._bingpai.m[5] = 3;
    const fromPlayer = ((player + 1) % 3) as PlayerId;
    const fromHe = g.he.get(fromPlayer);
    fromHe.dapai('m5');
    g.declareDamingang(player, 'm5555-', fromPlayer);
    expect(g.shuvariActive[player]).toBe(false);
  });
});

describe('regression: 白ダイミンカンは白暗カンサイコロ対象外', () => {
  it('suffix が落ちた z5 大明槓でも _anmikaFulou metadata があれば暗槓扱いしない', () => {
    const g = buildRawGame({
      shoupai: {
        0: ['p1', 'p2', 'p3', 's1', 's2', 's3', 'z1', 'z1', 'z1', 'z2'],
        1: [],
        2: [],
      },
      baopai: ['p1'],
    });
    const sp = g.shoupai.get(0);
    sp._fulou = ['z5555'];
    sp._anmikaFulou = [{ mianzi: 'z5555-', from: 1, taken: 'z5' }];
    const result: any = { hupai: [], fanshu: 1, damanguan: 0 };

    g.applyAnmikaYakuPostProcess(result, 0, false, 'p3', null, null);

    expect(result.saiKoroChances ?? []).not.toContainEqual(expect.objectContaining({
      name: '白暗カンアガリ',
    }));
  });

  it('metadata のない suffix なし z5 カンは暗槓としてサイコロ対象', () => {
    const g = buildRawGame({
      shoupai: {
        0: ['p1', 'p2', 'p3', 's1', 's2', 's3', 'z1', 'z1', 'z1', 'z2'],
        1: [],
        2: [],
      },
      baopai: ['p1'],
    });
    const sp = g.shoupai.get(0);
    sp._fulou = ['z5555'];
    const result: any = { hupai: [], fanshu: 1, damanguan: 0 };

    g.applyAnmikaYakuPostProcess(result, 0, false, 'p3', null, null);

    expect(result.saiKoroChances ?? []).toContainEqual(expect.objectContaining({
      name: '白暗カンアガリ',
      baseChip: 70,
    }));
  });
});
