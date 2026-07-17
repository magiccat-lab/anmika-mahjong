import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';

// getFinalScore の uma / 8万点 bonus / トントンブー 規則 を unit 固定。
// [feedback_anmika_uma_rule] 2着 40000+ 到達 → +30/0/-30、 未達 → +45/-15/-30。
function makeEndGame(defen: { 0: number; 1: number; 2: number }, opts?: { qijia?: 0|1|2; jushu?: number; changbang?: number; tobiHule?: boolean }): Game3 {
  const g = new Game3({ qijia: opts?.qijia ?? 0 });
  g.qipai();
  g.state.defen = { ...defen };
  if (opts?.jushu != null) g.state.jushu = opts.jushu;
  if (opts?.changbang != null) g.state.changbang = opts.changbang;
  if (opts?.tobiHule) {
    // 親アガリ event 込む [トントンブー trigger]
    const oya = g.state.qijia;
    g.events.push({ type: 'hule', player: oya } as any);
  }
  return g;
}

describe('getFinalScore [ウマ規則]', () => {
  it('2着が 40000 到達 → +30 / 0 / -30', () => {
    const g = makeEndGame({ 0: 50000, 1: 40000, 2: 15000 });
    const score = g.getFinalScore();
    // ranking[0] = 1位、 ranking[2] = 3位
    expect(score[0].uma).toBe(30);
    expect(score[1].uma).toBe(0);
    expect(score[2].uma).toBe(-30);
  });

  it('2着が 40000 未達 → +45 / -15 / -30', () => {
    const g = makeEndGame({ 0: 60000, 1: 35000, 2: 10000 });
    const score = g.getFinalScore();
    expect(score[0].uma).toBe(45);
    expect(score[1].uma).toBe(-15);
    expect(score[2].uma).toBe(-30);
  });

  it('2着 ちょうど 40000 で 到達扱い [境界]', () => {
    const g = makeEndGame({ 0: 45000, 1: 40000, 2: 20000 });
    const score = g.getFinalScore();
    expect(score[0].uma).toBe(30);
    expect(score[1].uma).toBe(0);
    expect(score[2].uma).toBe(-30);
  });

  it('2着 39999 で 未達扱い [境界-1]', () => {
    const g = makeEndGame({ 0: 50001, 1: 39999, 2: 15000 });
    const score = g.getFinalScore();
    expect(score[0].uma).toBe(45);
    expect(score[1].uma).toBe(-15);
    expect(score[2].uma).toBe(-30);
  });
});

describe('getFinalScore [8万点 トップ祝儀]', () => {
  it('top 8 万未満なら topN bonus = 0', () => {
    const g = makeEndGame({ 0: 79999, 1: 30000, 2: 0 });
    const score = g.getFinalScore();
    for (const r of score) expect(r.topNBonus).toBe(0);
  });

  it('top 8 万到達で +6 オール [bonus = 2*8-10 = 6]', () => {
    const g = makeEndGame({ 0: 80000, 1: 25000, 2: 0 });
    const score = g.getFinalScore();
    // top: +12、 他: -6
    const top = score.find(r => r.rank === 1)!;
    expect(top.topNBonus).toBe(12);
    for (const r of score) if (r.rank !== 1) expect(r.topNBonus).toBe(-6);
  });

  it('top 10 万到達で +10 オール [bonus = 2*10-10 = 10]', () => {
    const g = makeEndGame({ 0: 100000, 1: 10000, 2: 0 });
    const score = g.getFinalScore();
    const top = score.find(r => r.rank === 1)!;
    expect(top.topNBonus).toBe(20);
  });
});

describe('getFinalScore [トントンブー]', () => {
  it('東 1 局 + 親アガリ + 他家トビ で トントンブー +12 / -6 / -6', () => {
    const g = makeEndGame(
      { 0: 50000, 1: -100, 2: 55100 },
      { qijia: 0, jushu: 0, changbang: 0, tobiHule: true }
    );
    const score = g.getFinalScore();
    const oya = score.find(r => r.player === g.state.qijia)!;
    expect(oya.tontonbuBonus).toBe(12);
    for (const r of score) if (r.player !== g.state.qijia) expect(r.tontonbuBonus).toBe(-6);
  });

  it('jushu>0 [東 2 局以降] では トントンブー trigger しない', () => {
    const g = makeEndGame(
      { 0: 50000, 1: -100, 2: 55100 },
      { qijia: 0, jushu: 1, changbang: 0, tobiHule: true }
    );
    const score = g.getFinalScore();
    for (const r of score) expect(r.tontonbuBonus).toBe(0);
  });

  it('changbang>0 [南場以降] でも トントンブー trigger しない', () => {
    const g = makeEndGame(
      { 0: 50000, 1: -100, 2: 55100 },
      { qijia: 0, jushu: 0, changbang: 1, tobiHule: true }
    );
    const score = g.getFinalScore();
    for (const r of score) expect(r.tontonbuBonus).toBe(0);
  });

  it('東 1 局でも 親アガリ ナシ なら トントンブー trigger しない', () => {
    const g = makeEndGame(
      { 0: 50000, 1: -100, 2: 55100 },
      { qijia: 0, jushu: 0, changbang: 0, tobiHule: false }
    );
    const score = g.getFinalScore();
    const oya = score.find(r => r.player === g.state.qijia)!;
    expect(oya.tontonbuBonus).toBe(12);
    for (const r of score) if (r.player !== g.state.qijia) expect(r.tontonbuBonus).toBe(-6);
  });
});
