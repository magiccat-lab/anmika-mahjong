// 2026-10-14 リョー通報 20261014_4「前の局、ぽっち0があるから6s取りでやるのが正しいよ」[room 90PJ rev 3339] の回帰固定。
//
// リーチ後の黄ぽっちツモ [オールマイティ、強制高め取り]。待ちは s3 / s6、裏ドラ表示は s2。
// s3 取りは裏ドラ 1 [祝儀 4 枚]、s6 取りは祝儀 0 枚で「白ぽっちツモ祝儀 0 枚」の救済サイコロ [70 枚] が付く。
// 高め取りの見積もりは祝儀の大きさだけを比べていて、救済サイコロを数えていなかったので s3 を選んでいた。
// サイコロの期待値 [1 投 2/30 の当たり × 4 投 × 70 枚 × 2 人] は裏ドラ 1 より大きいので s6 が高め。
import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function setupReportedHand(fubaopaiIndicator: string): { g: Game3; p: PlayerId } {
  const g: any = new Game3({ qijia: 0, changshu: 1 });
  g.qipai();
  const p = 2 as PlayerId;
  for (const q of [0, 1, 2] as PlayerId[]) {
    g.huapai[q] = [];
    g.goldHand[q] = { p: 0, s: 0, z: 0 };
    g.pochiHand[q] = { blue: 0, red: 0, green: 0, yellow: 0 };
    g.nukidora[q] = 0;
    g.nukidoraGold[q] = 0;
    g.kinpeiTarget[q] = null;
  }
  g.diyizimo = false;
  const sp = buildShoupai(['m7', 'm7', 'm7', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 's4', 's5', 'z5', 'z5']);
  sp.zimo('z5y');
  g.shoupai.set(p, sp);
  g.lizhi.add(p);
  g.yifaActive[p] = false;
  g.shuvariActive[p] = true;
  g.pochiMultiplier[p] = { defen: -1, chip: -1 };
  g.lastZimoInfo = { player: p, pai: 'z5y', pochi: 'yellow', gold: false };
  g.shan._baopai.length = 0;
  g.shan._baopai.push('m1', 'z4');
  g.shan._fubaopai.length = 0;
  g.shan._fubaopai.push(fubaopaiIndicator, 'z4');
  g.shan.commitDoraReveal?.();
  return { g, p };
}

describe('逆ぽっち [黄] の高め取りは、祝儀 0 枚の救済サイコロも数える [通報 20261014_4]', () => {
  it('裏ドラが乗る s3 より、祝儀 0 枚でサイコロが付く s6 を取る', () => {
    const { g, p } = setupReportedHand('s2');
    const r: any = g.hule(p);
    expect(r).toBeTruthy();
    expect(r._allmightyPochi).toBe('s6');
  });

  it('どちらも祝儀 0 枚なら、今まで通り打点の高い方を取る', () => {
    // 裏ドラ表示を待ちに関係ない所に置く。s3 と s6 で祝儀は同じ 0 枚
    const { g, p } = setupReportedHand('m1');
    const r: any = g.hule(p);
    expect(r).toBeTruthy();
    expect(['s3', 's6']).toContain(r._allmightyPochi);
  });
});
