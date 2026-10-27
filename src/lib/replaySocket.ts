// [2026-10-27 修] 対局画面のままの牌譜再生。リョー「おんみかの牌譜再生も普通にオンミカ画面のままで牌譜見たい
// …視点も変えられるように…白ポッチの色とか、上がり枚数の画面とか、サイコロとかも同じように再現」。
// server の /api/matches/{id}/replay-screen が、その試合を流し直して 1 つの席に届いたはずの sync / action を返す。
// ここは WebSocket の代わりにそれを順に onmessage へ流すだけ。App の受け口 (applyCanonicalSync ・
// applyRevisionedAction) は対局中と同じ物を通るので、盤面 ・ 演出 ・ 音もアプリのまま出る。
// 送られた物は捨てる (resync だけは今の位置の sync を返す)。

export type ReplayFrame = { at: string; msg: any };
export type ReplayData = { matchNo: number; firstRevision: number; lastRevision: number; frames: ReplayFrame[]; seat: number };
export type ReplayRound = { index: number; label: string };

const WINDS = ['東', '南', '西', '北'];

/** 局の頭 (最初の sync と nextRound の次) の frame と、その局の名前。試合の終わりの nextRound (最後の frame) は局にしない */
export function replayRounds(frames: readonly ReplayFrame[]): ReplayRound[] {
  const out: ReplayRound[] = [];
  const label = (state: any): string => {
    const g = state?.gameState;
    if (!g) return `${out.length + 1}局目`;
    return `${WINDS[g.changbang] ?? ''}${(g.jushu ?? 0) + 1}局${g.benbang ? ` ${g.benbang}本場` : ''}`;
  };
  frames.forEach((frame, index) => {
    const msg = frame.msg;
    if (index === 0) out.push({ index, label: label(msg?.snapshot?.state) });
    else if (msg?.type === 'action' && msg.action?.type === 'nextRound' && index < frames.length - 1) out.push({ index, label: label(msg.action._state) });
  });
  return out;
}

/** frame index の時点の盤面を sync 1 通にする。action の _state はその手を受けた後の席の投影 */
export function syncAt(frames: readonly ReplayFrame[], index: number): any {
  const base = frames[0].msg;
  for (let i = Math.min(index, frames.length - 1); i > 0; i -= 1) {
    const msg = frames[i].msg;
    if (msg?.type !== 'action' || !msg.action?._state) continue;
    return {
      type: 'sync',
      recipientRoomSeat: msg.recipientRoomSeat,
      recipientGameSeat: msg.recipientGameSeat,
      snapshot: {
        ...base.snapshot,
        revision: msg.revision,
        matchId: msg.matchId,
        roundId: msg.roundId,
        activeMapping: msg.activeMapping,
        roomChipLedger: msg.roomChipLedger,
        state: msg.action._state,
      },
    };
  }
  return base;
}

export type ReplayStatus = { index: number; total: number; playing: boolean; speed: number };

export class ReplaySocket {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  /** 次に流す frame */
  index = 0;
  playing = false;
  speed = 1;
  /** 長考はこの秒で切る (1 倍速の時) */
  maxGapMs = 4000;
  /** 次の局へ進む手の前 [和了 ・ 精算の板を読む間] はここまで待つ */
  maxRoundGapMs = 8000;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly frames: ReplayFrame[],
    private readonly opts: {
      /** 演出 (ぽっち ・ カットイン等) の最中は次の手を待つ */
      busy?: () => boolean;
      onStatus?: (status: ReplayStatus) => void;
      startIndex?: number;
      autoplay?: boolean;
      /** この frame の手前で止める [録画で 1 局だけ流す時] */
      stopAt?: number;
    } = {},
  ) {
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.();
      this.seek(opts.startIndex ?? 0);
      if (opts.autoplay !== false) this.play();
    }, 0);
  }

  send(data: string): void {
    // 再生では何も送らない。読み直しの求めにだけ今の位置の盤面を返す
    let msg: any;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg?.type === 'resync') setTimeout(() => this.emit(syncAt(this.frames, this.index - 1)), 0);
  }

  close(): void {
    this.pause();
    if (this.readyState === 3) return;
    this.readyState = 3;
  }

  play(): void {
    if (this.readyState !== 1) return;
    if (this.index >= this.frames.length) return;
    this.playing = true;
    this.schedule(0);
    this.status();
  }

  pause(): void {
    this.playing = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.status();
  }

  setSpeed(speed: number): void {
    this.speed = speed > 0 ? speed : 1;
    this.status();
  }

  /** index の frame まで流した後の盤面にして、次は index + 1 から */
  seek(index: number): void {
    const target = Math.max(0, Math.min(index, this.frames.length - 1));
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.emit(syncAt(this.frames, target));
    this.index = target + 1;
    if (this.playing) this.schedule(this.gapBefore(this.index));
    this.status();
  }

  /** 1 手だけ進める */
  step(): void {
    if (this.index >= this.frames.length) return;
    this.deliver();
  }

  private gapBefore(index: number): number {
    if (index <= 0 || index >= this.frames.length) return 0;
    const gap = Date.parse(this.frames[index].at) - Date.parse(this.frames[index - 1].at);
    if (!Number.isFinite(gap) || gap < 0) return 0;
    const type = this.frames[index].msg?.action?.type;
    const cap = type === 'nextRound' || type === 'nextMatch' ? this.maxRoundGapMs : this.maxGapMs;
    return Math.min(gap, cap) / this.speed;
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.playing) return;
      // 演出が終わるまで待つ (対局中は人が演出を見てから打っていた)
      if (this.opts.busy?.()) { this.schedule(200); return; }
      this.deliver();
      if (this.index >= Math.min(this.frames.length, this.opts.stopAt ?? Infinity)) { this.playing = false; this.status(); return; }
      this.schedule(this.gapBefore(this.index));
    }, delayMs);
  }

  private deliver(): void {
    this.emit(this.frames[this.index].msg);
    this.index += 1;
    this.status();
  }

  private emit(msg: any): void {
    if (this.readyState !== 1) return;
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  private status(): void {
    this.opts.onStatus?.({ index: this.index, total: this.frames.length, playing: this.playing, speed: this.speed });
  }
}
