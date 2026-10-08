import { describe, expect, it } from 'vitest';
import {
  canHostToggleCpuProxy,
  isMemberCpuProxy,
  isMemberDisconnected,
  type OnlineMemberLike,
} from '../onlineSeats';

// [2026-10-09 遊真 C1/A2] 席の「切断中」「CPU 代打ち」と host のトグルを出す条件

const human = (over: Partial<OnlineMemberLike> = {}): OnlineMemberLike =>
  ({ seat: 1, user_id: 'u1', username: 'あ', is_cpu: false, ...over });
const cpu = (over: Partial<OnlineMemberLike> = {}): OnlineMemberLike =>
  ({ seat: 2, user_id: 'CPU_ABCD_1', username: 'CPU', is_cpu: true, ...over });

describe('isMemberDisconnected', () => {
  it('connected:false の人間だけ true [省略 ・ true は false]', () => {
    expect(isMemberDisconnected(human({ connected: false }))).toBe(true);
    expect(isMemberDisconnected(human({ connected: true }))).toBe(false);
    expect(isMemberDisconnected(human())).toBe(false);
    expect(isMemberDisconnected(undefined)).toBe(false);
  });
  it('CPU 席は connected:false でも切断中にしない', () => {
    expect(isMemberDisconnected(cpu({ connected: false }))).toBe(false);
  });
});

describe('isMemberCpuProxy', () => {
  it('cpu_proxy:true の人間だけ true', () => {
    expect(isMemberCpuProxy(human({ cpu_proxy: true }))).toBe(true);
    expect(isMemberCpuProxy(human({ cpu_proxy: false }))).toBe(false);
    expect(isMemberCpuProxy(human())).toBe(false);
    expect(isMemberCpuProxy(cpu({ cpu_proxy: true }))).toBe(false);
    expect(isMemberCpuProxy(undefined)).toBe(false);
  });
});

describe('canHostToggleCpuProxy', () => {
  it('host が自分以外の人間席に出す', () => {
    expect(canHostToggleCpuProxy(human(), true, 'host-user')).toBe(true);
    expect(canHostToggleCpuProxy(human({ cpu_proxy: true }), true, 'host-user')).toBe(true);
  });
  it('host でなければ出さない', () => {
    expect(canHostToggleCpuProxy(human(), false, 'someone')).toBe(false);
  });
  it('自分の席 ・ CPU 席 ・ 空席には出さない', () => {
    expect(canHostToggleCpuProxy(human({ user_id: 'host-user' }), true, 'host-user')).toBe(false);
    expect(canHostToggleCpuProxy(cpu(), true, 'host-user')).toBe(false);
    expect(canHostToggleCpuProxy(undefined, true, 'host-user')).toBe(false);
  });
});
