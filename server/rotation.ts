// [2026-07-23 4人回し Phase2, Sol設計] room seat ↔ game seat mapping と 4-way room ledger の純粋層。
// Game3/authority は純3席のまま。dice 精算だけ抜け番も頭数に入れる規則はここで写像する。
// 決定則 [設計 §6]: mapping は nextMatch accept 直前に server が算出して action へ焼き、
// appendAcceptedCommand の matchId 増加 command を唯一の境界として交換する。
import type { ChipSettlementEffect } from '../src/lib/game3/chip.ts';
import {
  applyRoomChipCommand,
  type AcceptedRoomCommand,
  type RoomMemberSnapshot,
  type RoomSeatMapping,
  type RoomStartSnapshot,
} from './protocol.ts';

/** [2026-07-24 4人回し Phase6] start.members 用の active trio を game seat 契約で組む。
 *  設計 §2: start.members に seat3 [room seat] を混ぜない。entry の seat は game seat。 */
export function activeTrioForStart(
  roomMembers: readonly RoomMemberSnapshot[],
  mapping: RoomSeatMapping,
): RoomMemberSnapshot[] {
  return mapping.gameToRoom.map((roomSeat, gameSeat) => {
    const source = roomMembers.find((member) => member.seat === roomSeat);
    if (!source) throw new Error(`rotation start: no member at room seat ${roomSeat}`);
    return { ...source, seat: gameSeat };
  });
}

/** gameSeat → roomSeat。mapping 無し [3人部屋] は恒等 */
export function gameToRoomSeat(mapping: RoomSeatMapping | null | undefined, gameSeat: number): number {
  if (!mapping) return gameSeat;
  return mapping.gameToRoom[gameSeat] ?? gameSeat;
}

/** roomSeat → gameSeat。抜け番/範囲外は null [操作権なし側に倒す] */
export function roomToGameSeat(mapping: RoomSeatMapping | null | undefined, roomSeat: number): number | null {
  if (!mapping) return roomSeat >= 0 && roomSeat <= 2 ? roomSeat : null;
  const gameSeat = mapping.gameToRoom.indexOf(roomSeat);
  return gameSeat >= 0 ? gameSeat : null;
}

/** rotation 決定則 [pure。DB match_no / qijia に依存しない]:
 *  抜け番 = order[(initialInactiveIndex + matchOrdinal - 1) % 4]、
 *  残り 3 人が order の並び順のまま game seat 0..2 に座る。
 *  qijia [game 内起家] は別軸で server が回す [ここでは扱わない]。 */
export function mappingFor(
  matchOrdinal: number,
  order: readonly number[],
  initialInactiveIndex = order.length - 1,
): RoomSeatMapping {
  if (order.length !== 4) throw new Error(`rotation order must have 4 room seats, got ${order.length}`);
  const inactiveIdx = ((initialInactiveIndex + matchOrdinal - 1) % 4 + 4) % 4;
  const inactiveRoomSeat = order[inactiveIdx];
  const actives = order.filter((_, idx) => idx !== inactiveIdx);
  return {
    gameToRoom: [actives[0], actives[1], actives[2]] as [number, number, number],
    inactiveRoomSeat,
  };
}

/** [2026-07-23 4人回し Phase4] nextMatch accept 直前に server が焼く次試合 mapping。
 *  rotation 無効 / roomMembers 不整合なら null [3人部屋は mapping 無しのまま]。
 *  初期抜け番は start.initialMapping から逆引き [無ければ order 末尾 = 4人目]。 */
