// [2026-10-22 リョー「観戦モードに限りそのあとのそれぞれのツモ見れるようにするとかできない？」]
// 局が終わった後、続けていたら各席が次に引いたはずの牌を見せる。
// [2026-11-15 リョー] 観戦だけでなく打ち手 [席 0-2] の投影にも載せる。局の途中は誰にも載せない [下の null 判定]。
// 投影を作る時に導出するだけで、部屋の保存 [sqlite の command 列 / snapshot] には何も足さない。
import type { RoomAuthority } from './authority';

type CanonicalState = ReturnType<RoomAuthority['canonicalState']>;

/** 手番の次の席。game3.ts の手番は lunban を進めて player = 現親 - lunban [mod 3] なので、
 *  席番号は降順 [P0 → P2 → P1] で回る [game3.ts lunbanToPlayerId / dapai の lunban + 1]。 */
export function nextSeatInTurnOrder(seat: number): 0 | 1 | 2 {
  return ((seat + 2) % 3) as 0 | 1 | 2;
}

/**
 * 局が終わった時だけ、続けたら各席が引いたはずの牌を山の残りから順に配る。
 * - 山は生きている山 [Shan3._pai = 通常ツモの元。王牌の嶺上 / ドラ表 / 裏ドラ表は別配列に物理分離済み] だけ。
 *   通常のツモは _pai の末尾から pop されるので、末尾 → 先頭の順に読む
 * - 開始席: ツモ和了なら和了者の次、ロン [槍槓 ・ 北抜きロン含む] なら放銃者の次、流局なら最後に打った人の次
 * - 簡略化: 鳴き ・ ロンの割り込みは考えず、北 / 華 / カンの嶺上補充も無視して、ただ順番に配る
 *   [華が山にあればそのまま 1 枚の牌として出る。実際は嶺上から補充して次の牌を引く]
 * - 局が終わっていない [打牌中 ・ 反応窓 ・ 冬 / 金北などの選択待ち ・ フィーバー続行待ち ・ 試合終了後] は null
 */
/** 局が終わって「この後」を見せてよい形か。途中 ・ 選択待ち ・ フィーバー続行待ち ・ 試合終了後は false */
function roundOverForReveal(state: CanonicalState): boolean {
  const game: any = state.game;
  if (!game || game.state?.finished) return false;
  if (state.awaitingRonDecision || state.pendingQianggang) return false;
  if (state.pendingFuyu || state.pendingKinpei || state.pendingKamiPochi || state.pendingPochiSwap
    || state.pendingFeverContinue) return false;
  const hasWinner = state.lastWinner === 0 || state.lastWinner === 1 || state.lastWinner === 2;
  const isRon = state.ronResults.length > 0 || state.ronDeclaredPlayers.length > 0;
  const winEnded = state.roundEnded && hasWinner && !!(state.lastHuleResult || isRon);
  const pingjuEnded = !!state.pendingPingju && !hasWinner;
  return winEnded || pingjuEnded;
}

export type DeadWallReveal = { rinshan: string[]; baopai: string[]; fubaopai: string[] };

/**
 * [2026-11-17 isg. 通報 20261117_1「この後の上がり時にツモが見えるなら、透明化のため王牌も出してほしい」]
 * 局が終わった時だけ、王牌の中身を全部出す。「この後のツモ」と同じ時にだけ載せる [roundOverForReveal]。
 * - rinshan: 嶺上の残り [カン ・ 北抜き ・ 華の補充で前から引く順。使った分は減っている]
 * - baopai: 表ドラ表示 [カン ・ 秋でめくった分も含む全部]
 * - fubaopai: 裏ドラ表示 [リーチで上がっていなくても全部。局はもう終わっている]
 */
export function computeDeadWallReveal(state: CanonicalState): DeadWallReveal | null {
  if (!roundOverForReveal(state)) return null;
  const shan: any = (state.game as any)?.shan;
  if (!shan || shan.isBlind) return null;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  return { rinshan: list(shan._rinshan), baopai: list(shan._baopai), fubaopai: list(shan._fubaopai) };
}

export function computeSpectatorNextDraws(state: CanonicalState): Record<number, string[]> | null {
  const game: any = state.game;
  if (!roundOverForReveal(state)) return null;
  const hasWinner = state.lastWinner === 0 || state.lastWinner === 1 || state.lastWinner === 2;
  const isRon = state.ronResults.length > 0 || state.ronDeclaredPlayers.length > 0;
  const winEnded = state.roundEnded && hasWinner && !!(state.lastHuleResult || isRon);

  let from: number | null;
  if (winEnded && !isRon) from = state.lastWinner;
  else from = state.lastDapai ? state.lastDapai.player : null;
  if (from !== 0 && from !== 1 && from !== 2) return null;

  const live: unknown = game.shan?._pai;
  if (!Array.isArray(live)) return null;
  const draws: Record<number, string[]> = { 0: [], 1: [], 2: [] };
  let seat = nextSeatInTurnOrder(from);
  for (let i = live.length - 1; i >= 0; i -= 1) {
    draws[seat].push(String(live[i]));
    seat = nextSeatInTurnOrder(seat);
  }
  return draws;
}
