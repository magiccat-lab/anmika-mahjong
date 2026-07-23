// [2026-07-23 4人回し Phase3, Sol P1-2] client 側の seat 契約変換 [pure]。
// onlineMembers は room seat 契約の全員リスト [lobby / currentMembers / roomMembers] を
// 唯一の SSoT とし、盤面 [game seat] 側の表示・CPU 席・host 席はここで写像して導出する。
// mapping 無し [3人部屋] は恒等 [seat 0-2 のみ]。

export type ClientSeatMapping = {
  gameToRoom: [number, number, number];
  inactiveRoomSeat: number;
} | null | undefined;

export type OnlineMemberLike = {
  seat: number;
  user_id: string;
  username: string;
  is_cpu: boolean;
};

export function clientGameToRoomSeat(mapping: ClientSeatMapping, gameSeat: number): number {
  if (!mapping) return gameSeat;
  return mapping.gameToRoom[gameSeat] ?? gameSeat;
}

export function clientRoomToGameSeat(mapping: ClientSeatMapping, roomSeat: number): number | null {
  if (!mapping) return roomSeat >= 0 && roomSeat <= 2 ? roomSeat : null;
  const gameSeat = mapping.gameToRoom.indexOf(roomSeat);
  return gameSeat >= 0 ? gameSeat : null;
}

/** 盤面の game seat に座っている member [表示名/CPU 判定用] */
export function memberAtGameSeat<T extends OnlineMemberLike>(
  members: readonly T[],
  mapping: ClientSeatMapping,
  gameSeat: number,
): T | undefined {
  const roomSeat = clientGameToRoomSeat(mapping, gameSeat);
  return members.find((member) => member.seat === roomSeat);
}

/** 現試合の CPU の game seat 一覧 [抜け番 CPU は含まない] */
export function activeCpuGameSeats(
  members: readonly OnlineMemberLike[],
  mapping: ClientSeatMapping,
): number[] {
  const seats: number[] = [];
  for (const member of members) {
    if (!member.is_cpu) continue;
    const gameSeat = clientRoomToGameSeat(mapping, member.seat);
    if (gameSeat !== null) seats.push(gameSeat);
  }
  return seats.sort((a, b) => a - b);
}

/** host の game seat [host が抜け番なら null] */
export function hostGameSeat(
  members: readonly OnlineMemberLike[],
  mapping: ClientSeatMapping,
  hostUserId: string | undefined,
): number | null {
  if (!hostUserId) return null;
  const host = members.find((member) => member.user_id === hostUserId);
  if (!host) return null;
  return clientRoomToGameSeat(mapping, host.seat);
}