export function nextMappingForMatch(
  start: RoomStartSnapshot,
  matchOrdinal: number,
): RoomSeatMapping | null {
  if (!start.rotationEnabled) return null;
  const order = (start.roomMembers ?? []).map((member) => member.seat);
  // [Sol Phase4/5 P1] fail closed: 4 distinct な room seat 0-3 でなければ null
  // [呼出側は rotationEnabled で null なら nextMatch を明示 reject し、
  //  旧 mapping のまま黙って進んで公平 rotation が止まる状態を作らない]
  if (order.length !== 4 || new Set(order).size !== 4
    || order.some((seat) => !Number.isInteger(seat) || seat < 0 || seat > 3)) return null;
  let initialIdx = order.length - 1;
  if (start.initialMapping) {
    const idx = order.indexOf(start.initialMapping.inactiveRoomSeat);
    if (idx < 0) return null; // initialMapping が roster と矛盾 [fail closed]
    initialIdx = idx;
  }
  return mappingFor(matchOrdinal, order, initialIdx);
}

/** 精算 effect 列 → room seat キーの delta。
 *  - oall: 支払いは他 active 2 人 [+ kind='dice' かつ mapping ありなら抜け番も] が perPayer ずつ、
 *    winner は頭数分を受け取る [perPayer 負 = 逆ぽっちは符号ごと反転し、抜け番が受け取る側になる]
 *  - fromLoser: winner/loser の 1:1。dice-kind の fromLoser は現行呼出に存在しないため
 *    抜け番は関与させない [対人払いに頭数を増やすのは規則外]
 *  mapping 無し [3人部屋] の fold は game ledger の動きと常に一致する [不変条件テストあり]。
 *  net 0 になった seat は落とし、空なら null [command に空 delta を焼かない]。 */
export function computeRoomChipDelta(
  effects: readonly ChipSettlementEffect[],
  mapping: RoomSeatMapping | null | undefined,
): Record<string, number> | null {
  if (!effects.length) return null;
  const delta: Record<string, number> = {};
  const add = (roomSeat: number, value: number) => {
    delta[String(roomSeat)] = (delta[String(roomSeat)] ?? 0) + value;
  };
  for (const effect of effects) {
    const winnerRoom = gameToRoomSeat(mapping, effect.winner);
    if (effect.form === 'fromLoser') {
      if (effect.loser === null) continue;
      add(winnerRoom, effect.perPayer);
      add(gameToRoomSeat(mapping, effect.loser), -effect.perPayer);
      continue;
    }
    const payers: number[] = [];
    for (const gameSeat of [0, 1, 2]) {
      if (gameSeat === effect.winner) continue;
      payers.push(gameToRoomSeat(mapping, gameSeat));
    }
    if (effect.kind === 'dice' && mapping) payers.push(mapping.inactiveRoomSeat);
    for (const payer of payers) add(payer, -effect.perPayer);
    add(winnerRoom, effect.perPayer * payers.length);
  }
  for (const seat of Object.keys(delta)) {
    if (delta[seat] === 0) delete delta[seat];
  }
  return Object.keys(delta).length ? delta : null;
}

/** start snapshot から room ledger の初期値 [rotation 部屋は roomMembers、3人部屋は members の席で 0 埋め] */
export function initialRoomChipLedger(start: RoomStartSnapshot): Record<string, number> {
  if (start.roomChipLedger) return { ...start.roomChipLedger };
  const seats = (start.roomMembers ?? start.members).map((member) => member.seat);
  return Object.fromEntries(seats.map((seat) => [String(seat), 0]));
}

/** rewind / 監査用の全 fold: start 初期値 + command 列 → 現在の ledger / mapping。
 *  live accept は appendAcceptedCommand が同じ applyRoomChipCommand で増分適用しているので、
 *  この関数の結果と snapshot の値は常に一致する [ズレたら fold 規則の破れ]。 */
export function foldRoomState(
  start: RoomStartSnapshot,
  commands: readonly AcceptedRoomCommand[],
): { roomChipLedger: Record<string, number>; activeMapping: RoomSeatMapping | null } {
  let ledger: Record<string, number> | undefined = initialRoomChipLedger(start);
  let mapping: RoomSeatMapping | null | undefined = start.initialMapping ?? null;
  for (const command of commands) {
    const next = applyRoomChipCommand(ledger, mapping, command.action);
    ledger = next.ledger;
    mapping = next.mapping;
  }
  return { roomChipLedger: ledger ?? {}, activeMapping: mapping ?? null };
}
