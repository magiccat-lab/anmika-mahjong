// 2026-07-22 リョー報告: 「表ドラの神ぽっちがダメだ」
// 正ぽっち [z5g/b] がドラ表示牌に出た時:
//  - 選択済みターゲットのドラ翻が必ず付く [従来は再huleが特殊牌姿で失敗すると無言で消えた]
//  - base 計算で白扱いの幻の發ドラを数えない [正ぽっちは選択制ドラであって白ではない]
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';

function setupWin(baopai: string[], choice?: { key: string; target: string }) {
  const g = new Game3();
  g.qipai();
  // 天和判定と配牌華の混入を排除 [検証対象はドラ計数のみ]
  (g as any).firstTurnState.players[0].hasDiscarded = true;
  g.huapai[0 as any] = [];
  const sp = buildShoupai(['p2','p2','p3','p4','p5','p3','p4','p5','s6','s7','s8','s6','s7']);
  (sp as any).zimo('s8');
  g.shoupai.set(0 as any, sp as any);
  g.lizhi.add(0 as any); // 面前ダマ禁止を回避 [リーチ済み扱い]
  (g.shan as any)._baopai = [...baopai];
  (g.shan as any)._fubaopai = ['m9']; // 裏は手牌に無い牌で固定 [flaky防止]
  if (choice) {
    const ok = g.setKamiPochiDoraChoice(0 as any, choice.key, choice.target);
    expect(ok).toBe(true);
  }
  const res: any = g.hule(0 as any);
  expect(res).toBeTruthy();
  return res;
}

describe('神ぽっち表ドラ [2026-07-22]', () => {
  it('選択済み [p2] のドラ2翻が付き、神ぽっちラベルも出る', () => {
    const res = setupWin(['z5g'], { key: 'baopai:0', target: 'p2' });
    const dora = res.hupai.find((h: any) => h.name === 'ドラ');
    expect(dora?.fanshu).toBe(2);
    expect(res.hupai.some((h: any) => String(h.name).startsWith('神ぽっち'))).toBe(true);
  });

  it('未選択の正ぽっち表示牌は白扱いにならない [發ドラを数えない]', () => {
    const g = new Game3();
    g.qipai();
    (g as any).firstTurnState.players[0].hasDiscarded = true;
    g.huapai[0 as any] = [];
    // 發 [z6] 暗刻入りの和了形: z6 が白 [z5] indicator のドラになる誤りを検出する
    const sp = buildShoupai(['z6','z6','z6','p3','p4','p5','s6','s7','s8','s6','s7','s8','p2']);
    (sp as any).zimo('p2');
    g.shoupai.set(0 as any, sp as any);
    g.lizhi.add(0 as any);
    (g.shan as any)._baopai = ['z5g'];
    (g.shan as any)._fubaopai = ['m9'];
    const res: any = g.hule(0 as any);
    expect(res).toBeTruthy();
    const dora = res.hupai.find((h: any) => h.name === 'ドラ');
    expect(dora).toBeUndefined();
  });

  it('逆ぽっち [z5r] 表示牌は従来通り白扱い [發ドラが付く]', () => {
    const g = new Game3();
    g.qipai();
    (g as any).firstTurnState.players[0].hasDiscarded = true;
    g.huapai[0 as any] = [];
    const sp = buildShoupai(['z6','z6','z6','p3','p4','p5','s6','s7','s8','s6','s7','s8','p2']);
    (sp as any).zimo('p2');
    g.shoupai.set(0 as any, sp as any);
    g.lizhi.add(0 as any);
    (g.shan as any)._baopai = ['z5r'];
    (g.shan as any)._fubaopai = ['m9'];
    const res: any = g.hule(0 as any);
    expect(res).toBeTruthy();
    const dora = res.hupai.find((h: any) => h.name === 'ドラ');
    expect(dora?.fanshu).toBe(3);
  });
});
