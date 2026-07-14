export const SAI_KORO_INIT_TIMEOUT_MS = 5_000;
export const SAI_KORO_ROLL_TIMEOUT_MS = 4_000;

export function createSaiKoroWatchdogs(callbacks: {
  onInitTimeout: () => void;
  onRollTimeout: () => void;
}) {
  let initTimer: ReturnType<typeof setTimeout> | null = null;
  let rollTimer: ReturnType<typeof setTimeout> | null = null;

  const clearInit = (): boolean => {
    if (initTimer === null) return false;
    clearTimeout(initTimer);
    initTimer = null;
    return true;
  };
  const clearRoll = (): boolean => {
    if (rollTimer === null) return false;
    clearTimeout(rollTimer);
    rollTimer = null;
    return true;
  };

  return {
    armInit(): void {
      clearInit();
      initTimer = setTimeout(() => {
        initTimer = null;
        callbacks.onInitTimeout();
      }, SAI_KORO_INIT_TIMEOUT_MS);
    },
    completeInit: clearInit,
    armRoll(): void {
      clearRoll();
      rollTimer = setTimeout(() => {
        rollTimer = null;
        callbacks.onRollTimeout();
      }, SAI_KORO_ROLL_TIMEOUT_MS);
    },
    completeRoll: clearRoll,
    cancel(): void {
      clearInit();
      clearRoll();
    },
  };
}
