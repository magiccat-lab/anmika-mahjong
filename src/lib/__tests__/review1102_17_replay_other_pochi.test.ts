// [クラウドレビュー 11-02 #17] 対局画面の牌譜再生で、他の席の白ぽっち (でかぽっち) の絞りが出ない。
// server の publicEventForSeat が他の席の zimo の pai を null にするため、App の走査 (POCHI_COLOR_MAP[ev.pai])
// が他の席の分を拾えなかった。牌譜再生 (buildMatchReplay) の frames にだけ、ぽっちの牌を他の席にも載せる。
// 対局中 (captureSeatProjection) は今まで通り伏せる。ぽっちでない牌は再生でも伏せたまま
import { it, expect } from 'vitest';
import { createRoomAuthority } from '../../../server/authority';
import { buildMatchReplay, captureSeatProjection, revealReplayPochi, turnTimeoutAction, reactionTimeoutAction } from '../../../server/ws_server';
import { ROOM_SNAPSHOT_SCHEMA_VERSION, appendAcceptedCommand, type CanonicalRoomSnapshot } from '../../../server/protocol';
import { defaultSanmaRule, generateTilePool } from '../shan3';

const POCHI = /^z5[brgy]$/;

function gen(n: number) {
  const pool = generateTilePool(defaultSanmaRule()).map(String);
  let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const members = [0, 1, 2].map((seat) => ({ seat, user_id: `u${seat}`, username: `P${seat}`, is_cpu: false }));
  const start = { preShuffledPool: pool, qijia: 0, members, chipLedger: { 0: 0, 1: 0, 2: 0 }, changshu: 1 } as any;
  let snap: CanonicalRoomSnapshot = { schemaVersion: ROOM_SNAPSHOT_SCHEMA_VERSION, roomId: 'R', roomInstanceId: 'i', matchId: 1, roundId: 1, revision: 0, started: true, start, commands: [], updatedAt: '2026-10-26T12:00:00.000Z' };
  const a = createRoomAuthority({ preShuffledPool: pool, qijia: 0, changshu: 1 });
  const commands: any[] = [];
  let t = Date.parse('2026-10-26T12:00:01.000Z');
  for (let k = 0; k < n; k++) {
    const tries: Array<[number, any]> = [];
    const ta = turnTimeoutAction(a); if (ta) tries.push([a.currentPlayer(), ta]);
    for (const p of [0, 1, 2]) tries.push([p, reactionTimeoutAction(a, p)]);
    let ok = false;
    for (const [seat, action] of tries) {
      if (a.validateAndApply(seat, structuredClone(action), members as any)) continue;
      a.takeCanonicalChipEffects(); a.takePendingCutins();
      const r = appendAcceptedCommand(snap, { commandId: `c${k}`, actorSeat: seat, actorRoomSeat: seat, fromUserId: `u${seat}`, action }, new Date(t));
      snap = r.snapshot; commands.push(r.command); t += 700; ok = true; break;
    }
    if (!ok) break;
  }
  return { snap: { ...snap, commands: [] }, commands, authority: a };
}

const projOf = (msg: any): any => msg?.type === 'sync' ? msg.snapshot?.state : msg?.type === 'action' ? msg.action?._state : null;

it('牌譜再生の frames では他の席のぽっちのツモ牌が見え、ぽっちでない牌は伏せたまま', () => {
  const { snap, commands, authority } = gen(400);
  const bySeat = [-1, 0, 1, 2].map((seat) => buildMatchReplay(snap, commands, 1, seat).frames);
  let othersPochi = 0;
  let othersPlain = 0;
  for (let k = 0; k < bySeat[0].length; k++) {
    const views = bySeat.map((frames) => projOf(frames[k].msg));
    if (!views[0]) continue;
    const evs = (seat: number) => views[seat + 1].publicEvents as any[];
    evs(0).forEach((e, i) => {
      if (e.type !== 'zimo') return;
      const truth = evs(e.player)[i].pai as string;
      for (const viewer of [-1, 0, 1, 2]) {
        if (viewer === e.player) continue;
        const seen = evs(viewer)[i].pai;
        if (POCHI.test(truth)) { othersPochi++; expect(seen).toBe(truth); }
        else { othersPlain++; expect(seen).toBeNull(); }
      }
    });
  }
  expect(othersPlain).toBeGreaterThan(0);
  expect(othersPochi).toBeGreaterThan(0);
  // 対局中の投影は他の席のツモ牌を伏せたまま
  for (const viewer of [-1, 0, 1, 2]) {
    const live = captureSeatProjection(authority, viewer) as any;
    for (const e of live.publicEvents) if (e.type === 'zimo' && e.player !== viewer) expect(e.pai).toBeNull();
  }
});

it('でかぽっち (リーチ一発の 1筒 ・ 2筒) は直前のツモの色と牌を他の席にも載せる', () => {
  const events = [{ type: 'zimo', player: 1, pai: 'm9' }, { type: 'zimo', player: 2, pai: 'p1' }];
  const fake = { canonicalState: () => ({ game: { events, lastZimoInfo: { player: 2, pai: 'p1', pochi: 'yellow', gold: false } } }) } as any;
  const msg = { type: 'action', action: { _state: {
    publicEvents: [{ type: 'zimo', player: 1, pai: null }, { type: 'zimo', player: 2, pai: null }],
    fields: { lastZimoInfo: { player: 2, pai: null, pochi: null, gold: false } },
  } } };
  const out = revealReplayPochi(msg, fake) as any;
  expect(out.action._state.publicEvents.map((e: any) => e.pai)).toEqual([null, 'p1']);
  expect(out.action._state.fields.lastZimoInfo).toMatchObject({ player: 2, pai: 'p1', pochi: 'yellow' });
  // 色の無い 1筒は伏せたまま
  const plain = { canonicalState: () => ({ game: { events, lastZimoInfo: { player: 2, pai: 'p1', pochi: null, gold: false } } }) } as any;
  const msg2 = { type: 'action', action: { _state: {
    publicEvents: [{ type: 'zimo', player: 1, pai: null }, { type: 'zimo', player: 2, pai: null }],
    fields: { lastZimoInfo: { player: 2, pai: null, pochi: null, gold: false } },
  } } };
  const out2 = revealReplayPochi(msg2, plain) as any;
  expect(out2.action._state.publicEvents.map((e: any) => e.pai)).toEqual([null, null]);
});
