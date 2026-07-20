// 2026-07-20 リョー指摘:
//   「7 対子の時に他の部分をポンしてもフィーバー権消えるから、そこも加味して」
// フィーバー成立条件は「暗槓以外の副露ゼロ」で牌種を問わない。
// 7 のポン禁止だけでは足りず、芽がある手では役牌ポンでも権利が飛ぶ。
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import { evaluateFeverPotential, shouldSkipPonForFever } from '../store/cpuFever';
import {
  pickLizhiDapai,
  decideFever,
  dangerOf,
  currentTurn,
  FEVER_FORCE_TIER,
  FEVER_LATE_TURN,
} from '../store/cpuLizhi';
import type { PlayerId } from '../types';

function buildG(hand: string[]): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) g.shoupai.set(p, buildShoupai(hand));
  const dummy = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  const shanAny = g.shan as any;
  shanAny._pai = [];
  shanAny._baopai = ['z2', 'z2'];
  shanAny._fubaopai = [];
  return g;
}

const FILLER = ['p2', 'p4', 'p5', 'p6', 's2', 's3', 's4', 's5', 's6'];

describe('cpuFever: フィーバーの芽が残る手ではポンを見送る', () => {
  it('7 を 2 枚持っていれば芽ありと見る [暗刻まで残り 1 枚]', () => {
    const g = buildG(['m7', 'm7', ...FILLER, 'z1', 'z1']);
    const r = evaluateFeverPotential(g, 0);
    expect(r.hasPotential).toBe(true);
    expect(r.sevenSeeds).toBe(1);
    expect(shouldSkipPonForFever(g, 0)).toBe(true);
  });

  it('7 が 1 枚だけなら遠すぎるので芽とみなさない', () => {
    const g = buildG(['m7', 'p7', ...FILLER, 'z1', 'z1']);
    // m7 / p7 が 1 枚ずつでは暗刻まで 2 枚ずつ、芽としては数えない
    const r = evaluateFeverPotential(g, 0);
    expect(r.sevenSeeds).toBe(0);
    expect(r.hasPotential).toBe(false);
  });

  it('7 が 2 種 2 枚ずつなら芽 2 種', () => {
    const g = buildG(['m7', 'm7', 'p7', 'p7', ...FILLER, 'z1']);
    expect(evaluateFeverPotential(g, 0).sevenSeeds).toBe(2);
  });

  it('虹 2 種持ちも全虹の芽として守る', () => {
    const g = buildG(['np3', 'ns3', ...FILLER, 'z1', 'z1']);
    const r = evaluateFeverPotential(g, 0);
    expect(r.nijiKinds).toBe(2);
    expect(r.hasPotential).toBe(true);
  });

  it('虹 1 種だけでは芽とみなさない', () => {
    const g = buildG(['np3', ...FILLER, 'z1', 'z1', 'z6']);
    expect(evaluateFeverPotential(g, 0).hasPotential).toBe(false);
  });

  it('既に副露済ならフィーバー権は無いので普通にポンしてよい', () => {
    const g = buildG(['m7', 'm7', ...FILLER, 'z1', 'z1']);
    g.shoupai.get(0)._fulou = ['z666+'];
    const r = evaluateFeverPotential(g, 0);
    expect(r.hasPotential).toBe(false);
    expect(r.reason).toContain('副露済');
    expect(shouldSkipPonForFever(g, 0)).toBe(false);
  });

  it('暗槓だけなら門前扱いで芽は残る', () => {
    const g = buildG(['m7', 'm7', ...FILLER, 'z1', 'z1']);
    g.shoupai.get(0)._fulou = ['s5555'];
    expect(evaluateFeverPotential(g, 0).hasPotential).toBe(true);
  });

  it('祝儀源も 7 も無い平手はポンを止めない', () => {
    const g = buildG([...FILLER, 'z1', 'z1', 'z6', 'z6']);
    expect(shouldSkipPonForFever(g, 0)).toBe(false);
  });
});

describe('cpuLizhi: 宣言牌とフィーバーの選択', () => {
  it('候補が空なら null を返す', () => {
    const g = buildG([...FILLER, 'z1', 'z1', 'z6', 'z6']);
    expect(pickLizhiDapai(g, 0, []).pai).toBeNull();
  });

  it('北は宣言牌候補から外す [河に切れない]', () => {
    const g = buildG([...FILLER, 'z1', 'z1', 'z6', 'z6']);
    const picked = pickLizhiDapai(g, 0, ['z4']);
    // z4 は除外され、fallback で先頭に戻る [= 実際には declareLizhi 側が弾く]
    expect(picked.waitKinds).toBe(0);
  });

  it('他家リーチが無ければ危険度は 0', () => {
    const g = buildG([...FILLER, 'z1', 'z1', 'z6', 'z6']);
    expect(dangerOf(g, 0, 'p9')).toBe(0);
  });

  it('他家リーチ中の無筋は危険、現物は安全', () => {
    const g = buildG([...FILLER, 'z1', 'z1', 'z6', 'z6']);
    g.lizhi.add(1);
    const he = g.he.get(1) as any;
    he._pai = ['p9'];
    expect(dangerOf(g, 0, 'p9')).toBe(0);   // 現物
    expect(dangerOf(g, 0, 'p8')).toBe(1);   // 無筋
  });

  it('巡目は自分の河の枚数で数える', () => {
    const g = buildG([...FILLER, 'z1', 'z1', 'z6', 'z6']);
    expect(currentTurn(g, 0)).toBe(0);
    (g.he.get(0) as any)._pai = ['p1', 'p2', 'p3'];
    expect(currentTurn(g, 0)).toBe(3);
  });

  it('tier が高ければ待ちを問わずフィーバーを取る', () => {
    const g = buildG([...FILLER, 'z1', 'z1', 'z6', 'z6']);
    const d = decideFever(g, 0, 'z6', FEVER_FORCE_TIER);
    expect(d.takeFever).toBe(true);
    expect(d.reason).toContain(`tier ${FEVER_FORCE_TIER}`);
  });

  it('全虹は tier 1 でも取る', () => {
    const g = buildG([...FILLER, 'z1', 'z1', 'z6', 'z6']);
    const d = decideFever(g, 0, 'z6', 1, { rainbow: true });
    expect(d.takeFever).toBe(true);
    expect(d.reason).toContain('全虹');
  });

  it('終盤は戻す余裕が無いので細い待ちでも取る', () => {
    const g = buildG([...FILLER, 'z1', 'z1', 'z6', 'z6']);
    (g.he.get(0) as any)._pai = new Array(FEVER_LATE_TURN).fill('p9');
    const d = decideFever(g, 0, 'z6', 1);
    expect(d.turn).toBe(FEVER_LATE_TURN);
    expect(d.takeFever).toBe(true);
    expect(d.reason).toContain('戻す余裕が無い');
  });
});
