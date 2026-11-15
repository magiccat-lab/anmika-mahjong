// [2026-11-15 リョー「この牌譜だと789三色おかしくね？9p9pだし、牌譜見返してよ。てかもしそうなら枚数変わるのでは？」]
// 2L8R 13 戦目の最後の局 (arupu_ の嵌八萬ツモ): m79 + 白ぽっち p67899 s666789。
// p は p678 + p99 の頭にしか割れず p789 は取れないのに、p7 ・ p8 ・ p9 の枚数だけで 789 三色 (4 翻) と
// 「嵌八萬+789 [追加]」のサイコロが付き、13 翻超過も 4 枚多く数えていた。
import { describe, it, expect } from 'vitest';

import { Game3, buildShoupai } from '../game3';
import { hasKanpaman789, kanpaman789Rule, withLegacyKanpaman789 } from '../game3/yaku';

type PlayerId = 0 | 1 | 2;
const P0 = 0 as PlayerId;

function buildBase(hand: string[], baopai: string[], fubaopai: string[] | null): any {
  const g: any = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) g.shoupai.set(p, buildShoupai(hand));
  const dummy: any = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  g.shan._pai = ['p9'];
  g.shan.setBaopai(baopai, fubaopai);
  g.diyizimo = false;
  g.huapai = { 0: [], 1: [], 2: [] };
  return g;
}
const bp = (tiles: string[]) => {
  const c: any = { m: Array(10).fill(0), p: Array(10).fill(0), s: Array(10).fill(0), z: Array(8).fill(0) };
  for (const t of tiles) c[t[0]][Number(t[1])] += 1;
  return c;
};

const ARUPU = ['m7', 'm9', 'p6', 'p7', 'p8', 'p9', 'p9', 's6', 's6', 's6', 's7', 's8', 's9'];
const KAN789 = ['m7', 'm9', 'p7', 'p8', 'p9', 's7', 's8', 's9', 'p2', 'p3', 'p4', 's2', 's2'];

describe('嵌八萬の 789 三色は 3 つとも順子に取れる時だけ', () => {
  it('2L8R の手 (p67899 = p678 + p99) は 789 三色にならない', () => {
    expect(hasKanpaman789(bp([...ARUPU, 'm8']))).toBe(false);
    expect(hasKanpaman789(bp([...ARUPU, 'z5']))).toBe(false);
  });
  it('本物の 789 三色は今まで通り付く (ぽっちが z5 のままでも m8 として読む)', () => {
    expect(hasKanpaman789(bp([...KAN789, 'm8']))).toBe(true);
    expect(hasKanpaman789(bp([...KAN789, 'z5']))).toBe(true);
    // p789 を 2 組持っても p789 を 1 つ取って残りが割れればよい
    expect(hasKanpaman789(bp(['m7', 'm8', 'm9', 'p7', 'p7', 'p8', 'p8', 'p9', 'p9', 's7', 's8', 's9', 'z1', 'z1']))).toBe(true);
    // p6789 + p9 の頭: p6 が浮くので不成立
    expect(hasKanpaman789(bp(['m7', 'm8', 'm9', 'p6', 'p7', 'p8', 'p9', 'p9', 's7', 's8', 's9', 'z1', 'z1', 'z1']))).toBe(false);
  });
  it('2L8R の手の嵌八萬ツモ: 789 三色と「嵌八萬+789 [追加]」のサイコロが付かない', () => {
    const g = buildBase(ARUPU, ['z7'], null);
    g.lizhi.add(P0);
    g.shoupai.get(P0).zimo('z5g');
    const r = g.hule(P0, null, null);
    expect(r.hupai.some((h: any) => String(h.name).startsWith('嵌八萬'))).toBe(true);
    expect(r.hupai.some((h: any) => String(h.name).startsWith('789 三色'))).toBe(false);
    expect((r.saiKoroChances ?? []).some((c: any) => String(c.awardKey).startsWith('kanpaman:789'))).toBe(false);
  });
  it('本物の 789 三色の嵌八萬ツモは今まで通り 789 三色が付く', () => {
    const g = buildBase(KAN789, ['z7'], null);
    g.lizhi.add(P0);
    g.shoupai.get(P0).zimo('z5g');
    const r = g.hule(P0, null, null);
    expect(r.hupai.some((h: any) => String(h.name).startsWith('789 三色'))).toBe(true);
  });
  it('直す前に記録した対局の読み直しは、弾かれた時だけ前の判定 (枚数だけ) で読む', () => {
    let calls = 0;
    const seen: boolean[] = [];
    const out = withLegacyKanpaman789(() => {
      calls += 1;
      seen.push(kanpaman789Rule.legacyCountOnly);
      const g = buildBase(ARUPU, ['z7'], null);
      g.lizhi.add(P0);
      g.shoupai.get(P0).zimo('z5g');
      const r = g.hule(P0, null, null);
      if (!r.hupai.some((h: any) => String(h.name).startsWith('789 三色'))) throw new Error('no dice chance is pending');
      return r;
    });
    expect(calls).toBe(2);
    expect(seen).toEqual([false, true]);
    expect(out.hupai.some((h: any) => String(h.name).startsWith('789 三色'))).toBe(true);
    expect(kanpaman789Rule.legacyCountOnly).toBe(false);
  });
});
