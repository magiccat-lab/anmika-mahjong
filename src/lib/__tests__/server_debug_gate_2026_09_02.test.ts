import { afterEach, describe, expect, it } from 'vitest';
import { isDebugEnabled } from '../helpers';

// [2026-09-02] 本番 ws の stdout に Game3 の配牌ダンプが無条件で出続け、ws.log が 3.5GB になった。
// node [ws_server / vitest] では既定 OFF、ANMIKA_SERVER_DEBUG=1 の時だけ ON を固定する。
describe('server-side debug log gate', () => {
  const previous = process.env.ANMIKA_SERVER_DEBUG;
  afterEach(() => {
    if (previous === undefined) delete process.env.ANMIKA_SERVER_DEBUG;
    else process.env.ANMIKA_SERVER_DEBUG = previous;
  });

  it('node では既定 OFF [window 無し]', () => {
    delete process.env.ANMIKA_SERVER_DEBUG;
    expect(typeof window).toBe('undefined');
    expect(isDebugEnabled()).toBe(false);
  });

  it('ANMIKA_SERVER_DEBUG=1 で ON', () => {
    process.env.ANMIKA_SERVER_DEBUG = '1';
    expect(isDebugEnabled()).toBe(true);
  });

  it('"1" 以外の値では ON にしない', () => {
    process.env.ANMIKA_SERVER_DEBUG = 'true';
    expect(isDebugEnabled()).toBe(false);
  });
});
