// [2026-11-12 リョー「0032の」] 絞りの中継を ws.log に 1 行残す。後から「届いたか」を席ごとに見るため
// 契約: 時刻 (ISO) ・ 部屋 ・ 送った席 ・ phase/色 ・ relay か drop ・ 送り先の席と接続の状態
import { describe, expect, it } from 'vitest';
import { pochiFxLogLine } from '../../../server/ws_server';

const member = (seat: number, readyState: number | null) => ({
  seat, user_id: `u${seat}`, username: `p${seat}`, is_cpu: false,
  ws: readyState === null ? null : ({ readyState } as any),
  generation: 1, connected: readyState === 1, cpuProxy: false,
});

describe('pochiFxLogLine', () => {
  const room: any = {
    roomId: '6HJK',
    members: new Map([['a', member(0, 1)], ['b', member(1, 3)], ['c', member(2, null)]]),
    spectators: new Map(),
  };
  const now = new Date('2026-11-11T15:32:05.000Z');

  it('reveal は色と送り先の接続の状態を残す [送った席は送り先に入れない]', () => {
    const line = pochiFxLogLine(room, 2, { phase: 'reveal', color: 'yellow' } as any, true, now);
    expect(line).toBe('[anmika-ws] pochiFx 2026-11-11T15:32:05.000Z room=6HJK seat=2 reveal/yellow relay to=0:open,1:ws3 spect=0');
  });

  it('間引きや壊れた中身は drop で残す', () => {
    expect(pochiFxLogLine(room, 0, { phase: 'open' } as any, false, now)).toContain('seat=0 open drop to=1:ws3,2:none');
    expect(pochiFxLogLine(room, 0, null, false, now)).toContain('invalid drop');
  });
});
