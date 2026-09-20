/** FX-02 A/P1: original vector lettering, no font or runtime image dependency.
 * Replace this asset map to change the art without touching animation ownership. */
import type { CutinId } from './store';

const strokes: Record<string, string> = {
  'ポ': 'M9 22H49 M29 10V54 M17 32L7 48 M40 32L51 47 M45 8a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
  'ン': 'M10 12L24 22 M9 51Q39 44 51 15',
  'カ': 'M8 23H48L43 51H33 M29 9Q28 38 8 53',
  'リ': 'M15 10V33 M43 9V29Q43 46 24 54',
  'ー': 'M8 31L51 29',
  'チ': 'M14 15L43 8 M8 29H51 M32 13V33Q30 48 15 54',
  'ロ': 'M12 13H49V49H12Z',
  'ツ': 'M10 13L16 26 M28 9L33 23 M51 12Q48 43 19 54',
  'モ': 'M12 13H47 M7 29H52 M24 14V45Q24 50 31 50H49',
  'フ': 'M8 13H50Q47 42 17 53',
  'ィ': 'M48 23L22 42 M36 34V56',
  'バ': 'M21 19Q18 37 6 51 M37 19L52 49 M43 6L48 12 M53 3L58 9',
  '白': 'M30 6L23 15 M13 16H48V53H13Z M14 34H47',
  'ぽ': 'M11 12Q5 34 11 53 M23 21H47 M23 32H47 M39 16V43Q40 55 27 50Q16 44 28 40Q39 38 51 49 M49 7a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
  'っ': 'M16 34Q52 19 50 39Q48 51 29 53',
  'ち': 'M9 20H49 M30 8L23 35Q42 25 49 36Q55 52 23 53',
};

function wordmark(word: string): string {
  const width = word.length * 62 + 16;
  const glyphs = [...word].map((letter, i) =>
    `<path transform="translate(${i * 62 + 8} 4)" d="${strokes[letter]}"/>`).join('');
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 72"><g fill="none" stroke="#d9b453" stroke-width="5.5" stroke-linecap="square" stroke-linejoin="miter" transform="skewX(-6)">${glyphs}</g><path d="M9 69H${width - 22}l13-5" fill="none" stroke="#d9b453" stroke-width="1"/></svg>`)}`;
}

export const FX_LABELS: Record<CutinId, string> = {
  reach: 'リーチ', ron: 'ロン', tsumo: 'ツモ', fever: 'フィーバー', kan: 'カン', pon: 'ポン',
};
export const FX_ARTWORK: Record<CutinId, string> = Object.fromEntries(
  Object.entries(FX_LABELS).map(([id, label]) => [id, wordmark(label)]),
) as Record<CutinId, string>;
export const POCHI_ARTWORK = wordmark('白ぽっち');
