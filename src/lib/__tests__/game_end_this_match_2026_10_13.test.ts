import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import GameEndPanel from '../GameEndPanel.svelte';

// [2026-10-13 リョー「東風終わりにその東風での勝ち負けを出してほしい」]
// 合計 [total] は前の試合からの持越し込みの通算。この東風だけの勝ち負け = total - 試合開始時の chip

const ranking = [
  { rank: 1, player: 0, defen: 52000 },
  { rank: 2, player: 1, defen: 31000 },
  { rank: 3, player: 2, defen: 22000 },
];
// 持越し [+20 / -5 / -15] の上に、この東風で +40 / -10 / -30
const finalScore = [
  { player: 0, defen: 52000, rank: 1, chipBase: 30, uma: 30, topNBonus: 0, tobiBonus: 0, tontonbuBonus: 0, chip: 30, total: 60 },
  { player: 1, defen: 31000, rank: 2, chipBase: -15, uma: 0, topNBonus: 0, tobiBonus: 0, tontonbuBonus: 0, chip: -15, total: -15 },
  { player: 2, defen: 22000, rank: 3, chipBase: -15, uma: -30, topNBonus: 0, tobiBonus: 0, tontonbuBonus: 0, chip: -15, total: -45 },
];
const props = { ranking, names: ['A', 'B', 'C'], zifengZ: (p: number) => p + 1, finalScore, matchLabel: '東風' };
const cells = (body: string, cls: string) => [...body.matchAll(new RegExp(`<td class="${cls}[^"]*"[^>]*>(?:<strong>)?([^<]*)`, 'g'))].map((m) => m[1]);

describe('GameEndPanel のこの東風の勝ち負け', () => {
  it('持越しがある時は「この東風」に差分、「通算」に合計を出す', () => {
    const { body } = render(GameEndPanel, { props: { ...props, matchStart: [20, -5, -15] } });
    expect(body).toContain('東風終了');
    expect(body).toContain('この東風');
    expect(body).toContain('通算');
    expect(cells(body, 'final this-match')).toEqual(['+40', '-10', '-30']);
    expect(cells(body, 'cumulative')).toEqual(['+60', '-15', '-45']);
    // チップ収支もこの東風の分 [chipBase - 持越し]
    expect(cells(body, 'ledger')).toEqual(['+10', '-10', '0']);
  });
  it('持越しが無い最初の試合は「この東風」だけ [通算の列は出さない]', () => {
    const { body } = render(GameEndPanel, { props: { ...props, matchStart: [0, 0, 0] } });
    expect(cells(body, 'final this-match')).toEqual(['+60', '-15', '-45']);
    expect(body).not.toContain('通算');
  });
  it('負けは赤 [lose]、勝ちは緑のまま', () => {
    const { body } = render(GameEndPanel, { props: { ...props, matchStart: [20, -5, -15] } });
    expect(body).toMatch(/class="final this-match[^"]*win/);
    expect(body).toMatch(/class="final this-match[^"]*lose/);
  });
});
