
// store action: resetDebug の純粋構築 [qipai 経由せず直接 shan / shoupai を組む]
import { Game3, buildShoupai, pochiColorFromPai } from '../game3';
import { dwarn } from '../helpers';
import type { StoreState } from '../store';

/** forceP0 / forceHua / goldNbei / forceShan で P0 の手牌 + 次以降のツモ順を直接組む
 *  forceShan: [next zimo, then next, ...] — 山末尾に reverse 順で配置、 zimo は末尾から pop なので first 要素から消費 */
export function buildDebugState(
  forceP0: string[],
  forceHua: string[] = [],
  opts: { goldNbei?: boolean; forceShan?: string[] } = {},
): StoreState {
  const ng = new Game3();
  const shanPai = (ng.shan as any)._pai as string[];
  // shan から target を 1 枚 remove。 target='z5' [normalize 後の白] の場合は z5b/z5r/z5g/z5y のいずれかを消費
  // 戻り値: 削除に成功した場合は実際に消費した raw key [z5b 等]、 失敗時 null
  const removeFromShan = (target: string): string | null => {
    if (target === 'z5') {
      for (let i = shanPai.length - 1; i >= 0; i--) {
        const p = shanPai[i];
        if (p === 'z5b' || p === 'z5r' || p === 'z5g' || p === 'z5y') {
          shanPai.splice(i, 1);
          return p;
        }
      }
      return null;
    }
    for (let i = shanPai.length - 1; i >= 0; i--) {
      if (shanPai[i] === target) { shanPai.splice(i, 1); return target; }
    }
    return null;
  };
  ng.shoupai.set(0, buildShoupai(forceP0));
  const newHe = () => {
    const dummy = new Game3();
    dummy.qipai();
    return new (dummy.he.get(0).constructor)();
  };
  ng.he.set(0, newHe());
  ng.he.set(1, newHe());
  ng.he.set(2, newHe());
  ng.huapai[0] = [];
  ng.goldHand[0] = { p: 0, s: 0, z: 0 };
  ng.pochiHand[0] = { blue: 0, red: 0, green: 0, yellow: 0 };
  for (const pai of forceP0) {
    const consumed = removeFromShan(pai);
    if (!consumed) {
      dwarn('[resetDebug] shan に', pai, 'なし、 skip');
    }
    if (pai === 'gp') ng.goldHand[0].p += 1;
    else if (pai === 'gs') ng.goldHand[0].s += 1;
    else if (pai === 'gN') ng.goldHand[0].z += 1;
    // ぽっち色 tracking: forceP0 で明示色 [z5b/z5r/z5g/z5y] 指定時のみ pochiHand に加算。
    // generic 'z5' は色未確定 [配牌時点では裏向き想定、 ツモで初めて色判明] なので不加算。
    // [Fix 2026-05-13]: 旧コードは consumed の raw key から色 leak、 配牌 z5 が緑/赤等で表示される bug あり。
    const explicitColor = pochiColorFromPai(pai);
    if (explicitColor) ng.pochiHand[0][explicitColor] += 1;
  }
  for (const hp of forceHua) {
    ng.huapai[0].push(hp);
    removeFromShan(hp);
  }
  if (opts.goldNbei) {
    ng.goldHand[0].z = 1;
    ng.nukidora[0] = 1;
    removeFromShan('gN');
  }
  // forceShan: 次の zimo 順を固定。 shan から remove だけ先にしておいて、 P1/P2 distribution 後に reverse 順で末尾 push
  // 戻り値の raw key を記録、 後で再 push する時に raw key を使う [pochi 色保持]
  const forceShan = opts.forceShan ?? [];
  const forceShanConsumed: string[] = [];
  for (const t of forceShan) {
    const consumed = removeFromShan(t);
    if (!consumed) {
      dwarn('[resetDebug] forceShan: shan に', t, 'なし、 skip');
      forceShanConsumed.push(t); // skip した場合 そのまま push する [後の末尾 push で記録]
    } else {
      forceShanConsumed.push(consumed);
    }
  }
  // 残りをシャッフル
  for (let i = shanPai.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shanPai[i], shanPai[j]] = [shanPai[j], shanPai[i]];
  }
  // baopai / fubaopai を 後 pick で 再構築 [forceP0 / forceHua / goldNbei で除外した牌が ドラ表に混入するのを防ぐ]
  // [リョー指示 2026-05-11: 配牌と抜きだけ先に確定 → 残りでランダム]
  const pickNonHua = (start: number, count: number): string[] => {
    const picks: string[] = [];
    let i = start;
    while (picks.length < count && i < shanPai.length) {
      const p = shanPai[i];
      if (typeof p === 'string' && !p.startsWith('f')) picks.push(p);
      i++;
    }
    return picks;
  };
  (ng.shan as any)._baopai = pickNonHua(4, 2);
  (ng.shan as any)._fubaopai = (ng.shan as any)._fubaopai !== null ? pickNonHua(9, 2) : null;
  (ng.shan as any)._fuyuRevealed = []; // reset 冬めくり領域
  for (const pl of [1, 2] as (1 | 2)[]) {
    const tiles: string[] = [];
    const huas: string[] = [];
    const gold = { p: 0, s: 0, z: 0 };
    const ph = { blue: 0, red: 0, green: 0, yellow: 0 };
    while (tiles.length < 13 && shanPai.length > 0) {
      const last = shanPai.pop()!;
      if (last && last.startsWith('f')) huas.push(last);
      else {
        tiles.push(last);
        if (last === 'gp') gold.p += 1;
        else if (last === 'gs') gold.s += 1;
        else if (last === 'gN') gold.z += 1;
        const c = pochiColorFromPai(last);
        if (c) ph[c] += 1;
      }
    }
    ng.shoupai.set(pl, buildShoupai(tiles));
    ng.huapai[pl] = huas;
    ng.goldHand[pl] = gold;
    ng.pochiHand[pl] = ph;
  }
  // P1/P2 distribution 後に forceShan を末尾 push [次 zimo が末尾なので reverse 順]
  // consumed 配列を使う [pochi 色保持の z5b 等 raw key]
  for (let i = forceShanConsumed.length - 1; i >= 0; i--) {
    shanPai.push(forceShanConsumed[i]);
  }
  const fp = ng.zimo();
  return {
    game: ng,
    lastZimo: fp,
    lastDapai: null,
    lastWinner: null,
    lastHuleResult: null,
    awaitingRonDecision: false,
    ronPassedPlayers: [],
    ronDeclaredPlayers: [],
    ronResults: [],
    awaitingFulou: false,
    ponCandidates: [],
    kanCandidates: [],
    roundEnded: false,
    message: 'debug 配牌で開始',
    cpu: { 0: false, 1: false, 2: false },
    lizhiPending: null,
    pendingKinpei: null,
    pendingFuyu: null,
    pendingKamiPochi: null,
    pendingPochiSwap: null,
    pendingFeverContinue: null,
    pendingPingju: false,
    pendingQianggang: null,
    pendingNukiBei: null,
    pendingSaiKoro: null,
    cpuWinAck: true,
    stamps: { 0: null, 1: null, 2: null },
    cutin: null,
    cutinQueue: [],
  };
}
