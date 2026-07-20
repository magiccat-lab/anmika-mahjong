// 事故復帰の巻き戻し土台 [2026-07-20 リョー要望:
//   「オンライン対戦とかで途中で事故ったときにその状況から復帰するボタンとか作りたい」]
//
// room は event sourcing [snapshot + 受理コマンド列] で保持されていて、
// restoreAuthority がコマンドを replay して状態を再構築する。
// つまり「コマンド列を途中で切って replay し直す」だけで任意地点へ戻せる。
// ここではその永続化側 [RoomPersistence.rewindRoom] を固定する。
import { describe, it, expect } from 'vitest';
import { RoomPersistence } from '../../../server/persistence';
import { ROOM_SNAPSHOT_SCHEMA_VERSION, type CanonicalRoomSnapshot, type AcceptedRoomCommand } from '../../../server/protocol';

function snap(roomId: string, revision: number): CanonicalRoomSnapshot {
  return {
    schemaVersion: ROOM_SNAPSHOT_SCHEMA_VERSION,
    roomId,
    roomInstanceId: 'inst-1',
    matchId: 1,
    roundId: 1,
    revision,
    started: true,
    start: null,
    commands: [],
    updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

function cmd(revision: number): AcceptedRoomCommand {
  return {
    commandId: `c${revision}`,
    revision,
    actorSeat: 0,
    fromUserId: '',
    action: { type: 'discard', pai: 'p1' },
    matchId: 1,
    roundId: 1,
    acceptedAt: '2026-07-20T00:00:00.000Z',
  } as AcceptedRoomCommand;
}

function seed(): RoomPersistence {
  const p = new RoomPersistence(':memory:');
  for (let r = 1; r <= 5; r++) {
    p.saveAcceptedCommand(snap('room-a', r), cmd(r), { ok: true } as any);
  }
  // 別 room を巻き添えにしないための対照
  p.saveAcceptedCommand(snap('room-b', 1), cmd(1), { ok: true } as any);
  return p;
}

describe('RoomPersistence.rewindRoom [事故復帰の巻き戻し]', () => {
  it('指定 revision より後のコマンドだけ捨てる', () => {
    const p = seed();
    expect(p.loadCommands('room-a').map((c) => c.revision)).toEqual([1, 2, 3, 4, 5]);
    const dropped = p.rewindRoom(snap('room-a', 3), 3);
    expect(dropped).toBe(2);
    expect(p.loadCommands('room-a').map((c) => c.revision)).toEqual([1, 2, 3]);
    p.close();
  });

  it('巻き戻した snapshot の revision が保存される', () => {
    const p = seed();
    p.rewindRoom(snap('room-a', 2), 2);
    expect(p.loadSnapshot('room-a')?.revision).toBe(2);
    p.close();
  });

  it('他の room のコマンドは消さない', () => {
    const p = seed();
    p.rewindRoom(snap('room-a', 1), 1);
    expect(p.loadCommands('room-a').map((c) => c.revision)).toEqual([1]);
    expect(p.loadCommands('room-b').map((c) => c.revision)).toEqual([1]);
    p.close();
  });

  it('巻き戻し後は同じ command_id を再受理できる [revision 再利用]', () => {
    const p = seed();
    p.rewindRoom(snap('room-a', 3), 3);
    // 捨てた revision 4 を別の行動で入れ直す
    expect(() => p.saveAcceptedCommand(snap('room-a', 4), cmd(4), { ok: true } as any)).not.toThrow();
    expect(p.loadCommands('room-a').map((c) => c.revision)).toEqual([1, 2, 3, 4]);
    p.close();
  });

  it('全部巻き戻す [revision 0] とコマンドが空になる', () => {
    const p = seed();
    const dropped = p.rewindRoom(snap('room-a', 0), 0);
    expect(dropped).toBe(5);
    expect(p.loadCommands('room-a')).toEqual([]);
    p.close();
  });
});
