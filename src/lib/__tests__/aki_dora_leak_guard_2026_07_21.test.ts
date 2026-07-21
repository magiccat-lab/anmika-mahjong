// 2026-07-21 リョー報告「手牌で秋抜いたときとかにドラ表示が見えちゃう」の再発ガード。
// 投機的な和了計算 [canTsumo / canRon / テンパイ系] が秋カスケードの物理ドラめくりを
// 巻き戻し損ねると、局中にドラ表示牌が増えて見える [2026-07-17 / 07-20 に実例]。
// UI のreactiveが叩く判定一式の前後で shan [山・表ドラ・裏ドラ] が完全不変なことを固定する。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

function shanFingerprint(g: any) {
  return JSON.stringify({
    baopai: [...g.shan.baopai],
    fubaopai: [...(g.shan.fubaopai ?? [])],
    paishu: g.shan.paishu,
    pai: [...(g.shan as any)._pai],
  });
}

describe('秋持ちテンパイでのUI判定呼び出しがshanを動かさないか', () => {
  beforeEach(() => { game.reset(); });

  it('canTsumo/tingpai系の投機評価前後でshan不変', () => {
    const s: any = get(game);
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    s.game.huapai[cur].push('f3', 'f3');
    s.game.shoupai.set(cur, buildShoupai([
      'p2', 'p3', 'p4',
      'p5', 'p6', 'p7',
      's2', 's3', 's4',
      's5', 's6',
      'm2', 'm2',
    ]));
    s.game.diyizimo = false;
    s.game.lizhi.add(cur);
    (s.game.shoupai.get(cur) as any).zimo('s7');
    s.lastZimo = 's7';

    const before = shanFingerprint(s.game);
    const ct = s.game.canTsumo(cur);
    s.game.getTingpaiList(cur);
    s.game.xiangting(cur);
    try { s.game.canLizhi(cur); } catch {}
    try { s.game.getKanCandidates(cur); } catch {}
    const after = shanFingerprint(s.game);

    expect(ct).toBe(true);
    expect(after).toBe(before);
  });

  it('ron候補判定 canRon 前後でもshan不変', () => {
    const s: any = get(game);
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    const opp = ((cur + 1) % 3) as any;
    s.game.huapai[opp].push('f3');
    s.game.shoupai.set(opp, buildShoupai([
      'p2', 'p3', 'p4',
      'p5', 'p6', 'p7',
      's2', 's3', 's4',
      's5', 's6',
      'm2', 'm2',
    ]));
    s.game.diyizimo = false;
    s.game.lizhi.add(opp);
    const before = shanFingerprint(s.game);
    const cr = s.game.canRon(opp, 's7-', cur);
    const after = shanFingerprint(s.game);
    expect(cr).toBe(true);
    expect(after).toBe(before);
  });
});
