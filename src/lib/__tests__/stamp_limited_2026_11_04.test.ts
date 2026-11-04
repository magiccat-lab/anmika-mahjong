// 限定スタンプ [2026-11-04 リョー「急に静か、俺にだけ搭載して」「ちなみに俺は全種使えるようにして」「asumeに「週1オンミカ！」ってスタンプもつけて」]
import { describe, it, expect } from 'vitest';
import { LIMITED_STAMP_IDS, canUseLimitedStamp, limitedStampsFor, stampsOpenToAll } from '../stampAccess';
import { STAMP_IDS, STAMP_LABELS } from '../store';
import { canSendStamp } from '../../../server/ws_server';

const MAGICREN = '398738170314752012';
const NOIMI = '410812617263808513';
const ASUME = '514403167165743104';
const NOBODY = '1';

describe('限定スタンプの pallet [limitedStampsFor]', () => {
  it('持ち主は自分の限定だけ見える', () => {
    expect(limitedStampsFor(NOIMI)).toEqual(['toutotsu']);
    expect(limitedStampsFor(ASUME)).toEqual(['shuichi']);
  });
  it('magicren は 6 種全部', () => {
    expect(limitedStampsFor(MAGICREN)).toEqual([...LIMITED_STAMP_IDS]);
    expect(LIMITED_STAMP_IDS).toHaveLength(6);
  });
  it('持っていない人 ・ 未ログインは 0 種', () => {
    expect(limitedStampsFor(NOBODY)).toEqual([]);
    expect(limitedStampsFor(null)).toEqual([]);
    expect(limitedStampsFor('')).toEqual([]);
  });
  it('共有 36 種はそのまま、限定は表示側が知っている [ラベルあり]', () => {
    expect(STAMP_IDS).toHaveLength(36);
    for (const id of LIMITED_STAMP_IDS) expect(STAMP_LABELS[id]).toBeTruthy();
  });
});

describe('server の許可 [canSendStamp]', () => {
  it('共有スタンプは誰でも送れる', () => {
    expect(canSendStamp('doko', NOBODY)).toBe(true);
  });
  it('限定は持ち主と magicren だけ', () => {
    expect(canSendStamp('toutotsu', NOIMI)).toBe(true);
    expect(canSendStamp('toutotsu', NOBODY)).toBe(false);
    expect(canSendStamp('toutotsu', ASUME)).toBe(false);
    for (const id of LIMITED_STAMP_IDS) expect(canSendStamp(id, MAGICREN)).toBe(true);
    expect(canUseLimitedStamp('kyuni', NOIMI)).toBe(false);
  });
  it('知らない id ・ 文字以外 ・ user 無しは弾く', () => {
    expect(canSendStamp('nothing', MAGICREN)).toBe(false);
    expect(canSendStamp(5, MAGICREN)).toBe(false);
    expect(canSendStamp('kyuni', undefined)).toBe(false);
  });
});

// [2026-11-04 先輩「全員cpuにも出してあげよう」] 人が 1 人だけの卓は誰でも限定を全種
describe('相手が全員 CPU の卓 [stampsOpenToAll]', () => {
  const human = (id: string) => ({ user_id: id, is_cpu: false });
  const cpu = (id: string) => ({ user_id: id, is_cpu: true });
  it('人 1 + CPU は開く、人 2 以上は開かない', () => {
    expect(stampsOpenToAll([human(NOBODY), cpu('CPU_X_1'), cpu('CPU_X_2')])).toBe(true);
    expect(stampsOpenToAll([human(NOBODY), human(NOIMI), cpu('CPU_X_1')])).toBe(false);
  });
  it('開いた卓では誰でも限定を送れる、閉じた卓では持ち主だけ', () => {
    for (const id of LIMITED_STAMP_IDS) expect(canSendStamp(id, NOBODY, true)).toBe(true);
    expect(canSendStamp('toutotsu', NOBODY, false)).toBe(false);
    expect(canSendStamp('nai_stamp', NOBODY, true)).toBe(false);
  });
});
