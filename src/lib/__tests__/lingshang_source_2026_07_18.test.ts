import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';

// 2026-07-18 リョー裁定: 嶺上開花はカン補充のツモ和了のみ。
// 北抜き・華抜きの補充ツモには付かない。
// lingshangActive [海底摸月の抑制] は北・華でも従来どおり立てる。
describe('嶺上開花はカン補充のみ [2026-07-18 裁定]', () => {
  it('北抜きの補充ツモ和了に嶺上開花が付かない [海底摸月の抑制は維持]', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    const player = g.lunbanToPlayerId(g.state.lunban);
    // 13枚 [z4含む] → 通常ツモ m2 → 北抜きで z4 が抜け m2 が手牌へ →
    // 補充 s9 で 234p567p123s789s + m2m2 のツモ和了形
    const sp = buildShoupai([
      'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's1', 's2', 's3', 's7', 's8', 'm2', 'z4',
    ]);
    g.shoupai.set(player, sp);
    (g.shan as any)._pai = ['m2'];
    (g.shan as any)._rinshan = ['s9'];
    expect(g.zimo()).toBe('m2');
    expect(g.shan.paishu).toBe(0);

    const replacement = g.declareNukiBei(player);

    expect(replacement).toBe('s9');
    expect(g.lingshangActive[player]).toBe(true);
    expect(g.lingshangFromKan[player]).toBe(false);
    g.lizhi.add(player); // 面前ダマ禁止 rule を回避 [検証対象は嶺上開花の有無]
    const result = g.hule(player);
    expect(result).toBeTruthy();
    const names = result.hupai.map((h: any) => h.name);
    expect(names).toContain('門前清自摸和');
    expect(names).not.toContain('嶺上開花');
    // 山0枚でも補充牌ツモは海底摸月にならない [従来どおり]
    expect(names).not.toContain('海底摸月');
  });

  it('暗槓の補充ツモ和了には嶺上開花が付く [従来どおり]', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    const player = g.lunbanToPlayerId(g.state.lunban);
    // m7 暗槓 → 補充 s9 で 暗槓 + 234p123s789s + m2m2 のツモ和了形
    const sp = buildShoupai([
      'm7', 'm7', 'm7', 'm7', 'p2', 'p3', 'p4', 's1', 's2', 's3', 's7', 's8', 'm2',
    ]);
    sp.zimo('m2');
    g.shoupai.set(player, sp);
    (g.shan as any)._rinshan = ['s9'];

    const replacement = g.declareKan(player, 'm7777');

    expect(replacement).toBe('s9');
    expect(g.lingshangActive[player]).toBe(true);
    expect(g.lingshangFromKan[player]).toBe(true);
    g.lizhi.add(player); // 面前ダマ禁止 rule を回避 [検証対象は嶺上開花の有無]
    const result = g.hule(player);
    expect(result).toBeTruthy();
    const names = result.hupai.map((h: any) => h.name);
    expect(names).toContain('嶺上開花');
  });

  it('華抜きの補充ツモも嶺上開花の対象外 [flag のみ検証]', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    g.huapai[player] = [];
    (g.shan as any)._pai = ['f1'];
    (g.shan as any)._rinshan = ['s9'];

    expect(g.zimo()).toBe('s9');

    expect(g.lingshangActive[player]).toBe(true);
    expect(g.lingshangFromKan[player]).toBe(false);
  });
});
