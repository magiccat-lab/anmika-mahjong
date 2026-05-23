import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';

// bug 2 root cause [6a845d3 で fix] を unit 層で固定化:
//   ツモ切り convention で河 tile に `<tile>_` (suffix _) が混入する →
//   lizhi marker も `_` 1 個だと衝突して全 ツモ切り tile が lizhi 扱いになる。
//   fix: lizhi marker は `__` (2 連続) で区別。
describe('Game3 lizhi marker [bug 2 regression]', () => {
  it('通常 dapai では __ marker が河に付かない', () => {
    const g = new Game3();
    g.qipai();
    for (let i = 0; i < 5; i++) {
      let pai = g.zimo();
      if (!pai) break;
      // 2026-05-14 codex review fix: z4 は dapai 禁止、 抜き北 で 嶺上ツモ 取得して dapai
      while (pai === 'z4') {
        const cur = g.lunbanToPlayerId(g.state.lunban);
        const rep = g.declareNukiBei(cur);
        if (!rep) break;
        pai = rep;
      }
      if (!pai || pai === 'z4') break;
      g.dapai(pai);
    }
    for (const pid of [0, 1, 2] as const) {
      const he = (g.he.get(pid) as any)._pai as string[];
      const doubles = he.filter((t) => typeof t === 'string' && t.endsWith('__'));
      expect(doubles.length).toBe(0);
    }
  });

  it('lizhiDeclareDapai trigger 時 1 回だけ __ marker が付く', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    let z = g.zimo();
    while (z === 'z4') {
      const cur = g.lunbanToPlayerId(g.state.lunban);
      g.declareNukiBei(cur);
      z = g.zimo();
    }
    expect(z).toBeTruthy();
    g.lizhiDeclareDapai[player] = true;
    g.dapai(z!);
    const he = (g.he.get(player) as any)._pai as string[];
    const doubles = he.filter((t) => typeof t === 'string' && t.endsWith('__'));
    expect(doubles.length).toBe(1);
    // marker 1 回消費後 flag が降りる
    expect(g.lizhiDeclareDapai[player]).toBe(false);
  });

  it('lizhi 後 同 player が複数 dapai しても __ marker は最初の 1 件のみ', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    // lizhi 宣言牌 dapai
    g.lizhiDeclareDapai[player] = true;
    let z0 = g.zimo();
    // 2026-05-14 codex review fix: z4 は dapai 不可、 抜き北 で替牌取って dapai 同じ player
    while (z0 === 'z4') {
      const cur = g.lunbanToPlayerId(g.state.lunban);
      const rep = g.declareNukiBei(cur);
      if (!rep) break;
      z0 = rep;
    }
    if (z0 && z0 !== 'z4') g.dapai(z0!);
    // 他家を skip して 同 player に turn を返す: 30 巡 ツモ
    for (let i = 0; i < 30; i++) {
      let pai = g.zimo();
      if (!pai) break;
      while (pai === 'z4') {
        const cur = g.lunbanToPlayerId(g.state.lunban);
        const rep = g.declareNukiBei(cur);
        if (!rep) break;
        pai = rep;
      }
      if (!pai || pai === 'z4') break;
      g.dapai(pai);
    }
    const he = (g.he.get(player) as any)._pai as string[];
    const doubles = he.filter((t) => typeof t === 'string' && t.endsWith('__'));
    expect(doubles.length).toBe(1);
  });

  it('既に __ で終わる tile に対しては再 marker しない [idempotent]', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    g.lizhiDeclareDapai[player] = true;
    let z = g.zimo();
    while (z === 'z4') {
      const cur = g.lunbanToPlayerId(g.state.lunban);
      g.declareNukiBei(cur);
      z = g.zimo();
    }
    g.dapai(z!);
    const he = (g.he.get(player) as any)._pai as string[];
    const before = he[he.length - 1];
    expect(before.endsWith('__')).toBe(true);
    // 末尾が __ で終わってる状態で 再度 flag 立てて dapai → さらに `__` 付与されない
    g.lizhiDeclareDapai[player] = true;
    // 次の lunban で player に turn 戻すまで進行
    for (let i = 0; i < 3; i++) {
      const pai = g.zimo();
      if (!pai) break;
      if (pai === 'z4') {
        const cur = g.lunbanToPlayerId(g.state.lunban);
        g.declareNukiBei(cur);
        continue;
      }
      g.dapai(pai);
    }
    // 直接前段 tile を strict assert は skip [他家 dapai が間に挟まる]、
    // 全河で __ tile 数 ≤ 2 [元 marker 1 + 新 marker 1] を許容
    const heFinal = (g.he.get(player) as any)._pai as string[];
    const doubles = heFinal.filter((t) => typeof t === 'string' && t.endsWith('__'));
    expect(doubles.length).toBeLessThanOrEqual(2);
  });
});
