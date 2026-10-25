// [2026-10-25 リョー「カン出来る所が複数ある時にカンボタンがどれのカンを指すか分からないから何を噛ん刷るか書いて」]
// カンの候補 [majiang-core の面子表記] から、ボタンに出す「暗カン 5筒」「加カン 東」を作る。
// 表記: 暗槓 m5555 / p5550 [0 は赤・金の 5]、 加槓 m555=5 [方向の記号の後に足す 1 枚]、 大明槓 m5555+ [末尾に方向]。

const SUIT: Record<string, string> = { m: '萬', p: '筒', s: '索' };
const HONOR = ['', '東', '南', '西', '北', '白', '發', '中'];

/** カンする牌の名前 [5筒 ・ 東]。 読めない表記は空文字 */
export function kanTileName(mianzi: string): string {
  const s = mianzi[0];
  const digit = mianzi.match(/\d/)?.[0];
  if (!digit) return '';
  const n = digit === '0' ? 5 : Number(digit);
  if (s === 'z') return HONOR[n] ?? '';
  return SUIT[s] ? `${n}${SUIT[s]}` : '';
}

/** 暗槓 ・ 加槓 ・ 大明槓 の別 */
export function kanKind(mianzi: string): '暗カン' | '加カン' | 'カン' {
  if (/[+=-]\d$/.test(mianzi)) return '加カン';
  if (/[+=-]$/.test(mianzi)) return 'カン';
  return '暗カン';
}

/** ボタンの文字 [暗カン 5筒]。 牌が読めない時は種類だけ */
export function kanButtonLabel(mianzi: string): string {
  const name = kanTileName(mianzi);
  return name ? `${kanKind(mianzi)} ${name}` : kanKind(mianzi);
}
