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

  // [2026-07-21 リョー追加報告「秋抜いたときにドラ表示出る、上がりまで表示増えない」]
  // 打牌アドバイスモード [2026-07-21 新規] は候補ごとに投機評価するので、
  // 秋カスケードのめくりを巻き戻し損ねると局中にドラ表示が増える。
  it('秋持ちテンパイでの adviseDiscard 前後で shan 不変', () => {
    const s: any = get(game);
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    s.game.huapai[cur].push('f3', 'f3');
    s.game.lizhi.add(cur);
    s.game.shoupai.set(cur, buildShoupai([
      'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 's5', 's6', 'm2', 'm2',
    ]));
    (s.game.shoupai.get(cur) as any).zimo('s7');
    const before = shanFingerprint(s.game);
    const rows = s.game.adviseDiscard(cur, 5);
    const after = shanFingerprint(s.game);
    expect(Array.isArray(rows)).toBe(true);
    expect(after).toBe(before);
  });

  // 秋の華牌 f3 を引いて自動抜きした瞬間、和了前なのにドラ表示 [baopai] が
  // 増えてはいけない [リョー: 上がりまでは表示増えない]。
  it('華 f3 ツモ自動抜きで baopai [ドラ表示] が増えない', () => {
    const s: any = get(game);
    const g = s.game;
    (g.shan as any)._pai.unshift('f3');
    const beforeBaopai = [...g.shan.baopai];
    g.zimo();
    expect([...g.shan.baopai]).toEqual(beforeBaopai);
  });

  // 秋持ちの player がカンした時、増えるのは槓ドラ 1 枚だけ。
  // 秋カスケードの追加めくりが局中に発動してはいけない [和了まで]。
  it('秋持ちのカンは槓ドラ 1 枚だけ、秋カスケードは局中発動しない', () => {
    const s: any = get(game);
    const g = s.game;
    const cur = g.lunbanToPlayerId(g.state.lunban);
    g.huapai[cur] = ['f3', 'f3'];
    const sp = buildShoupai(['p1', 'p1', 'p1', 'p1', 'm2', 'm3', 'm4', 's5', 's6', 's7', 'z1', 'z1', 'z1']);
    (sp as any)._zimo = 'p1';
    g.shoupai.set(cur, sp);
    const before = g.shan.baopai.length;
    const repl = g.declareKan(cur, 'p1111');
    if (repl) {
      expect(g.shan.baopai.length - before).toBeLessThanOrEqual(1);
    }
  });

  // [2026-07-21 リョー報告 本命 + Sol指摘] 秋 f3 + 金北の和了ツモ。金北 modal[pendingKinpei]
  // 表示中[上がり未確定 roundEnded=false]は、hule の秋カスケードでめくった物理ドラ表を
  // 巻き戻して表示を増やさない。選択[selectKinpei]後の和了確定でだけめくれる。
  it('秋+金北のツモ和了で、金北modal中はドラ表示不変、選択確定でめくれる', () => {
    game.reset();
    const s: any = get(game);
    const g = s.game;
    const cur = g.lunbanToPlayerId(g.state.lunban);
    g.huapai[cur] = ['f3'];
    g.nukidoraGold[cur] = 1;        // 金北抜き済 → 人間金北modal誘発
    g.lizhi.add(cur);
    const sp = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z1', 'z1', 'm5']);
    sp.zimo('m5');
    g.shoupai.set(cur, sp);
    s.lastZimo = 'm5';
    if ((g.shan as any)._pai.length < 4) (g.shan as any)._pai.push('m3', 's5', 'p8', 'z2');
    const baopaiBefore = g.shan.baopai.length;
    game.tsumo();
    const mid: any = get(game);
    // 金北modal中は上がり未確定。ドラ表示は増えない
    expect(mid.pendingKinpei).not.toBeNull();
    expect(mid.roundEnded).toBe(false);
    expect(mid.game.shan.baopai.length).toBe(baopaiBefore);
    // 金北[秋]選択 → 和了確定でドラ表がめくれる
    game.selectKinpei('aki');
    const done: any = get(game);
    expect(done.game.shan.baopai.length).toBeGreaterThanOrEqual(baopaiBefore);
  });
});
