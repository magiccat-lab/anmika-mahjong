// 白ぽっち ・ でかぽっちの絞りの演出の決まり (2026-10-14 リョー、演出のラフ 1〜3 版の答え)。
// 見せ方だけで、点数 ・ チップ ・ CPU の打ち方には触らない。
//  - めくれた後の字は「色の名前と効果」(3 版 T1 a): 青ぽっち ・ チップ ×2 など。でかぽっちは「でかぽっち」
//  - 枠の光り (期待度) は、正の時ほど強く出す。虹は正の確定で、逆の時は虹を出さない (1 版 Q2 a)
//  - 見えている牌 (河 ・ 鳴き ・ ドラ表示) から、まだ見えていない色が正だけ ・ 逆だけなら確定演出を出す
//    (同じ日「捨て牌とか公開情報から白ポッチの正負とか中身とか確定してるときは確定演出出していいよ」)
export type PochiColor = 'blue' | 'red' | 'green' | 'yellow';
export type Glow = 'white' | 'gold' | 'rainbow';

export const POCHI_COLORS: readonly PochiColor[] = ['blue', 'red', 'green', 'yellow'];
export const POCHI_GOOD: Record<PochiColor, boolean> = { blue: true, green: true, red: false, yellow: false };
const COLOR_JA: Record<PochiColor, string> = { blue: '青', green: '緑', red: '赤', yellow: '黄' };
const EFFECT: Record<PochiColor, string> = { blue: 'チップ ×2', green: 'チップ ×1', red: '逆払い ×2', yellow: '逆払い ×1' };
/** 牌の点の色 (public/tiles/Haku-*.svg と同じ) */
export const POCHI_DOT: Record<PochiColor, string> = { blue: '#133382', green: '#1e8a3c', red: '#c8102e', yellow: '#e8b400' };

/** めくれた後の帯の字 (大きい字と、右下の黒い札) */
export function pochiRevealText(color: PochiColor, deka = false): { word: string; tag: string } {
  if (deka) return { word: 'でかぽっち', tag: EFFECT[color] };
  return { word: `${COLOR_JA[color]}ぽっち`, tag: EFFECT[color] };
}

/** 枠の光りの 2 段 (絞りの途中で 1 段目、色の手前で 2 段目)。rnd は 0〜1 の乱数。
 *  正: 3 割で 金 → 虹、4 割半で 白 → 金、残りは白のまま。逆: 2 割で 白 → 金、残りは白のまま。逆で虹は出さない */
export function expectationGlow(good: boolean, rnd: number): [Glow, Glow] {
  if (good) {
    if (rnd < 0.3) return ['gold', 'rainbow'];
    if (rnd < 0.75) return ['white', 'gold'];
    return ['white', 'white'];
  }
  if (rnd < 0.2) return ['white', 'gold'];
  return ['white', 'white'];
}

function colorOfPai(pai: unknown): PochiColor | null {
  const p = String(pai ?? '').replace(/[+=\-_*]/g, '');
  if (p.startsWith('z5b')) return 'blue';
  if (p.startsWith('z5r')) return 'red';
  if (p.startsWith('z5g')) return 'green';
  if (p.startsWith('z5y')) return 'yellow';
  return null;
}

/** 見えている牌 (全員の河 ・ 鳴き ・ ドラ表示) に出ている白ぽっちの色を除いた、まだ見えていない色 */
export function publicPochiCandidates(game: any): PochiColor[] {
  const seen = new Set<PochiColor>();
  for (const p of [0, 1, 2]) {
    for (const d of (game?.discardLog?.[p] ?? []) as Array<{ pochi?: string }>) {
      const c = d?.pochi as PochiColor | undefined;
      if (c && POCHI_COLORS.includes(c)) seen.add(c);
    }
    const sp = game?.shoupai?.get?.(p);
    for (const m of (sp?._anmikaFulouPhysical ?? []) as Array<{ consumed?: string[] }>) {
      for (const x of m?.consumed ?? []) { const c = colorOfPai(x); if (c) seen.add(c); }
    }
  }
  for (const x of (game?.shan?.baopai ?? []) as string[]) { const c = colorOfPai(x); if (c) seen.add(c); }
  return POCHI_COLORS.filter((c) => !seen.has(c));
}

/** まだ見えていない色が正だけなら 'good'、逆だけなら 'bad'、混ざっていれば null */
export function kakuteiOf(candidates: PochiColor[]): 'good' | 'bad' | null {
  if (!candidates.length) return null;
  if (candidates.every((c) => POCHI_GOOD[c])) return 'good';
  if (candidates.every((c) => !POCHI_GOOD[c])) return 'bad';
  return null;
}
