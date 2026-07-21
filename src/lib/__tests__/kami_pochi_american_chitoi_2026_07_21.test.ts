// 2026-07-21 リョー報告 [結果画面+dump添付]: アメリカ七対子 [西4枚使い] のリーチツモで
// 裏ドラ表示に緑の正ぽっち [z5g] が出ていたのに、神ぽっち扱いされず裏0だった。
// 原因: アメリカ七対子 fallback は majiang-core を bypass してドラを手動カウントするが、
// 神ぽっち選択 [kamiPochiDoraChoices] を見ずに素の z5 として数えていた。
// 後段の神ぽっち再計算は Majiang.Util.hule 再実行のためアメリカ形で必ず失敗し、静かに skip。
// 実局面の再現: 手牌 [赤5p,5p / 7p,7p / 8p,8p / 2s,2s / 西×4 / 中,中] ツモ7p、
// 裏表示 [s4, z5g]、神ぽっち選択=西 → 裏ドラ4 [西4枚] が付くことを固定する。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

describe('神ぽっち [裏の正ぽっち] × アメリカ七対子', () => {
  beforeEach(() => { game.reset(); });

  it('裏表示の緑正ぽっちに神ぽっち選択 [西] で裏ドラ4が付く', () => {
    const s: any = get(game);
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    s.game.shoupai.set(cur, buildShoupai([
      'p0', 'p5',
      'p7', 'p8', 'p8',
      's2', 's2',
      'z3', 'z3', 'z3', 'z3',
      'z7', 'z7',
    ]));
    (s.game.shoupai.get(cur) as any).zimo('p7');
    s.game.diyizimo = false;
    s.game.lizhi.add(cur);
    s.game.shan.setBaopai(['s9', 'p3'], ['s4', 'z5g']);
    // 神ぽっち選択: fubaopai の2枠目 [index 1] を西に
    s.game.kamiPochiDoraChoices[cur]['fubaopai:1'] = 'z3';

    const result = s.game.hule(cur, null, null);
    expect(result).toBeTruthy();
    const names = (result.hupai ?? []).map((h: any) => String(h.name));
    expect(names.some((n: string) => n.startsWith('アメリカ七対子'))).toBe(true);
    const ura = (result.hupai ?? []).find((h: any) => h.name === '裏ドラ');
    expect(ura?.fanshu).toBe(4);
    expect(names.some((n: string) => n.startsWith('神ぽっち'))).toBe(true);
  });

  it('神ぽっち未選択なら従来どおり [素のz5表示扱いで裏は付かない]', () => {
    const s: any = get(game);
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    s.game.shoupai.set(cur, buildShoupai([
      'p0', 'p5',
      'p7', 'p8', 'p8',
      's2', 's2',
      'z3', 'z3', 'z3', 'z3',
      'z7', 'z7',
    ]));
    (s.game.shoupai.get(cur) as any).zimo('p7');
    s.game.diyizimo = false;
    s.game.lizhi.add(cur);
    s.game.shan.setBaopai(['s9', 'p3'], ['s4', 'z5g']);

    const result = s.game.hule(cur, null, null);
    expect(result).toBeTruthy();
    const ura = (result.hupai ?? []).find((h: any) => h.name === '裏ドラ');
    // z5表示のドラは z6 [發]、手に無いので裏なし
    expect(ura).toBeUndefined();
    const names = (result.hupai ?? []).map((h: any) => String(h.name));
    expect(names.some((n: string) => n.startsWith('神ぽっち'))).toBe(false);
  });
});
