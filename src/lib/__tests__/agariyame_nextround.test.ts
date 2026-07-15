import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import type { PlayerId } from '../types';

// canAgariyame / agariyame / nextRound の遷移を unit 固定。
// nextRound: 親アガリ → 連荘 benbang+1、 子アガリ → jushu+1 親移動、 jushu wrap で changbang+1
// 返り東: changbang > changshu-1 且つ 全員 40000 未達 → 東 1 巻き戻し

describe('Game3 canAgariyame', () => {
  // 2026-05-14 codex review fix: canAgariyame は currentOya = (qijia - jushu) % 3 で判定
  // 旧 test は state.qijia 固定基準で encode してたが、 現親 = jushu 進行後の親を見る fix で更新
  it('オーラス [最終 changbang + jushu=2] + 現親アガリ で true', () => {
    const g = new Game3({ qijia: 0, changshu: 1 });
    g.qipai();
    g.state.changbang = 0; // changshu-1 = 0
    g.state.jushu = 2;
    g.state.defen = { 0: 30000, 1: 40000, 2: 30000 };
    // qijia=0, jushu=2 → currentOya = (0-2+3)%3 = 1
    expect(g.canAgariyame(1 as PlayerId)).toBe(true);
  });

  it('オーラス親でも40000点未満、またはトップでなければ不可', () => {
    const g = new Game3({ qijia: 0, changshu: 1 });
    g.qipai();
    g.state.changbang = 0;
    g.state.jushu = 2;
    g.state.defen = { 0: 35000, 1: 39900, 2: 35100 };
    expect(g.canAgariyame(1 as PlayerId)).toBe(false);
    g.state.defen = { 0: 41000, 1: 40000, 2: 19000 };
    expect(g.canAgariyame(1 as PlayerId)).toBe(false);
  });

  it('子アガリは false [現親判断 のみ]', () => {
    const g = new Game3({ qijia: 0, changshu: 1 });
    g.qipai();
    g.state.changbang = 0;
    g.state.jushu = 2;
    // currentOya = 1、 0 と 2 は子
    expect(g.canAgariyame(0 as PlayerId)).toBe(false);
    expect(g.canAgariyame(2 as PlayerId)).toBe(false);
  });

  it('オーラスじゃない [jushu < 2] なら false', () => {
    const g = new Game3({ qijia: 0, changshu: 1 });
    g.qipai();
    g.state.changbang = 0;
    g.state.jushu = 0;
    // jushu=0 で currentOya=0、 player=0 渡しても jushu 条件で false
    expect(g.canAgariyame(0 as PlayerId)).toBe(false);
  });

  it('changbang < changshu-1 [複数 場 残ってる] なら false', () => {
    const g = new Game3({ qijia: 0, changshu: 2 });
    g.qipai();
    g.state.changbang = 0; // changshu-1 = 1、 まだ場残り
    g.state.jushu = 2;
    expect(g.canAgariyame(0 as PlayerId)).toBe(false);
  });
});

describe('Game3 agariyame', () => {
  it('state.finished = true + pingju event 記録', () => {
    const g = new Game3();
    g.qipai();
    expect(g.state.finished).toBe(false);
    g.agariyame();
    expect(g.state.finished).toBe(true);
    expect(g.events.some((e: any) => e.type === 'pingju' && /アガリ止め/.test(e.reason ?? ''))).toBe(true);
  });
});

describe('Game3 nextRound', () => {
  it('親アガリ で benbang +1 [連荘]', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    g.state.jushu = 0;
    g.state.benbang = 0;
    g.nextRound({ winner: 0 as PlayerId });
    expect(g.state.benbang).toBe(1);
    expect(g.state.jushu).toBe(0);
  });

  it('子アガリ で jushu +1 / benbang reset', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    g.state.jushu = 0;
    g.state.benbang = 2;
    g.nextRound({ winner: 1 as PlayerId });
    expect(g.state.jushu).toBe(1);
    expect(g.state.benbang).toBe(0);
  });

  it('jushu wrap [3→0] で changbang +1', () => {
    const g = new Game3({ qijia: 0, changshu: 2 });
    g.qipai();
    g.state.changbang = 0;
    g.state.jushu = 2;
    g.state.benbang = 0;
    // qijia=0, jushu=2 → currentOya = (0-2)%3 = 1、 winner=2 [子]
    g.nextRound({ winner: 2 as PlayerId });
    expect(g.state.jushu).toBe(0);
    expect(g.state.changbang).toBe(1);
  });

  it('renchan=true で 子でも 連荘 [benbang +1]', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    g.state.jushu = 0;
    g.state.benbang = 0;
    g.nextRound({ winner: 1 as PlayerId, renchan: true });
    expect(g.state.benbang).toBe(1);
    expect(g.state.jushu).toBe(0);
  });

  it('winner 未指定 [流局] で benbang +1 / jushu 変化なし', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    g.state.jushu = 1;
    g.state.benbang = 0;
    g.nextRound({});
    expect(g.state.benbang).toBe(1);
    expect(g.state.jushu).toBe(1);
  });

  it('返り東: changshu 完了 + 全員 40000 未達 で 東 1 巻き戻し', () => {
    const g = new Game3({ qijia: 0, changshu: 1 });
    g.qipai();
    g.state.changbang = 0;
    g.state.jushu = 2;
    g.state.benbang = 0;
    g.state.defen = { 0: 30000, 1: 35000, 2: 35000 };
    // qijia=0, jushu=2 → currentOya=1、 winner=2 [子] で jushu wrap
    g.nextRound({ winner: 2 as PlayerId });
    // jushu 2 → wrap で jushu=0 + changbang=1、 changbang > changshu-1=0 で 返り東 trigger
    expect(g.state.jushu).toBe(0);
    expect(g.state.changbang).toBe(0); // 巻き戻し済
    expect(g.events.some((e: any) => e.type === 'pingju' && /返り東/.test(e.reason ?? ''))).toBe(true);
  });

  it('返り東 NG: トップが 40000 到達してれば 巻き戻ししない', () => {
    const g = new Game3({ qijia: 0, changshu: 1 });
    g.qipai();
    g.state.changbang = 0;
    g.state.jushu = 2;
    g.state.benbang = 0;
    g.state.defen = { 0: 45000, 1: 30000, 2: 25000 };
    g.nextRound({ winner: 2 as PlayerId });
    expect(g.state.changbang).toBe(1); // 巻き戻しナシ
  });
});
