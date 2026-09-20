
<script lang="ts">
  // 白ぽっち [z5] ツモ時 カットイン modal [ダンガンロンパ風]
  // リョー指示 2026-05-13:
  //   - 白待ちロンはそのまま [zimo 時のみ発動]
  //   - 青/緑 = ファンファーレ [正]、 赤/黄 = 残念 SE [逆]
  //   - AI/CPU 番でも同じ演出 [800ms 後 自動開封]
  //   - カットイン背景 ダンガンロンパ風 + cutin SE 同時再生 + デカく出す
  import { onMount, onDestroy } from 'svelte';
  import Tile from './Tile.svelte';
  import { playSound } from './prefs';
  export let player: number;
  export let color: 'blue' | 'red' | 'green' | 'yellow';
  export let isCpu: boolean = false;
  export let onClose: () => void = () => {};

  let revealed = false;
  let closing = false;

  // [2026-07-21] 誰の引き牌か。リョーが P1 の演出を自分のツモと誤認した
  $: seatLabel = `player ${player}`;

  function colorPaiKey(c: string): string {
    return { blue: 'z5b', red: 'z5r', green: 'z5g', yellow: 'z5y' }[c] ?? 'z5';
  }
  function colorLabel(c: string): string {
    return { blue: '青', red: '赤', green: '緑', yellow: '黄' }[c] ?? c;
  }
  function isPositive(c: string): boolean {
    return c === 'blue' || c === 'green';
  }
  function colorHex(c: string): string {
    return { blue: '#3a78ff', red: '#ff4444', green: '#33dd88', yellow: '#ffd633' }[c] ?? '#fff';
  }
  // 開封前は 白 [リョー指示: 「?」 デカ表示で 未確定感]、 開封後 実色 accent
  const NEUTRAL_ACCENT = '#ffffff';
  $: currentAccent = revealed ? colorHex(color) : NEUTRAL_ACCENT;

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

<div class="overlay" on:click={reveal} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') reveal(); }} role="dialog" tabindex="-1">
  <!-- 2026-09-20 リョー指摘「ポッチツモ演出ダセー」で作り直し。
       演出ゼロベース再検討の原則に合わせた [重 の枠だが、派手さは全部落とす]:
       ・斜めスラム・ネオン光彩・絵文字・点滅をやめ、transform と opacity だけにする
       ・主役は牌。文字は牌の説明に落とす [事実が先、演出は後]
       ・色は金 1 つ。開いた後のぽっちの色だけ情報として出す -->
  <div class="pochi-panel" class:revealed>
    <div class="who">{seatLabel} の引き</div>
    <div class="tile-bay">
      <div class="tile-mega" class:revealed>
        {#if revealed}
          <Tile pai={colorPaiKey(color)} size="lg" />
        {:else}
          <div class="unknown-card"><span class="qmark">?</span></div>
        {/if}
      </div>
    </div>
    {#if revealed}
      <div class="call" style="--pochi: {colorHex(color)}">{colorLabel(color)}ぽっち</div>
      <div class="verdict" class:neg={!isPositive(color)}>{isPositive(color) ? '正' : '逆'}</div>
    {:else}
      <div class="call">白ぽっち</div>
      <div class="hint">{isCpu ? 'めくり中' : 'タップでめくる'}</div>
    {/if}
  </div>
</div>

<style>
  /* 2026-09-20 作り直し。ダンガンロンパ風 [斜めスラム + ネオン + 絵文字] をやめ、
     卓と同じ静かな面に揃える。動かすのは transform と opacity だけ */
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.62);
    z-index: 9999;
    overflow: hidden;
    cursor: pointer;
    animation: fadein 0.16s ease-out;
    outline: none;
  }
  @keyframes fadein { from { opacity: 0; } to { opacity: 1; } }

  .pochi-panel {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(10, 13, 18, 0.94);
    border: 1px solid #d9b453;
    border-radius: 6px;
    padding: clamp(14px, 4dvh, 26px) clamp(20px, 7dvw, 48px);
    text-align: center;
    min-width: min(300px, 74dvw);
    max-height: 92dvh;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(6px, 2.2dvh, 16px);
    animation: panelIn 0.24s cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes panelIn {
    0% { opacity: 0; transform: translate(-50%, -46%); }
    100% { opacity: 1; transform: translate(-50%, -50%); }
  }

  .who {
    font-size: clamp(11px, 3dvh, 14px);
    color: #9aa2ad;
    letter-spacing: 0.14em;
  }

  .tile-bay {
    display: flex;
    align-items: center;
    justify-content: center;
    width: min(190px, 34dvh);
    height: min(190px, 34dvh);
  }
  .tile-mega {
    display: inline-block;
    transform-origin: center;
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
    --tile-lg-w: calc(min(190px, 34dvh) * 0.48);
    --tile-lg-h: calc(min(190px, 34dvh) * 0.66);
  }
  /* 開いた瞬間だけ少し起き上がる。回転はしない */
  .tile-mega.revealed { transform: scale(1.12); }
  .tile-mega :global(.tile.size-lg) {
    width: var(--tile-lg-w);
    height: var(--tile-lg-h);
  }

  .unknown-card {
    width: calc(min(190px, 34dvh) * 0.48);
    height: calc(min(190px, 34dvh) * 0.66);
    background: linear-gradient(135deg, #f8f5e8, #ded6c0);
    border: 1px solid #9a927f;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .qmark {
    font-size: calc(min(190px, 34dvh) * 0.3);
    font-weight: 800;
    color: #6b6558;
    line-height: 1;
  }

  .call {
    font-size: clamp(18px, 5dvh, 30px);
    font-weight: 700;
    color: #f4f2ec;
    letter-spacing: 0.16em;
    padding-left: 0.16em;
  }
  /* 開いた後だけ、ぽっちの色を文字の下線に出す [情報としての色] */
  .revealed .call {
    border-bottom: 2px solid var(--pochi, #d9b453);
    padding-bottom: 0.14em;
  }

  .verdict {
    font-size: clamp(13px, 3.4dvh, 18px);
    font-weight: 700;
    letter-spacing: 0.3em;
    padding-left: 0.3em;
    color: #d9b453;
  }
  .verdict.neg { color: #9aa2ad; }

  .hint {
    font-size: clamp(12px, 3dvh, 15px);
    color: #9aa2ad;
    letter-spacing: 0.18em;
  }
</style>
