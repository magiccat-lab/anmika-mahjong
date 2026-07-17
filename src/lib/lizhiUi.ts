import { toCorePai } from './helpers';

export type LizhiPendingFlags = {
  open: boolean;
  shuvari: boolean;
  fever: boolean;
};

export type LizhiChoiceId =
  | 'normal'
  | 'shuvari'
  | 'fever'
  | 'shuvari-fever'
  | 'open'
  | 'shuvari-open';

export function lizhiChoiceId(flags: LizhiPendingFlags | null | undefined): LizhiChoiceId | null {
  if (!flags) return null;
  if (flags.fever) return flags.shuvari ? 'shuvari-fever' : 'fever';
  if (flags.open) return flags.shuvari ? 'shuvari-open' : 'open';
  return flags.shuvari ? 'shuvari' : 'normal';
}

export function lizhiChoiceLabel(id: LizhiChoiceId | null): string {
  switch (id) {
    case 'normal': return '通常リーチ';
    case 'shuvari': return 'シュバリーチ';
    case 'fever': return 'フィーバーリーチ';
    case 'shuvari-fever': return 'シュバ・フィーバーリーチ';
    case 'open': return 'オープンリーチ';
    case 'shuvari-open': return 'シュバ・オープンリーチ';
    default: return 'リーチ未選択';
  }
}

/** Physical tile label used by the riichi controls.  Expanded identities are
 * intentionally kept visible: choosing a gold/rainbow/pochi tile is not the
 * same physical discard even when majiang-core evaluates the same core tile. */
export function lizhiPaiLabel(value: string): string {
  const pai = value.replace(/[_*]$/, '');
  const expanded: Record<string, string> = {
    gp: '金5筒', gs: '金5索', gN: '金北',
    np3: '虹3筒', ns3: '虹3索', nz3: '虹西',
    z5b: '青ぽっち', z5r: '赤ぽっち', z5g: '緑ぽっち', z5y: '黄ぽっち',
    bu: '青ぽっち', br: '赤ぽっち', bg: '緑ぽっち', by: '黄ぽっち',
  };
  if (expanded[pai]) return expanded[pai];
  const suit = pai[0];
  const digit = pai[1];
  if (!suit || !digit) return pai;
  if (suit === 'z') {
    return ['東', '南', '西', '北', '白', '發', '中'][Number(digit) - 1] ?? pai;
  }
  const suffix = suit === 'm' ? '萬' : suit === 'p' ? '筒' : suit === 's' ? '索' : '';
  if (!suffix) return pai;
  return digit === '0' ? `赤5${suffix}` : `${digit}${suffix}`;
}

export function lizhiCandidateText(candidates: string[]): string {
  const unique = [...new Set(candidates.map(lizhiPaiLabel))];
  return unique.length > 0 ? unique.join('・') : '候補なし';
}

/** North and gold-north are nuki-only under the game rules and therefore can
 * never be the tile discarded to complete a riichi declaration. */
export function isLizhiDiscardableCandidate(pai: string): boolean {
  return toCorePai(pai.replace(/[_*]$/, '')) !== 'z4';
}

/** Return majiang-core's canonical white-kan meld string.  The valid form is
 * `z5555`; rebuilding it from the physical tile label can accidentally send
 * an invalid value such as `z5z5z5z5`. */
export function findWhiteKanCandidate(candidates: string[]): string | null {
  return candidates.find((mianzi) => mianzi.startsWith('z5')) ?? null;
}

/** Select the declaration tiles for the chosen mode without collapsing
 * physical identities.  p3 and np3 can produce different Rainbow-FEVER
 * results even though both normalize to p3 in majiang-core. */
export function lizhiCandidatesForFlags(
  normalCandidates: string[],
  feverCandidates: string[],
  flags: LizhiPendingFlags | null | undefined,
): string[] {
  if (!flags?.fever) return normalCandidates;
  const allowed = new Set(feverCandidates.map((pai) => pai.replace(/[_*]$/, '')));
  return normalCandidates.filter((pai) => allowed.has(pai.replace(/[_*]$/, '')));
}
