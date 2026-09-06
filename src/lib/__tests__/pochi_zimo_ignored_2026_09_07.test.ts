// 2026-09-07 バグ通報 20260907_0 「青ぽっちツモ無視された」回帰固定。
//
// リーチ後のぽっち [z5b/r/g/y] はオールマイティ [ルール 2-3、強制高め取り] なので、
// テンパイしている限りツモ和了が必ず成立する。ところが canTsumo() は
// hule_mianzi が空の時に hule() の結果だけを見て即 return しており、
// 下にある「ぽっちオールマイティ swap」判定が到達不能だった。
// hule() が何かの理由で null を返すと canTsumo=false → リーチ自動進行
// [autoLizhiInline] が和了牌をそのまま河に捨てる = 「ツモ無視」。
import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { buildShoupai } from '../game3';
import { createGameStore, innerDiscard } from '../store';
import type { PlayerId } from '../types';

/** 通報された局面: P0 リーチ [待ち s1/s4]、次のツモが青ぽっち */
function setupReportedBoard() {
  const store: any = createGameStore();
  const s: any = get(store);
  const g: any = s.game;
  store.setCpuSeats([]);
  g.diyizimo = false;
  for (const p of [0, 1, 2] as PlayerId[]) {
    g.huapai[p] = [];
    g.goldHand[p] = { p: 0, s: 0, z: 0 };
    g.pochiHand[p] = { blue: 0, red: 0, green: 0, yellow: 0 };
    g.nukidora[p] = 0;
    g.nukidoraGold[p] = 0;
    g.kinpeiTarget[p] = null;
    g.lingshangActive[p] = false;
    g.lingshangFromKan[p] = false;
    g.he.get(p)._pai.length = 0;
  }
  // 通報ダンプの P0 手牌 [p0 = 赤5筒 / gp = 金5筒]
  g.shoupai.set(0, buildShoupai(['p0', 'gp', 'p8', 'p8', 'p8', 's2', 's3', 's6', 's7', 's8', 's8', 's8', 's8']));
  g.shoupai.set(1, buildShoupai(['p1', 'p1', 'p2', 'p3', 'p3', 'p5', 's3', 's4', 's4', 's5', 's7', 's0', 'z6']));
  g.shoupai.set(2, buildShoupai(['m9', 'p1', 'p6', 'p7', 'p7', 's2', 's4', 's6', 's6', 'z2', 'z2', 'z6', 'z7']));
  g.huapai[0] = ['f2'];
  g.shan._baopai.length = 0;
  g.shan._baopai.push('p7', 'f4');
  if (g.shan._fubaopai) {
    g.shan._fubaopai.length = 0;
    g.shan._fubaopai.push('z4', 'z5g');
  }
  g.shan.commitDoraReveal?.();
  g.lizhi.add(0);
  g.yifaActive[0] = true;
  g.shuvariActive[0] = true;
  g.shuvariUsed[0] = true;
  while (g.lunbanToPlayerId(g.state.lunban) !== 1) g.state.lunban = (g.state.lunban + 1) % 3;
  const sp1: any = g.shoupai.get(1);
  sp1.zimo('m7');
  s.lastZimo = 'm7';
  s.lastDapai = null;
  // 山の末尾 [次に pop される牌] を青ぽっちに固定
  g.shan._pai[g.shan._pai.length - 1] = 'z5b';
  return { store, s, g };
}

describe('リーチ後の青ぽっちツモ [バグ通報 20260907_0]', () => {
  it('待ちが埋まる青ぽっちを引いたらツモ和了可能で、自動ツモ切りしない', () => {
    const { s, g } = setupReportedBoard();
    const out: any = innerDiscard(s, 'm7');
    expect(out.lastZimo).toBe('z5b');
    expect(g.canTsumo(0 as PlayerId)).toBe(true);
    // 河に落ちていない = 自動ツモ切りが止まっている
    expect(g.he.get(0)._pai).toEqual([]);
  });

  it('hule() が null を返してもオールマイティ判定でツモ和了可能のままになる', () => {
    const { s, g } = setupReportedBoard();
    innerDiscard(s, 'm7');
    // hule() が何かの理由で和了形を作れなかった状況を再現する。
    // 修正前はここで canTsumo=false になり、和了牌が自動ツモ切りされていた。
    const spy = vi.spyOn(g, 'hule').mockReturnValue(null);
    try {
      expect(g.canTsumo(0 as PlayerId)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('テンパイしていない手ならぽっちを引いてもツモ和了にはならない', () => {
    const { s, g } = setupReportedBoard();
    // 待ちの無い形に差し替える [シャンテン戻し]
    g.shoupai.set(0, buildShoupai(['p0', 'gp', 'p8', 'p8', 'p8', 's2', 's3', 's6', 's7', 's9', 'z1', 'z2', 'z3']));
    innerDiscard(s, 'm7');
    expect(g.canTsumo(0 as PlayerId)).toBe(false);
  });
});
