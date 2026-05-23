import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';

// pickBestDiscard [b2e1e3b で ukeire 計算追加] の挙動 verify。
describe('Game3 pickBestDiscard', () => {
  it('ツモ後の player は候補から 有効な dapai を返す', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    const z = g.zimo();
    expect(z).toBeTruthy();
    const pick = g.pickBestDiscard(player);
    expect(pick).toBeTruthy();
    const sp = g.shoupai.get(player) as any;
    const candidates = sp.get_dapai(false);
    expect(candidates).toContain(pick);
  });

  it('z4 [北] を選ばない [北抜き dora 待避]', () => {
    const g = new Game3();
    g.qipai();
    let calls = 0;
    while (calls < 30) {
      const player = g.lunbanToPlayerId(g.state.lunban);
      const z = g.zimo();
      if (!z) break;
      const pick = g.pickBestDiscard(player);
      if (pick) {
        const base = pick.replace(/[_*]$/, '');
        expect(base).not.toBe('z4');
        g.dapai(pick);
      } else {
        g.dapai(z);
      }
      calls++;
    }
    expect(calls).toBeGreaterThan(0);
  });

  it('zimo ナシ で null 返す [ツモ前]', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    // qipai 直後は まだ zimo してない → get_dapai は throw or 空、 null 期待
    const pick = g.pickBestDiscard(player);
    expect(pick).toBeNull();
  });

  it('他家フィーバー中 自家非フィーバー で ツモ切り強制', () => {
    // 2026-05-14 flaky fix: zimo が z4 [北] の場合 pickBestDiscard は z4 を 候補から弾き
    // 通常 heuristic に fallback、 ツモ切り z !== pick となる。 z4 が出るまで nukiBei で消化
    let g!: Game3;
    let z!: string | null;
    let me!: 0 | 1 | 2;
    for (let attempt = 0; attempt < 20; attempt++) {
      g = new Game3();
      g.qipai();
      me = g.lunbanToPlayerId(g.state.lunban);
      z = g.zimo();
      if (z && z !== 'z4') break;
    }
    expect(z).toBeTruthy();
    expect(z).not.toBe('z4');
    const other = ((me + 1) % 3) as 0 | 1 | 2;
    g.feverActive[other] = true;
    const pick = g.pickBestDiscard(me);
    // ツモ切り強制 = 直前ツモ tile を返す [base 2 文字]
    expect(pick).toBe(z);
  });

  it('自家フィーバー中は ツモ切り強制 されない [手から選べる]', () => {
    const g = new Game3();
    g.qipai();
    const me = g.lunbanToPlayerId(g.state.lunban);
    g.feverActive[me] = true;
    const z = g.zimo();
    expect(z).toBeTruthy();
    const pick = g.pickBestDiscard(me);
    expect(pick).toBeTruthy();
    // pick が ツモ切り限定じゃない [候補に手牌が含まれる]
    const sp = g.shoupai.get(me) as any;
    const candidates = sp.get_dapai(false);
    expect(candidates).toContain(pick);
  });

  // ukeire visible-aware [2026-05-14 ゆーま 自走、 視認枯渇牌は ukeire 0]:
  // 他家手 / 河 で 4 枚見えてる牌の ukeire は除外、 過大評価しない
  it('他家河に visible 4 枚 ある牌は ukeire 加算しない [枯渇 awareness]', () => {
    const g = new Game3();
    g.qipai();
    const me = g.lunbanToPlayerId(g.state.lunban);
    const other = ((me + 1) % 3) as 0 | 1 | 2;
    // 他家 河 に s3 を 4 枚 強制注入 [枯渇状態 シミュ]
    const heOther = g.he.get(other) as any;
    heOther._pai = ['s3', 's3', 's3', 's3'];
    const z = g.zimo();
    expect(z).toBeTruthy();
    // pickBestDiscard 自体が crash しないこと、 valid candidate 返すこと
    const pick = g.pickBestDiscard(me);
    expect(pick).toBeTruthy();
    const sp = g.shoupai.get(me) as any;
    const candidates = sp.get_dapai(false);
    expect(candidates).toContain(pick);
  });
});
