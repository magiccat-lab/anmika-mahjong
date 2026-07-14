import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSaiKoroWatchdogs,
  SAI_KORO_INIT_TIMEOUT_MS,
  SAI_KORO_ROLL_TIMEOUT_MS,
} from '../saiKoroWatchdogs';

afterEach(() => {
  vi.useRealTimers();
});

describe('WSA-A9 sai-koro presentation watchdogs', () => {
  it('falls back when 3D initialization misses its deadline', () => {
    vi.useFakeTimers();
    const onInitTimeout = vi.fn();
    const watchdogs = createSaiKoroWatchdogs({ onInitTimeout, onRollTimeout: vi.fn() });

    watchdogs.armInit();
    vi.advanceTimersByTime(SAI_KORO_INIT_TIMEOUT_MS);

    expect(onInitTimeout).toHaveBeenCalledTimes(1);
    expect(watchdogs.completeInit()).toBe(false);
  });

  it('keeps normal 3D mode when initialization completes in time', () => {
    vi.useFakeTimers();
    const onInitTimeout = vi.fn();
    const watchdogs = createSaiKoroWatchdogs({ onInitTimeout, onRollTimeout: vi.fn() });

    watchdogs.armInit();
    expect(watchdogs.completeInit()).toBe(true);
    vi.advanceTimersByTime(SAI_KORO_INIT_TIMEOUT_MS);

    expect(onInitTimeout).not.toHaveBeenCalled();
  });

  it('finishes through 2D once when onRollComplete never arrives', () => {
    vi.useFakeTimers();
    const onRollTimeout = vi.fn();
    const watchdogs = createSaiKoroWatchdogs({ onInitTimeout: vi.fn(), onRollTimeout });

    watchdogs.armRoll();
    vi.advanceTimersByTime(SAI_KORO_ROLL_TIMEOUT_MS);

    expect(onRollTimeout).toHaveBeenCalledTimes(1);
    expect(watchdogs.completeRoll()).toBe(false);
  });

  it('cancels both deadlines on teardown', () => {
    vi.useFakeTimers();
    const onInitTimeout = vi.fn();
    const onRollTimeout = vi.fn();
    const watchdogs = createSaiKoroWatchdogs({ onInitTimeout, onRollTimeout });

    watchdogs.armInit();
    watchdogs.armRoll();
    watchdogs.cancel();
    vi.runAllTimers();

    expect(onInitTimeout).not.toHaveBeenCalled();
    expect(onRollTimeout).not.toHaveBeenCalled();
  });
});
