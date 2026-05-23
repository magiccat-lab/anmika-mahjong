import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import type { PlayerId } from '../types';

// 風牌 getter [changfengZ / zifengZ] の挙動 固定
// CPU pon 風牌 strategy [21c984b] が依存、 この getter 壊れると 自風 / 場風
// 一致判定が崩れて CPU が役無しタダ鳴き or 役牌取り逃しになる。

describe('Game3 changfengZ', () => {
  it('changbang=0 [東 1局] で 1 [東 z1]', () => {
    const g = new Game3();
    g.state.changbang = 0;
    expect(g.changfengZ).toBe(1);
  });
  it('changbang=1 で 2 [南 z2]', () => {
    const g = new Game3();
    g.state.changbang = 1;
    expect(g.changfengZ).toBe(2);
  });
  it('changbang=3 で 3 cap [西 z3、 三麻なので 西 で打ち止め]', () => {
    const g = new Game3();
    g.state.changbang = 3;
    expect(g.changfengZ).toBe(3);
  });
});

describe('Game3 zifengZ [起家からの 反時計回り]', () => {
  it('qijia=0 で zifengZ(0)=1 [東]、 zifengZ(1)=2 [南]、 zifengZ(2)=3 [西]', () => {
    const g = new Game3({ qijia: 0 });
    expect(g.zifengZ(0 as PlayerId)).toBe(1);
    expect(g.zifengZ(1 as PlayerId)).toBe(2);
    expect(g.zifengZ(2 as PlayerId)).toBe(3);
  });
  it('qijia=1 で zifengZ(1)=1、 zifengZ(2)=2、 zifengZ(0)=3', () => {
    const g = new Game3({ qijia: 1 });
    expect(g.zifengZ(1 as PlayerId)).toBe(1);
    expect(g.zifengZ(2 as PlayerId)).toBe(2);
    expect(g.zifengZ(0 as PlayerId)).toBe(3);
  });
  it('qijia=2 で zifengZ(2)=1、 zifengZ(0)=2、 zifengZ(1)=3', () => {
    const g = new Game3({ qijia: 2 });
    expect(g.zifengZ(2 as PlayerId)).toBe(1);
    expect(g.zifengZ(0 as PlayerId)).toBe(2);
    expect(g.zifengZ(1 as PlayerId)).toBe(3);
  });
});
