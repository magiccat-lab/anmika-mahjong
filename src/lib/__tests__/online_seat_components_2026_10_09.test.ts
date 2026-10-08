import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import OnlineSeatStatus from '../OnlineSeatStatus.svelte';
import DeadlineBar from '../DeadlineBar.svelte';
import type { OnlineDeadline } from '../onlineDeadline';

// [2026-10-09 遊真 C1/A2] 席の札の部品が出す物 [server render で HTML を見る]

const human = { seat: 1, user_id: 'u1', username: 'あ', is_cpu: false };

describe('OnlineSeatStatus', () => {
  it('切断中の人間席に「切断中」を出す', () => {
    const { body } = render(OnlineSeatStatus, { props: { member: { ...human, connected: false } } });
    expect(body).toContain('切断中');
    expect(body).not.toContain('CPU 代打ち');
    expect(body).not.toContain('<button');
  });
  it('cpu_proxy の席に「CPU 代打ち」と、host には「戻す」を出す', () => {
    const { body } = render(OnlineSeatStatus, { props: { member: { ...human, cpu_proxy: true }, canToggle: true } });
    expect(body).toContain('CPU 代打ち');
    expect(body).toContain('戻す');
    expect(body).not.toContain('CPU に替える');
  });
  it('host で代打ちでない人間席には「CPU に替える」を出す', () => {
    const { body } = render(OnlineSeatStatus, { props: { member: human, canToggle: true } });
    expect(body).toContain('CPU に替える');
  });
  it('host でなく何も無い席は何も出さない', () => {
    const { body } = render(OnlineSeatStatus, { props: { member: human } });
    expect(body).not.toContain('class="oss"');
    expect(render(OnlineSeatStatus, { props: { member: undefined, canToggle: true } }).body).not.toContain('<button');
  });
  it('CPU 席には切断中も代打ちも出さない', () => {
    const cpu = { seat: 2, user_id: 'CPU_ABCD_1', username: 'CPU', is_cpu: true, connected: false, cpu_proxy: true };
    const { body } = render(OnlineSeatStatus, { props: { member: cpu } });
    expect(body).not.toContain('切断中');
    expect(body).not.toContain('CPU 代打ち');
  });
});

describe('DeadlineBar', () => {
  const dl = (over: Partial<OnlineDeadline> = {}): OnlineDeadline => ({
    kind: 'turn', seats: [1], endsAt: performance.now() + 20_000, totalMs: 40_000, revision: 3, ...over,
  });
  it('待たれている席の札に棒を出し、残り時間と満タン比を CSS 変数で渡す', () => {
    const { body } = render(DeadlineBar, { props: { deadline: dl(), roomSeat: 1 } });
    expect(body).toContain('class="dl-bar');
    const ms = Number(/--dl-ms: (\d+)ms/.exec(body)?.[1]);
    expect(ms).toBeGreaterThan(19_000);
    expect(ms).toBeLessThanOrEqual(20_000);
    const from = Number(/--dl-from: ([0-9.]+)/.exec(body)?.[1]);
    expect(from).toBeGreaterThan(0.45);
    expect(from).toBeLessThanOrEqual(0.5);
    // 赤に変わるのは残り 10 秒の手前 [20 秒 - 10 秒]
    const delay = Number(/--dl-urgent-delay: (\d+)ms/.exec(body)?.[1]);
    expect(delay).toBeGreaterThan(9_000);
    expect(delay).toBeLessThanOrEqual(10_000);
  });
  it('別の席 ・ 期限切れ ・ 待ち無しは何も出さない', () => {
    expect(render(DeadlineBar, { props: { deadline: dl(), roomSeat: 0 } }).body).not.toContain('dl-bar');
    expect(render(DeadlineBar, { props: { deadline: dl({ endsAt: performance.now() - 1 }), roomSeat: 1 } }).body).not.toContain('dl-bar');
    expect(render(DeadlineBar, { props: { deadline: null, roomSeat: 1 } }).body).not.toContain('dl-bar');
    expect(render(DeadlineBar, { props: { deadline: dl(), roomSeat: null } }).body).not.toContain('dl-bar');
  });
  it('残り 10 秒以内から始まる時は、赤への切り替え delay が 0', () => {
    const { body } = render(DeadlineBar, { props: { deadline: dl({ endsAt: performance.now() + 6000, totalMs: 6000 }), roomSeat: 1 } });
    expect(body).toContain('--dl-urgent-delay: 0ms');
  });
});
