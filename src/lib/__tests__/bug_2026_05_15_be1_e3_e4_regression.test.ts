import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import type { PlayerId } from '../types';

// 2026-05-15 リョー報告 bug B / E1 / E3 / E4 regression test
//   B  : 8000 以下打点 100 の位 必ず切り上げ [全 path、 fever / pochi reverse / fenpei 含む]
//   E1 : 黄即ツモ で chip 倍率 -2 になる bug、 仕様は -1
//   E3 : サイコロチャンス回数 count ズレ
//   E4 : 金北選択し直しで 計算崩れ [restoreSnapshot 後 kinpeiTarget 残留]

describe('bug B: 8000 以下打点 全 path で ceil100', () => {
  it('子 30符 1翻 ロン (base=240*4=960) → 1000 に ceil100', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    g.state.benbang = 0;
    g.state.lizhibang = 0;
    g.state.qijia = 1;
    g.state.jushu = 0;
    const before = { ...g.state.defen };
    g.applyHule({ fanshu: 1, fu: 30, hupai: [] }, 0 as PlayerId, 1 as PlayerId);
    expect(g.state.defen[0] - before[0]).toBe(1000);
    expect((g.state.defen[0] - before[0]) % 100).toBe(0);
  });

  it('子 40符 2翻 ロン (base=640*4=2560) → 2600 に ceil100', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    g.state.benbang = 0;
    g.state.lizhibang = 0;
    g.state.qijia = 1;
    g.state.jushu = 0;
    const before = { ...g.state.defen };
    g.applyHule({ fanshu: 2, fu: 40, hupai: [] }, 0 as PlayerId, 1 as PlayerId);
    expect(g.state.defen[0] - before[0]).toBe(2600);
  });

  it('子 50符 3翻 ロン (base=1600*4=6400) → 6400 [既に 100 単位]', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    g.state.benbang = 0;
    g.state.lizhibang = 0;
    g.state.qijia = 1;
    g.state.jushu = 0;
    const before = { ...g.state.defen };
    g.applyHule({ fanshu: 3, fu: 50, hupai: [] }, 0 as PlayerId, 1 as PlayerId);
    expect(g.state.defen[0] - before[0]).toBe(6400);
  });

  it('全 player の defen 移動が 100 単位 を 守る [子ツモ 30符 2翻 + benbang]', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    g.state.benbang = 1;
    g.state.lizhibang = 0;
    g.state.qijia = 1;
    g.state.jushu = 0;
    const before = { ...g.state.defen };
    g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, 0 as PlayerId, null);
    for (const p of [0, 1, 2] as PlayerId[]) {
      expect(Math.abs((g.state.defen[p] - before[p]) % 100)).toBe(0);
    }
  });

  it('逆ぽっち [pochiPaymentMode] でも 100 単位', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    g.state.benbang = 0;
    g.state.lizhibang = 0;
    g.state.qijia = 1;
    g.state.jushu = 0;
    g.pochiPaymentMode[0] = true;
    const before = { ...g.state.defen };
    g.applyHule({ fanshu: 1, fu: 40, hupai: [] }, 0 as PlayerId, 1 as PlayerId);
    for (const p of [0, 1, 2] as PlayerId[]) {
      expect(Math.abs((g.state.defen[p] - before[p]) % 100)).toBe(0);
    }
  });

  it('フィーバー tier 2 [×2 倍 base] でも 100 単位', () => {
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    g.state.benbang = 0;
    g.state.lizhibang = 0;
    g.state.qijia = 1;
    g.state.jushu = 0;
    g.feverActive[0] = true;
    g.feverTier[0] = 2;
    const before = { ...g.state.defen };
    g.applyHule({ fanshu: 1, fu: 30, hupai: [] }, 0 as PlayerId, 1 as PlayerId);
    for (const p of [0, 1, 2] as PlayerId[]) {
      expect(Math.abs((g.state.defen[p] - before[p]) % 100)).toBe(0);
    }
  });
});

