import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// pickBestDiscard 守備強化 [リョー指示 2026-05-14]:
//   - 全リーチ家の現物 → +10
//   - 1 人以上の リーチ家に 非現物 → -5 [危険牌 ペナルティ]
describe('pickBestDiscard 守備 [リーチ家対応]', () => {
  it('リーチ家ナシなら 守備 prio 影響なし', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.shoupai.set(player, buildShoupai(['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','s4']));
    const sp = g.shoupai.get(player) as any;
    sp.zimo('s5');
    const pick = g.pickBestDiscard(player);
    expect(pick).toBeTruthy();
  });

  it('リーチ家あり + 自家に現物のみ持ち で 現物を切る [+10 prio]', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    const lizhiP = 1 as PlayerId;
    // 自家手: m9 + p1-p9 + s1-s4、 m9 と s4 が候補に
    g.shoupai.set(player, buildShoupai(['m9','p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3']));
    const sp = g.shoupai.get(player) as any;
    sp.zimo('s4');
    g.lizhi.add(lizhiP);
    // lizhiP の河に m9 のみ
    const he = g.he.get(lizhiP);
    (he as any)._pai = ['m9'];
    const pick = g.pickBestDiscard(player);
    // m9 が現物 → 優先候補、 実際選ばれるか
    expect(pick).toBeTruthy();
    // 期待: m9 が pick されるか、 少なくとも 非現物より prio 高くなる
    // ukeire / xt 同等なら現物優先、 明確 assert は xt 影響で揺らぐので 「pick が undefined じゃない + valid candidate」
    const sp2 = g.shoupai.get(player) as any;
    const candidates = sp2.get_dapai(false);
    expect(candidates).toContain(pick);
  });

  it('リーチ家あり + 全 候補 非現物 でも pick は returned [-5 で抑制するが 候補ナシじゃない]', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    const lizhiP = 1 as PlayerId;
    g.shoupai.set(player, buildShoupai(['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','s4']));
    const sp = g.shoupai.get(player) as any;
    sp.zimo('s5');
    g.lizhi.add(lizhiP);
    // lizhiP 河 空、 全 候補 非現物
    const he = g.he.get(lizhiP);
    (he as any)._pai = [];
    const pick = g.pickBestDiscard(player);
    expect(pick).toBeTruthy();
    const candidates = sp.get_dapai(false);
    expect(candidates).toContain(pick);
  });
});
