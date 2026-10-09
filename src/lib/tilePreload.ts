// 牌の絵を卓に入る前に読んでおく [2026-10-09 リョー「牌画像のローディングに時間かかる」]
// 入口・ロビーにいる間に全部の SVG を落として decode し、参照を持ち続ける。
// 同じ URL の <img> は document の available images から待たずに出る
// 牌を足したら public/tiles と一緒にここへ [tilePreload.test.ts が突き合わせる]

const NUM = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export const TILE_FILES: readonly string[] = [
  ...NUM.map((n) => `Man${n}.svg`),
  ...NUM.map((n) => `Pin${n}.svg`),
  ...NUM.map((n) => `Sou${n}.svg`),
  'Man5-Dora.svg', 'Pin5-Dora.svg', 'Sou5-Dora.svg',
  'Ton.svg', 'Nan.svg', 'Shaa.svg', 'Pei.svg', 'Haku.svg', 'Hatsu.svg', 'Chun.svg',
  'Haku-Blue.svg', 'Haku-Red.svg', 'Haku-green.svg', 'Haku-yellow.svg',
  'spring.svg', 'summer.svg', 'autumn.svg', 'winter.svg',
  'Pin5-Gold.svg', 'Sou5-Gold.svg', 'Pei-Gold.svg',
  'Pin3-Rainbow.svg', 'Sou3-Rainbow.svg', 'Shaa-Rainbow.svg',
  'Back.svg',
];

let held: HTMLImageElement[] | null = null;

export function preloadTiles(): void {
  if (held || typeof Image === 'undefined') return;
  held = TILE_FILES.map((f) => {
    const im = new Image();
    im.decoding = 'async';
    // 卓に出ている牌の読み込みを追い越さない [すぐ卓に入った時]
    (im as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low';
    im.src = `/tiles/${f}`;
    im.decode?.().catch(() => {});
    return im;
  });
}
