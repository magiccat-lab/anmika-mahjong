// 2026-07-22 リョー報告: CPU がダブフィを打ってこなかった [牌譜 stuck_1784705161533.json]
// P1 宣言時手牌 [dump 再構築]: ns3 p2 p4 p777 p8 s2 s4 s777 s99 + ツモ s9
// p8 切りで p3 嵌張テンパイ、p777 + s777 の 2 種暗刻 = ダブフィ [tier 2] 適格なのに
// fever なしのシュバ単体リーチが宣言された。
// 対策: FEVER_FORCE_TIER 3→2 [ダブフィ以上は待ち・巡目・待ち計算の劣化に関係なく取る]
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import { decideFever, FEVER_FORCE_TIER } from '../store/cpuLizhi';

function gameWithIncidentHand(): { g: Game3; p: any } {
  const g = new Game3();
  const p = g.lunbanToPlayerId(g.state.lunban);
  const sp = buildShoupai(['p2','p4','p7','p7','p7','p8','s2','s4','s7','s7','s7','s9','ns3']);
  (sp as any).zimo('s9');
  g.shoupai.set(p, sp as any);
  return { g, p };
}

describe('ダブフィ検知 [2026-07-22 dump 再現]', () => {
  it('canFeverLizhi が tier 2 を返す', () => {
    const { g, p } = gameWithIncidentHand();
    const fc = g.canFeverLizhi(p);
    expect(fc.ok).toBe(true);
    expect(fc.tier).toBe(2);
  });

  it('p8 切りがフィーバー候補とリーチ候補の両方に入る', () => {
    const { g, p } = gameWithIncidentHand();
    const feverKeys = [...g.feverCandidatesByDapai(p).keys()].map((k) => k.replace(/[_*]$/, ''));
    expect(feverKeys).toContain('p8');
    const lizhiCands = g.getLizhiCandidates(p).map((k) => k.replace(/[_*]$/, ''));
    expect(lizhiCands).toContain('p8');
  });

  it('decideFever が tier 2 を取る [事故手そのもの]', () => {
    const { g, p } = gameWithIncidentHand();
    const map = g.feverCandidatesByDapai(p);
    const key = [...map.keys()].find((k) => k.replace(/[_*]$/, '') === 'p8')!;
    const fc = map.get(key)!;
    const fd = decideFever(g, p, key, fc.tier, { rainbow: fc.rainbow });
    expect(fd.takeFever).toBe(true);
  });

  it('tier 2 は待ち計算が劣化していても取る [FORCE_TIER 契約]', () => {
    const { g, p } = gameWithIncidentHand();
    expect(FEVER_FORCE_TIER).toBe(2);
    // 不正な宣言牌 = handAfterDiscard が null になり待ち 0 扱いになる経路。
    // tier gate が待ち計算より先に効くこと [劣化時にダブフィを見送らない]
    const fd = decideFever(g, p, 'z9', 2);
    expect(fd.takeFever).toBe(true);
  });

  it('declareLizhi(fever) が現手番 player で成立し feverTier=2', () => {
    const { g, p } = gameWithIncidentHand();
    const map = g.feverCandidatesByDapai(p);
    const key = [...map.keys()].find((k) => k.replace(/[_*]$/, '') === 'p8')!;
    const fc = map.get(key)!;
    const ok = g.declareLizhi({ fever: true, feverCheck: fc, feverDapai: key });
    expect(ok).toBe(true);
    expect(g.feverActive[p]).toBe(true);
    expect(g.feverTier[p]).toBe(2);
  });
});
