
<script lang="ts">
  // 白ぽっち [z5] ツモ時 カットイン modal [ダンガンロンパ風]
  // リョー指示 2026-05-13:
  //   - 白待ちロンはそのまま [zimo 時のみ発動]
  //   - 青/緑 = ファンファーレ [正]、 赤/黄 = 残念 SE [逆]
  //   - AI/CPU 番でも同じ演出 [800ms 後 自動開封]
  //   - カットイン背景 ダンガンロンパ風 + cutin SE 同時再生 + デカく出す
  import { onMount, onDestroy } from 'svelte';
  import Tile from './Tile.svelte';
  export let player: number;
  export let color: 'blue' | 'red' | 'green' | 'yellow';
  export let isCpu: boolean = false;
  export let onClose: () => void = () => {};

  let revealed = false;
  let closing = false;

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

  function playSE(src: string, volume = 0.6): void {
    try {
      const a = new Audio(src);
      a.volume = volume;
      a.play().catch(() => {});
    } catch (e) {}
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
  <!-- 2026-07-22 リョー指示: 斜め slit + 放射効果線 [線の演出] はダサいので撤去。
       暗転 + 中央 panel + めくりだけ残す -->
  <!-- 中央 main panel -->
  <div class="cutin-panel" style="--accent: {currentAccent}">
    <!-- 2026-07-21: 誰の引き牌か表示 [リョーが P1 の演出を自分のツモと誤認した] -->
    <div class="seat-label">player {player} の引き牌</div>
    <div class="big-label">白ぽっち</div>
    <div class="tile-bay">
      <div class="tile-mega" class:revealed>
        {#if revealed}
          <Tile pai={colorPaiKey(color)} size="lg" />
        {:else}
          <div class="unknown-card">
            <span class="qmark">?</span>
          </div>
        {/if}
      </div>
    </div>
    <div class="big-call">{revealed ? `${colorLabel(color)} ぽっち！` : 'ツモ！'}</div>
    {#if !revealed}
      <div class="hint">{isCpu ? 'めくり中…' : '▼ クリックでめくる ▼'}</div>
    {:else}
      <div class="result {isPositive(color) ? 'pos' : 'neg'}">
        {isPositive(color) ? '🎉 当たり 🎉' : '😢 残念 😢'}
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 9999;
    overflow: hidden;
    cursor: pointer;
    animation: fadein 0.18s ease-out;
    outline: none;
  }
  @keyframes fadein { from { opacity: 0; } to { opacity: 1; } }

  /* 2026-07-22 リョー報告 [SPでぽっちツモ演出だけデカい]: 固定寸法をやめ
     dvh/dvw clamp の流体スケールに。PC [高さ700px級] では従来サイズに収束する */
  .cutin-panel {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-3deg);
    background: linear-gradient(135deg, #1a1820 30%, #2a2235 70%);
    border: 3px solid var(--accent, #ff4488);
    border-radius: 14px;
    padding: clamp(12px, 4.5dvh, 32px) clamp(18px, 7dvw, 56px);
    text-align: center;
    box-shadow: 0 0 80px var(--accent, #ff4488), 0 0 200px rgba(0, 0, 0, 0.8);
    animation: cutin-slam 0.45s cubic-bezier(0.18, 0.9, 0.32, 1.35);
    min-width: min(360px, 78dvw);
    max-height: 92dvh;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(6px, 2.8dvh, 20px);
  }
  @keyframes cutin-slam {
    0%   { transform: translate(-150%, -50%) rotate(-15deg) scale(2); opacity: 0; }
    60%  { transform: translate(-50%, -50%) rotate(2deg) scale(1.15); opacity: 1; }
    100% { transform: translate(-50%, -50%) rotate(-3deg) scale(1); opacity: 1; }
  }
  .seat-label {
    font-size: clamp(11px, 3.5dvh, 15px);
    font-weight: 700;
    color: #d8d4c8;
    letter-spacing: 2px;
    margin-bottom: 2px;
  }
  .big-label {
    font-size: clamp(20px, 8dvh, 36px);
    font-weight: 900;
    color: var(--accent, #fff);
    letter-spacing: clamp(2px, 1dvh, 6px);
    text-shadow: 0 0 16px var(--accent, #ff4488), 4px 4px 0 #000;
    line-height: 1;
    margin-bottom: 4px;
  }
  .tile-bay {
    display: flex;
    align-items: center;
    justify-content: center;
    width: min(200px, 36dvh);
    height: min(200px, 36dvh);
    background: radial-gradient(circle at center, color-mix(in srgb, var(--accent) 35%, transparent) 0%, transparent 65%);
    border-radius: 18px;
  }
  /* 牌サイズは bay に比例 [bay 200px 時に従来の scale(2.4)=96x132 と一致]。
     scale(calc(長さ/長さ)) はブラウザ互換が薄いので、手順B の Tile props API で
     実寸を渡し、開示時の 2.4→3.0 相当 [x1.25] だけ transform で演出する */
  .tile-mega {
    display: inline-block;
    transform-origin: center;
    filter: drop-shadow(0 6px 24px rgba(0, 0, 0, 0.8));
    transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.4, 1.3);
    --tile-lg-w: calc(min(200px, 36dvh) * 0.48);
    --tile-lg-h: calc(min(200px, 36dvh) * 0.66);
  }
  .tile-mega.revealed {
    transform: scale(1.25) rotate(8deg);
  }
  .tile-mega :global(.tile.size-lg) {
    width: var(--tile-lg-w);
    height: var(--tile-lg-h);
  }
  .unknown-card {
    width: calc(min(200px, 36dvh) * 0.48);
    height: calc(min(200px, 36dvh) * 0.66);
    background: linear-gradient(135deg, #f8f5e8, #d8d0b8);
    border: 2px solid #888;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: inset 0 0 8px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.4);
  }
  .qmark {
    font-size: calc(min(200px, 36dvh) * 0.32);
    font-weight: 900;
    color: #555;
    line-height: 1;
    font-family: 'Arial Black', 'Helvetica', 'Impact', sans-serif;
    text-shadow: 1px 1px 2px rgba(0,0,0,0.2);
    animation: qmark-pulse 1s ease-in-out infinite;
  }
  @keyframes qmark-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.1); }
  }
  .big-call {
    font-size: clamp(22px, 9dvh, 42px);
    font-weight: 900;
    color: #fff;
    letter-spacing: clamp(2px, 0.8dvh, 4px);
    text-shadow: 0 0 12px var(--accent, #ff4488), 3px 3px 0 #000;
    margin-top: 4px;
  }
  .hint {
    margin-top: clamp(6px, 2dvh, 16px);
    font-size: clamp(13px, 3.8dvh, 18px);
    font-weight: 700;
    color: #ffeec0;
    letter-spacing: 6px;
    font-family: 'Yuji Mai', 'Noto Serif JP', 'Hiragino Mincho ProN', '游明朝', serif;
    text-shadow: 0 0 10px var(--accent, #d4af37), 2px 2px 0 #000;
    animation: hint-blink 1.2s ease-in-out infinite;
  }
  @keyframes hint-blink {
    0%, 100% { opacity: 1; transform: translateY(0); }
    50% { opacity: 0.6; transform: translateY(2px); }
  }
  .result {
    margin-top: clamp(4px, 1.8dvh, 14px);
    font-size: clamp(14px, 4.5dvh, 22px);
    font-weight: 900;
    letter-spacing: clamp(2px, 0.8dvh, 4px);
  }
  .result.pos { color: #44ff77; text-shadow: 0 0 10px #44ff77; }
  .result.neg { color: #ff6677; text-shadow: 0 0 10px #ff6677; }
</style>
