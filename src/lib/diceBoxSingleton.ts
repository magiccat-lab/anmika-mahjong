
// diceBoxSingleton.ts - dice-box [BabylonJS + AmmoJS] を App 起動時に init し
// 全 modal 間で 1 instance 共有。 SaiKoroModal の 1 投目 visible 化問題の根本対策。
// [リョー指示 A 案 2026-05-13]
//
// 使い方:
//   App.svelte onMount: initDiceBox('#dicebox-host')
//   SaiKoroModal mount: attachCanvasTo(stageEl) で canvas を modal 内に move
//   SaiKoroModal unmount: detachCanvas() で hidden host に return
//   roll: rollDice() Promise で 2d6 結果 取得

let diceBox: any = null;
let diceBoxPromise: Promise<any> | null = null;
let onRollResolve: ((vals: [number, number] | null) => void) | null = null;

const DICE_BOX_CONFIG = {
  assetPath: '/assets/dice-box/',
  theme: 'default',
  themeColor: '#d4af37',
  scale: 9,
  gravity: 2.0,
  settleTimeout: 2500,
  startingHeight: 5,
  throwForce: 3,
  spinForce: 3,
  linearDamping: 0.7,
  angularDamping: 0.6,
  mass: 1,
  offscreen: false,
};

export function initDiceBox(hostSelector: string): Promise<any> {
  if (diceBoxPromise) return diceBoxPromise;
  diceBoxPromise = (async () => {
    try {
      // @ts-ignore - no types shipped
      const mod = await import('@3d-dice/dice-box');
      const DiceBox = (mod as any).default ?? mod;
      if ((import.meta as any).env?.DEV) console.log('[dice-singleton] init on', hostSelector);
      diceBox = new DiceBox(hostSelector, DICE_BOX_CONFIG);
      diceBox.onRollComplete = (results: any[]) => {
        if ((import.meta as any).env?.DEV) console.log('[dice-singleton] roll complete', results);
        let vals: [number, number] | null = null;
        try {
          const grp = (results ?? [])[0];
          const rs = grp?.rolls ?? [];
          const d1 = rs[0]?.value;
          const d2 = rs[1]?.value;
          if (typeof d1 === 'number' && typeof d2 === 'number'
              && d1 >= 1 && d1 <= 6 && d2 >= 1 && d2 <= 6) {
            vals = [d1, d2];
          }
        } catch (e) {}
        if (onRollResolve) {
          const cb = onRollResolve;
          onRollResolve = null;
          cb(vals);
        }
      };
      await diceBox.init();
      if ((import.meta as any).env?.DEV) console.log('[dice-singleton] init complete');
      return diceBox;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[dice-singleton] init failed', e);
      diceBoxPromise = null;
      throw e;
    }
  })();
  return diceBoxPromise;
}

export async function rollDice(): Promise<[number, number] | null> {
  if (!diceBox) return null;
  return new Promise((resolve) => {
    onRollResolve = (vals) => resolve(vals);
    try {
      diceBox.clear();
      diceBox.roll('2d6');
    } catch (e) {
      onRollResolve = null;
      resolve(null);
    }
  });
}

export function getCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const host = document.getElementById('dicebox-host');
  return (host?.querySelector('canvas') as HTMLCanvasElement) ?? null;
}

/** canvas は host に残したまま、 host 自体を target 位置に visible オーバレイする
 *  [移動するとBabylon engine の render loop 状態が壊れて 1 投目以降も描画されない問題対策] */
export function attachCanvasTo(target: HTMLElement): boolean {
  if (typeof document === 'undefined') return false;
  const host = document.getElementById('dicebox-host');
  if (!host || !target) return false;
  // target rect 取得 → host を同位置に positioning
  const rect = target.getBoundingClientRect();
  host.style.position = 'fixed';
  host.style.top = rect.top + 'px';
  host.style.left = rect.left + 'px';
  host.style.width = rect.width + 'px';
  host.style.height = rect.height + 'px';
  host.style.zIndex = '1015'; // SaiKoroModal [1010] より上
  host.style.pointerEvents = 'none';
  // ResizeObserver で target が動いたら host も追従
  try {
    const ro = new ResizeObserver(() => {
      const r = target.getBoundingClientRect();
      host.style.top = r.top + 'px';
      host.style.left = r.left + 'px';
      host.style.width = r.width + 'px';
      host.style.height = r.height + 'px';
    });
    ro.observe(target);
    (host as any).__ro = ro;
  } catch (e) {}
  // Babylon engine.resize 必要 [host の size 変更で canvas backbuffer 追従]
  try {
    const eng = (diceBox as any)?.engine ?? (diceBox as any)?.babylon?.engine;
    if (eng && typeof eng.resize === 'function') eng.resize();
  } catch (e) {}
  return true;
}

/** host を hidden 位置に戻す */
export function detachCanvas(): void {
  if (typeof document === 'undefined') return;
  const host = document.getElementById('dicebox-host');
  if (!host) return;
  try { (host as any).__ro?.disconnect?.(); } catch (e) {}
  host.style.top = '-9999px';
  host.style.left = '-9999px';
  host.style.zIndex = '';
}

export function isReady(): boolean {
  return diceBox !== null;
}
