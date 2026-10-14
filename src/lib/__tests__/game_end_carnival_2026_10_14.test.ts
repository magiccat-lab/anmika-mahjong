import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import GameEndPanel from '../GameEndPanel.svelte';

// [2026-10-14 リョー「勝利演出の時はアンミカーニバルの曲流したいなw」]
// 終わりの画面でトップの人の勝利を出し、公式の短い動画 (講談社 mimollet、埋め込み可) を YouTube の埋め込みで流す。
// 音のファイルはアプリに置かない

const ranking = [
  { rank: 2, player: 0, defen: 31000 },
  { rank: 1, player: 1, defen: 52000 },
  { rank: 3, player: 2, defen: 22000 },
];

describe('GameEndPanel の勝利の曲', () => {
  it('トップの人の名前と、アンミカーニバルの埋め込み (自動再生) を出す', () => {
    const { body } = render(GameEndPanel, { props: { ranking, names: ['A', 'B', 'C'], zifengZ: (p: number) => p + 1, matchLabel: '東風' } });
    expect(body).toContain('B の勝利！');
    expect(body).toMatch(/<iframe[^>]+src="https:\/\/www\.youtube-nocookie\.com\/embed\/pIfOv74wBCE\?autoplay=1/);
    expect(body).toMatch(/allow="autoplay/);
    expect(body).toContain('曲を止める');
  });
});
