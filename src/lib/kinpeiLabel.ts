// [2026-10-22 リョー「金北の華選択は春春とかなら春春って出すようにして欲しい」]
// 金北の強化先の選択肢は、使える華 [抜いた華 + 表ドラ表示の華 (リーチなら裏も)] の季節ごとに 1 つ。
// 同じ季節を 2 枚以上持っていると「夏夏金北」のように重なって効く [autoResolveKinpei も枚数を見る] ので、
// 押す前に何枚の何で効くかが分かるよう、枚数分だけ季節の字を並べる [春春 ・ 冬冬冬]。

export type KinpeiTarget = 'haru' | 'natsu' | 'aki' | 'fuyu';

export const KINPEI_SEASONS: ReadonlyArray<{ target: KinpeiTarget; pai: string; char: string }> = [
  { target: 'haru', pai: 'f1', char: '春' },
  { target: 'natsu', pai: 'f2', char: '夏' },
  { target: 'aki', pai: 'f3', char: '秋' },
  { target: 'fuyu', pai: 'f4', char: '冬' },
];

/** 選択肢 1 つ分のラベル [枚数分の季節の字。0 枚なら空文字] */
export function kinpeiOptionLabel(huapai: readonly string[], pai: string): string {
  const season = KINPEI_SEASONS.find((s) => s.pai === pai);
  if (!season) return '';
  const n = huapai.filter((p) => p === pai).length;
  return season.char.repeat(n);
}

/** 持っている季節だけを 春 → 夏 → 秋 → 冬 の順に並べた選択肢 */
export function kinpeiOptions(huapai: readonly string[]): Array<{ target: KinpeiTarget; pai: string; label: string; count: number }> {
  const out: Array<{ target: KinpeiTarget; pai: string; label: string; count: number }> = [];
  for (const s of KINPEI_SEASONS) {
    const count = huapai.filter((p) => p === s.pai).length;
    if (count > 0) out.push({ target: s.target, pai: s.pai, label: s.char.repeat(count), count });
  }
  return out;
}
