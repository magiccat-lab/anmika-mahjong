import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAutoTsumokiriScheduler,
  type AutoTsumokiriToken,
} from '../autoTsumokiriScheduler';

afterEach(() => {
  vi.useRealTimers();
});

function token(player: 0 | 1 | 2, revision: string): AutoTsumokiriToken {
  return { player, revision };
}

describe('WSA-A8 single auto-tsumokiri scheduler', () => {
  it('deduplicates the normal and forced-lizhi reservation for one position', () => {
    vi.useFakeTimers();
    let current: AutoTsumokiriToken | null = token(0, 'r1');
    const fire = vi.fn();
    const scheduler = createAutoTsumokiriScheduler({ delayMs: 600, readCurrent: () => current, fire });

    scheduler.schedule(token(0, 'r1'));
    scheduler.schedule(token(0, 'r1'));
    vi.advanceTimersByTime(600);

    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith(0);
    current = null;
  });

  it('cancels the old reservation when a newer player/revision is scheduled', () => {
    vi.useFakeTimers();
    let current: AutoTsumokiriToken | null = token(0, 'r1');
    const fire = vi.fn();
    const scheduler = createAutoTsumokiriScheduler({ delayMs: 600, readCurrent: () => current, fire });

    scheduler.schedule(token(0, 'r1'));
    current = token(2, 'r2');
    scheduler.schedule(current);
    vi.advanceTimersByTime(600);

    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith(2);
  });

  it('does not fire if the current phase no longer matches the reservation', () => {
    vi.useFakeTimers();
    let current: AutoTsumokiriToken | null = token(0, 'r1');
    const fire = vi.fn();
    const scheduler = createAutoTsumokiriScheduler({ delayMs: 600, readCurrent: () => current, fire });

    scheduler.schedule(current);
    current = token(2, 'r2');
    vi.advanceTimersByTime(600);

    expect(fire).not.toHaveBeenCalled();
  });

  it('cancels a pending reservation on teardown or blocked phase', () => {
    vi.useFakeTimers();
    const current = token(0, 'r1');
    const fire = vi.fn();
    const scheduler = createAutoTsumokiriScheduler({ delayMs: 600, readCurrent: () => current, fire });

    scheduler.schedule(current);
    scheduler.cancel();
    vi.advanceTimersByTime(600);

    expect(fire).not.toHaveBeenCalled();
  });
});
