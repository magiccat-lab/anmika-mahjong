// [2026-10-09 遊真 C1] 誰待ちか ・ 残り何秒かを席に出す。
// server の { type:'deadline', kind, seats, remainingMs, revision } を画面用の状態に落とす pure な部品。
// 時計は呼び出し側が渡す [performance.now() 基準。テストでは固定値]。
// seats は部屋の席 [room seat]。盤面の席 [game seat] への写像は呼び出し側 [onlineSeats.ts]

export type DeadlineKind = 'turn' | 'reaction' | 'postWin';

export type OnlineDeadline = {
  kind: DeadlineKind;
  /** 待たれている人の room seat */
  seats: number[];
  /** performance.now() 基準の期限 */
  endsAt: number;
  /** リングの満タンにする長さ [同じ revision で見えた最大の残り] */
  totalMs: number;
  revision: number;
};

/** 残りがこれ以下になったら本人に知らせる */
export const DEADLINE_WARN_MS = 10_000;

const KINDS: readonly string[] = ['turn', 'reaction', 'postWin'];

/**
 * deadline message を現在の状態に畳む。
 * - kind 'none' / 待たれている席が無い → null [カウントダウンを消す]
 * - 古い revision は無視 [現在の状態をそのまま返す]
 * - 壊れた message も無視
 * 同じ revision ・ 同じ kind の再送 [再接続直後の sync 後] は totalMs を保つ
 */
export function applyDeadlineMessage(
  current: OnlineDeadline | null,
  msg: unknown,
  now: number,
): OnlineDeadline | null {
  if (!msg || typeof msg !== 'object') return current;
  const m = msg as Record<string, unknown>;
  const revision = typeof m.revision === 'number' && Number.isFinite(m.revision)
    ? m.revision
    : (current?.revision ?? 0);
  if (current && revision < current.revision) return current;
  if (m.kind === 'none') return null;
  if (typeof m.kind !== 'string' || !KINDS.includes(m.kind)) return current;
  if (typeof m.remainingMs !== 'number' || !Number.isFinite(m.remainingMs)) return current;
  const seats = Array.isArray(m.seats)
    ? m.seats.filter((s): s is number => typeof s === 'number' && Number.isInteger(s))
    : [];
  if (seats.length === 0) return null;
  const remaining = Math.max(0, m.remainingMs);
  const kind = m.kind as DeadlineKind;
  const sameWait = !!current && current.revision === revision && current.kind === kind;
  return {
    kind,
    seats,
    endsAt: now + remaining,
    totalMs: sameWait ? Math.max(current!.totalMs, remaining) : remaining,
    revision,
  };
}

export function deadlineRemainingMs(deadline: OnlineDeadline | null, now: number): number {
  if (!deadline) return 0;
  return Math.max(0, deadline.endsAt - now);
}

/** その room seat が今の待ちの対象か [期限切れ後は false] */
export function isWaitingOnSeat(deadline: OnlineDeadline | null, roomSeat: number | null | undefined, now: number): boolean {
  if (!deadline || roomSeat === null || roomSeat === undefined) return false;
  return deadline.seats.includes(roomSeat) && now < deadline.endsAt;
}

export type DeadlineWarn = {
  /** 1 つの待ちにつき 1 回だけ鳴らすための印 */
  key: string;
  /** now から数えて何 ms 後に鳴らすか [すでに残り 10 秒以内なら 0] */
  delayMs: number;
};

export function deadlineWarnKey(deadline: OnlineDeadline): string {
  return `${deadline.kind}:${deadline.revision}`;
}

/**
 * 自分の席が turn / reaction で待たれている時だけ警告の予定を返す。
 * 対象外 [他人待ち ・ postWin ・ 観戦 ・ 期限切れ] は null
 */
export function planDeadlineWarn(
  deadline: OnlineDeadline | null,
  mySeat: number | null | undefined,
  now: number,
): DeadlineWarn | null {
  if (!deadline) return null;
  if (deadline.kind !== 'turn' && deadline.kind !== 'reaction') return null;
  if (typeof mySeat !== 'number' || mySeat < 0) return null;
  if (!deadline.seats.includes(mySeat)) return null;
  const remaining = deadline.endsAt - now;
  if (remaining <= 0) return null;
  return { key: deadlineWarnKey(deadline), delayMs: Math.max(0, remaining - DEADLINE_WARN_MS) };
}