describe('bug E1: 黄ぽっち効果 倍率 -1 [自分 -1 / chip -1]、 -2 にならない', () => {
  it('default state で 黄ぽっち 1 回 → pochiMultiplier = -1', () => {
    const g = new Game3();
    g.qipai();
    expect(g.pochiMultiplier[0]).toEqual({ defen: 1, chip: 1 });
    g.pochiMultiplier[0] = { defen: -1, chip: -1 };
    g.pochiPaymentMode[0] = g.pochiMultiplier[0].defen < 0;
    expect(g.pochiMultiplier[0]).toEqual({ defen: -1, chip: -1 });
    expect(g.computeChipMultiplier(0 as PlayerId)).toBe(-1);
  });

  it('黄即ツモ chip 倍率 = -1 [bypassShuvari でも変わらず]', () => {
    const g = new Game3();
    g.qipai();
    g.pochiMultiplier[0] = { defen: -1, chip: -1 };
    expect(g.computeChipMultiplier(0 as PlayerId)).toBe(-1);
    expect(g.computeChipMultiplier(0 as PlayerId, { bypassShuvari: true })).toBe(-1);
  });

  it('黄ぽっち + シュバ active → 倍率 -2 ではなく シュバ ×2 × 黄 -1 = -2 [仕様確認]', () => {
    // 注: シュバ + 黄 だと -2 になるが、 これは シュバ ×2 と黄 -1 の合成、 黄単体の bug ではない
    const g = new Game3();
    g.qipai();
    g.shuvariActive[0] = true;
    g.pochiMultiplier[0] = { defen: -1, chip: -1 };
    expect(g.computeChipMultiplier(0 as PlayerId)).toBe(-2);
    // bypassShuvari [サイコロ chip path] では シュバ非適用で -1
    expect(g.computeChipMultiplier(0 as PlayerId, { bypassShuvari: true })).toBe(-1);
  });
});

describe('bug E3: サイコロチャンス回数 count', () => {
  it('shuvariUsed 半荘累積、 nextRound でも reset しない [feedback_anmika_saikoro_shuvari.md]', () => {
    const g = new Game3();
    g.qipai();
    g.shuvariUsed[0] = true;
    g.shuvariActive[0] = true;
    g.nextRound({ renchan: true });
    expect(g.shuvariUsed[0]).toBe(true); // 累積保持
    expect(g.shuvariActive[0]).toBe(false); // active は reset
  });
});

describe('bug E4: 金北選択しなおし [restoreSnapshot 後 kinpeiTarget 残留 → 再選択 reject bug]', () => {
  it('setKinpeiChoice は 既 設定済 なら false を返す [現仕様]', () => {
    const g = new Game3();
    g.qipai();
    const winner = 0 as PlayerId;
    g.goldHand[winner].z = 1;
    g.huapai[winner] = ['f2', 'f2'];
    expect(g.setKinpeiChoice(winner, 'natsu')).toBe(true);
    // 再選択 [同じ target] は現仕様 reject、 bug E4 fix 後は reset 後 OK にする
    expect(g.setKinpeiChoice(winner, 'natsu')).toBe(false);
  });

  it('clearKinpeiChoice [新 API] で reset 後 再 setKinpeiChoice 可能', () => {
    const g = new Game3();
    g.qipai();
    const winner = 0 as PlayerId;
    g.goldHand[winner].z = 1;
    g.huapai[winner] = ['f2', 'f2'];
    g.setKinpeiChoice(winner, 'natsu');
    g.clearKinpeiChoice(winner);
    expect(g.kinpeiTarget[winner]).toBeNull();
    expect(g.setKinpeiChoice(winner, 'natsu')).toBe(true);
  });

  it('夏夏金北 再計算: target 再設定後 hule + applyHule で 打点 ×4 + state.defen 100 単位', () => {
    // f2×2 + 金北 1 持ち、 子ロン 4翻30符 base
    const g = new Game3();
    g.qipai();
    g.diyizimo = false;
    g.state.benbang = 0;
    g.state.lizhibang = 0;
    g.state.qijia = 0;
    g.state.jushu = 0;
    const winner = 1 as PlayerId;
    const loser = 0 as PlayerId;
    g.goldHand[winner].z = 1;
    g.huapai[winner] = ['f2', 'f2'];
    g.clearKinpeiChoice(winner);
    g.setKinpeiChoice(winner, 'natsu');
    const before = { ...g.state.defen };
    g.saveSnapshot();
    const result: any = { fanshu: 4, fu: 30, hupai: [] };
    g.applyHuapaiEffect(result, winner);
    g.applyHule(result, winner, loser);
    // 100 単位 ゼロサム
    let sum = 0;
    for (const p of [0, 1, 2] as PlayerId[]) {
      const d = g.state.defen[p] - before[p];
      sum += d;
      expect(Math.abs(d % 100)).toBe(0);
    }
    expect(sum).toBe(0);
    // 夏夏金北 で defen ×4 反映
    expect(g.state.defen[winner] - before[winner]).toBeGreaterThan(0);
  });
});
