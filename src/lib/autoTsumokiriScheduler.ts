import type { PlayerId } from './types';

export type AutoTsumokiriToken = {
  player: PlayerId;
  revision: string;
};

export function createAutoTsumokiriScheduler(opts: {
  delayMs: number;
  readCurrent: () => AutoTsumokiriToken | null;
  fire: (expectedPlayer: PlayerId) => void;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scheduledKey: string | null = null;
  const keyOf = (token: AutoTsumokiriToken): string => `${token.player}:${token.revision}`;

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    scheduledKey = null;
  };

  return {
    schedule(token: AutoTsumokiriToken): void {
      const key = keyOf(token);
      if (timer !== null && scheduledKey === key) return;
      cancel();
      scheduledKey = key;
      timer = setTimeout(() => {
        timer = null;
        scheduledKey = null;
        const current = opts.readCurrent();
        if (!current || keyOf(current) !== key) return;
        opts.fire(token.player);
      }, opts.delayMs);
    },
    cancel,
  };
}
