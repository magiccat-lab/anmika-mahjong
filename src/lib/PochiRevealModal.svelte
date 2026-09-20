
<script lang="ts">
  // FX-02 P1: compact tile and original vector caption. Close safeguards stay independent.
  import { onMount, onDestroy } from 'svelte';
  import { POCHI_ARTWORK } from './fxArtwork';
  export let artwork = POCHI_ARTWORK;
  import { playSound } from './prefs';
  export let player: number;
  export let color: 'blue' | 'red' | 'green' | 'yellow';
  export let isCpu: boolean = false;
  export let onClose: () => void = () => {};

  let revealed = false;
  let closing = false;

  // [2026-07-21] 誰の引き牌か。リョーが P1 の演出を自分のツモと誤認した
  $: seatLabel = `player ${player}`;

  function colorLabel(c: string): string {
    return { blue: '青', red: '赤', green: '緑', yellow: '黄' }[c] ?? c;
  }
  function isPositive(c: string): boolean {
    return c === 'blue' || c === 'green';
  }
  function colorHex(c: string): string {
    return { blue: '#3a78ff', red: '#ff4444', green: '#33dd88', yellow: '#ffd633' }[c] ?? '#fff';
  }
  // [2026-09-14] ミュート設定を見る。prefs.muted なら鳴らさない。
  function playSE(src: string, volume = 0.6): void {
    playSound(src, volume);
  }

  // mount 直後 cutin SE 鳴らす [カットイン演出と同期]
  onMount(() => {
    playSE('/sounds/cutin.mp3', 0.55);
  });

  // 2026-05-16 yuma fix: unmount 中の setTimeout callback でゾンビ onClose 呼出を防ぐため
  // timer を 管理して onDestroy で cleanup
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let cpuTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  // 2026-07-22 fix [リョー報告: 追いかけリーチ時に白ぽっち演出で停止、ダンプ不可]:
  // close 経路が 1.5s timer 1 本だけだと、timer が何かの拍子に失われた時に
  // 全画面 overlay が永久に残って入力を全部塞ぐ。閉じ方を 3 重にする:
  //   1. 通常: 開示 1.5s 後の auto close
  //   2. escape hatch: 開示済みならクリックで即閉じ
  //   3. deadline: mount 10s で未開示なら自動開示、開示済み残留なら強制 close
  function forceClose(): void {
    if (closing) return;
    closing = true;
    onClose();
  }

  function reveal(): void {
    if (closing) return;
    if (revealed) { forceClose(); return; }
    revealed = true;
    // リョー指示: ラッパ ファンファーレ [正] / 残念 SE [逆]
    playSE(isPositive(color) ? '/sounds/se_a.mp3' : '/sounds/se_b.mp3', 0.65);
    closeTimer = setTimeout(forceClose, 1500);
  }

  if (isCpu) {
    cpuTimer = setTimeout(reveal, 900);
  }

  deadlineTimer = setTimeout(() => {
    if (!revealed) {
      reveal();
      deadlineTimer = setTimeout(forceClose, 3000);
    } else {
      forceClose();
    }
  }, 10000);

  onDestroy(() => {
    if (closeTimer) clearTimeout(closeTimer);
    if (cpuTimer) clearTimeout(cpuTimer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
  });
</script>

<!-- Three elements. No dimming; opaque paint is limited to the tile and caption. -->
<div class="overlay" class:revealed role="dialog" aria-label={revealed ? `${seatLabel} ${colorLabel(color)}ぽっち ${isPositive(color) ? '正' : '逆'}` : `${seatLabel} 白ぽっち 未開封`}
  tabindex="-1" on:click={reveal} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); } }}>
  <button class="pochi-tile" data-seal={revealed ? (isPositive(color) ? '正' : '逆') : ''} class:revealed style:--pochi={revealed ? colorHex(color) : 'transparent'}
    aria-label={revealed ? `${colorLabel(color)}ぽっち・閉じる` : '白ぽっちをめくる'}></button>
  <button class="pochi-caption" style:background-image={`url("${artwork}")`}
    data-owner={`${seatLabel} の引き`}
    data-result={revealed ? `${colorLabel(color)}ぽっち   ${isPositive(color) ? '正' : '逆'}   / 閉じる` : (isCpu ? '白ぽっち / めくり中' : '白ぽっち / タップでめくる')}
    aria-label={revealed ? '開示を閉じる' : '白ぽっちをめくる'}></button>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 9999; cursor: pointer;
    /* [2026-09-20 検収] 28% だと横に伸びる札が中央の点数パネルに重なった。
       札の右端 (anchor + 12 + 190px) がパネルの左端より手前で止まる位置へ寄せる */
    --anchor-x: 18%; --anchor-y: 68%; outline: none; }
  .pochi-tile { position: absolute; left: var(--anchor-x); top: var(--anchor-y);
    width: 60px; height: 82px; padding: 0; border: 1px solid #d9b453;
    border-bottom: 5px solid #c4bda9; border-radius: 6px; background: #f5f0df;
    transform: translate(-100%, -50%); cursor: pointer; animation: tileIn .24s ease-out; }
  .pochi-tile::after { content: '?'; position: absolute; inset: 0; display: grid; place-items: center;
    font: inherit; font-size: 32px; color: #776b49; }
  .pochi-tile.revealed { animation: tileReveal .24s ease-out; }
  .pochi-tile.revealed::before { content: attr(data-seal); position: absolute;
    right: -9px; top: -12px; width: 25px; height: 25px; border: 1px solid #d9b453;
    border-radius: 50%; background: #102b25; color: #d9b453;
    font: inherit; font-size: 17px; line-height: 25px; }
  .pochi-tile.revealed::after { content: ''; inset: 31px 20px; border-radius: 50%; background: var(--pochi); }
  .pochi-caption { position: absolute; left: var(--anchor-x); top: var(--anchor-y);
    width: 190px; height: 90px; margin-left: 12px; padding: 0; transform: translateY(-50%);
    border: 0; border-bottom: 1px solid #d9b453; background-color: #102b25f5;
    background-size: 164px auto; background-repeat: no-repeat; background-position: center 23px;
    cursor: pointer; color: #d9b453; animation: captionIn .24s ease-out; }
  .pochi-caption::before { content: attr(data-owner); position: absolute; top: 4px; left: 12px;
    font-size: 10px; letter-spacing: .12em; }
  .pochi-caption::after { content: attr(data-result); position: absolute; bottom: 7px; left: 12px;
    font-size: 11px; letter-spacing: .06em; }
  button:focus-visible { outline: 2px solid #d9b453; outline-offset: 4px; }
  @keyframes tileIn { from { opacity: 0; transform: translate(-100%, -40%); } to { opacity: 1; transform: translate(-100%, -50%); } }
  @keyframes tileReveal { from { transform: translate(-100%, -50%) scale(.92); } to { transform: translate(-100%, -50%) scale(1); } }
  @keyframes captionIn { from { opacity: 0; transform: translate(6px, -50%); } to { opacity: 1; transform: translate(0, -50%); } }
  @media (max-width: 480px) { .overlay { --anchor-x: 17%; --anchor-y: 72%; } .pochi-caption { width: 170px; background-size: 150px auto; } }
  @media (prefers-reduced-motion: reduce) { .pochi-tile, .pochi-tile.revealed, .pochi-caption { animation: none; } }
</style>
