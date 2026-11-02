// [クラウドレビュー 11-02 #18] GameEndPanel だけを出す試験用の頁 (vite dev で /tests/fixtures/review1102_ge.html)
import { mount } from 'svelte';
import '../../src/app.css';
import '../../src/cyber.css';
import GameEndPanel from '../../src/lib/GameEndPanel.svelte';

const fs = [
  { player: 0, defen: 52300, rank: 1, chipBase: 120, uma: 50, topNBonus: 0, tobiBonus: 0, tontonbuBonus: 0, chip: 170, total: 170 },
  { player: 1, defen: 31000, rank: 2, chipBase: -20, uma: 0, topNBonus: 0, tobiBonus: 0, tontonbuBonus: 0, chip: -20, total: -20 },
  { player: 2, defen: 21700, rank: 3, chipBase: -100, uma: -50, topNBonus: 0, tobiBonus: 0, tontonbuBonus: 0, chip: -150, total: -150 },
];
mount(GameEndPanel, {
  target: document.getElementById('app')!,
  props: {
    ranking: fs.map(({ rank, player, defen }) => ({ rank, player, defen })),
    names: ['りょー', 'しゅん', 'ゆうま'],
    zifengZ: (p: number) => p + 1,
    finalScore: fs,
    matchStart: [10, 0, -10],
    matchLabel: '東風',
  },
});
