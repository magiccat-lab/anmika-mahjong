// [2026-10-14 リョー「四華とか四北がそろったらカットイン出るようにして」]
// 華と北が揃った瞬間のカットイン。数え方は game3 の和了時の判定と同じ:
// 四華 = 春夏秋冬 [f1〜f4] が 1 枚ずつ以上、八華 = 華 8 枚、四北 = 抜いた北 [金北を含む] 4 枚以上。
// 華と北は卓に見えている物なので、オンラインでも各画面が自分で見て出す [server は通さない]。
import type { CutinId } from './store';

// [2026-10-15 リョー「NN金北になったらカットインも入れてあげてほしい」] 同じ季節の華 2 枚と金北が揃った時 (夏夏金北 ・ 冬冬金北、
// 決まりは data/notes/anmika_rules.md の 2-5)。春春 ・ 秋秋も同じ扱いで 4 つとも出す。kin は揃った季節 (f1〜f4)
export type SetFlags = { hua: 0 | 1 | 2; bei: boolean; kin?: string[] };

export const NO_SET: SetFlags = { hua: 0, bei: false, kin: [] };

const SEASON_JA: Record<string, string> = { f1: '春', f2: '夏', f3: '秋', f4: '冬' };

/** nuki は抜いた北の数 (金北を含む)、gold はそのうちの金北の数 */
export function setFlags(huapai: readonly string[] | null | undefined, nuki: number, gold = 0): SetFlags {
  const list = huapai ?? [];
  const all4 = ['f1', 'f2', 'f3', 'f4'].every((f) => list.includes(f));
  const kin = gold > 0 ? ['f1', 'f2', 'f3', 'f4'].filter((f) => list.filter((x) => x === f).length >= 2) : [];
  return { hua: list.length >= 8 ? 2 : all4 ? 1 : 0, bei: nuki >= 4, kin };
}

/** 前から今で新しく揃った NN金北 の帯の字 (「夏夏金北」)。季節の順に、揃った分だけ */
export function kinpeiPairLabels(prev: SetFlags, cur: SetFlags): string[] {
  const before = new Set(prev.kin ?? []);
  return (cur.kin ?? []).filter((f) => !before.has(f)).map((f) => `${SEASON_JA[f]}${SEASON_JA[f]}金北`);
}

/** 前から今で新しく揃った時に出すカットイン。片方が揃っている所にもう片方が揃ったら「四華四北」の様に続けて出す */
export function setCutinFor(prev: SetFlags, cur: SetFlags): CutinId | null {
  const huaUp = cur.hua > prev.hua;
  const beiUp = cur.bei && !prev.bei;
  if (!huaUp && !beiUp) return null;
  if (cur.bei && cur.hua === 2) return 'hachikashipei';
  if (cur.bei && cur.hua === 1) return 'shikashipei';
  if (huaUp) return cur.hua === 2 ? 'hachika' : 'shika';
  return 'shipei';
}
