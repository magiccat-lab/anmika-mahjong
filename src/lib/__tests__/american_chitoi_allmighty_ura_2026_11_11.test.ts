// 2026-11-11 通報 [isg. / room F8DQ rev 771]「一個前の局、表示牌赤5pで6pが裏ドラになってなかったよ」の回帰固定。
//
// 前の局 [rev 769] は CPU1 のリーチ後の青ぽっちツモ。オールマイティを s7 に置くとアメリカ七対子
// [s6 の 4 枚使い] になる。裏ドラ表示は s2 ・ 赤 5p で、手の p6 2 枚が裏ドラ 2。
// オールマイティの置き換え先がアメリカ七対子の時だけ、七対子とアメリカ七対子の 2 役しか積んでおらず、
// 立直 ・ 門前清自摸和 ・ 裏ドラ ・ 赤ドラが全部抜けていた [置き換え無しのアメリカ七対子は積んでいた]。
import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function setupReportedHand(zimo = 'z5b'): { g: any; p: PlayerId } {
  const g: any = new Game3({ qijia: 0, changshu: 1 });
  g.qipai();
  const p = 1 as PlayerId;
  for (const q of [0, 1, 2] as PlayerId[]) {
    g.huapai[q] = [];
    g.goldHand[q] = { p: 0, s: 0, z: 0 };
    g.pochiHand[q] = { blue: 0, red: 0, green: 0, yellow: 0 };
    g.nukidora[q] = 0;
    g.nukidoraGold[q] = 0;
    g.kinpeiTarget[q] = null;
  }
  g.diyizimo = false;
  const sp = buildShoupai(['p6', 'p6', 's4', 's4', 's0', 's5', 's6', 's6', 's6', 's6', 's7', 's9', 's9']);
  sp.zimo(zimo);
  g.shoupai.set(p, sp);
  g.lizhi.add(p);
  g.yifaActive[p] = false;
  g.lastZimoInfo = { player: p, pai: zimo, pochi: zimo === 'z5b' ? 'blue' : null, gold: false };
  g.shan._baopai.length = 0;
  g.shan._baopai.push('f1', 'f4');
  g.shan._fubaopai.length = 0;
  g.shan._fubaopai.push('s2', 'p0');
  g.shan.commitDoraReveal?.();
  return { g, p };
}

const fanOf = (r: any, name: string): number => (r.hupai ?? [])
  .filter((h: any) => h.name === name)
  .reduce((sum: number, h: any) => sum + (Number(h.fanshu) || 0), 0);

describe('白ぽっちオールマイティでアメリカ七対子になる時も、立直 ・ ツモ ・ ドラを積む [通報 20261111]', () => {
  it('赤 5p 表示の裏ドラで p6 2 枚が裏ドラ 2 になる', () => {
    const { g, p } = setupReportedHand();
    const r: any = g.hule(p);
    expect(r).toBeTruthy();
    expect(r._allmightyPochi).toBe('s7');
    expect(r.hupai.some((h: any) => String(h.name).startsWith('アメリカ七対子'))).toBe(true);
    expect(fanOf(r, '裏ドラ')).toBe(2);
    expect(fanOf(r, '立直')).toBe(1);
    expect(fanOf(r, '門前清自摸和')).toBe(1);
    expect(fanOf(r, '赤ドラ')).toBe(1);
  });

  it('でかぽっち [リーチ一発の 1p ツモ] の置き換え先がアメリカ七対子でも一発 ・ 裏ドラを積む', () => {
    const { g, p } = setupReportedHand('p1');
    g.yifaActive[p] = true;
    const r: any = g.hule(p);
    expect(r).toBeTruthy();
    expect(r._dekapochiSwap).toBe('s7');
    expect(r.hupai.some((h: any) => String(h.name).startsWith('アメリカ七対子'))).toBe(true);
    expect(fanOf(r, '一発')).toBe(1);
    expect(fanOf(r, '裏ドラ')).toBe(2);
    expect(fanOf(r, '赤ドラ')).toBe(1);
  });
});
