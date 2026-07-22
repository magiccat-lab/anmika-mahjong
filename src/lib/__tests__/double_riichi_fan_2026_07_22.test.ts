// 2026-07-22 リョー報告: ダブリーが2翻になってる [アンミカ規定は4翻]。
// majiang-core の実役名は「ダブル立直」で、旧補正は「両立直」を探して空振りしていた。
import { it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';

it('ダブリーは4翻に補正される', () => {
  const g = new Game3();
  g.qipai();
  const sp = buildShoupai(['p2','p2','p3','p4','p5','p3','p4','p5','s6','s7','s8','s6','s7']);
  (sp as any).zimo('s8');
  g.shoupai.set(0 as any, sp as any);
  g.lizhi.add(0 as any);
  g.doubleLizhi.add(0 as any);
  (g as any).firstTurnState.players[0].hasDiscarded = true;
  g.huapai[0 as any] = [];
  (g.shan as any)._baopai = ['m9'];
  (g.shan as any)._fubaopai = ['m9'];
  const res: any = g.hule(0 as any);
  expect(res).toBeTruthy();
  const dbl = res.hupai.find((h: any) => h.name === 'ダブリー');
  expect(dbl?.fanshu).toBe(4);
  expect(res.hupai.some((h: any) => String(h.name).includes('ダブル立直'))).toBe(false);
});
