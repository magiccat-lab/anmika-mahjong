// 2026-10-27 リョー「冬保留→強化で冬冬金北触ったら多分適用に失敗してる。
// 気持ちとしては冬冬金北使って１回目で辞める気だったんだけど」。
// フィーバー中の冬は使わない限り効かない [huleChip] ので、冬を保留した後に金北の強化先を冬にしたら
// 冬を使う。自動選択 [isFeverPayAuto] の「冬冬 / 冬 → 直ちに冬実行」と同じ。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

function armFeverKinpeiTsumo(): any {
  const s: any = get(game);
  const g = s.game;
  const cur = g.lunbanToPlayerId(g.state.lunban);
  g.huapai[cur] = ['f4'];
  g.nukidoraGold[cur] = 1;
  g.lizhi.add(cur);
  g.feverActive[cur] = true;
  g.feverDeclareTing[cur] = ['m5'];
  const sp = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z1', 'z1', 'm5']);
  sp.zimo('m5');
  g.shoupai.set(cur, sp);
  s.lastZimo = 'm5';
  (g.shan as any)._pai.push('m5', 'm3', 's5', 'p8', 'z2');
  return { g, cur };
}

describe('フィーバー中に冬を保留して金北の強化先を冬にしたら冬を使う', () => {
  beforeEach(() => { game.reset(); });

  it('冬 保留 → 金北 冬: 冬を使い、冬冬の効果が乗る', () => {
    const { cur } = armFeverKinpeiTsumo();
    game.tsumo();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const st: any = get(game);
      if (st.pendingFuyu) { seen.push('fuyu'); game.selectFuyu(false); continue; }
      if (st.pendingKinpei) { seen.push('kinpei'); game.selectKinpei('fuyu'); continue; }
      break;
    }
    expect(seen).toEqual(['fuyu', 'kinpei']);
    const done: any = get(game);
    expect(done.game.fuyuConsumed[cur]).toBe(true);
    expect(done.game.kinpeiTarget[cur]).toBe('fuyu');
    // 冬のめくりが走り [fuyuLog]、めくり切ってフィーバーが終わる
    expect(done.lastHuleResult?.fuyuLog).toBeTruthy();
    expect(done.game.feverActive[cur]).toBe(false);
  });

  it('冬 保留 → 金北 秋: 冬は保留のまま', () => {
    const { cur } = armFeverKinpeiTsumo();
    game.tsumo();
    for (let i = 0; i < 6; i++) {
      const st: any = get(game);
      if (st.pendingFuyu) { game.selectFuyu(false); continue; }
      if (st.pendingKinpei) { game.selectKinpei('aki'); continue; }
      break;
    }
    const done: any = get(game);
    expect(done.game.fuyuConsumed[cur]).toBe(false);
    expect(done.lastHuleResult?.fuyuLog ?? null).toBeNull();
    expect(done.game.feverActive[cur]).toBe(true);
  });
});
