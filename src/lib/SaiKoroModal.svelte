
<script lang="ts">
  // サイコロチャンス [出目当て] modal [MVP、 2026-05-12]
  // 仕様: 出目宣言 [順序なし 15 通り] → サイコロ 2 個振り 4 回 [ゾロ目はリプレイ] → 結果確認 → 次へ
  export let winner: number;
  export let canOperate: boolean = true;  // false なら read-only [オンラインで上がり者以外、 2026-05-13]
  export let chances: Array<{ name: string; baseChip: number; shuvariApplicable: boolean; alwaysShuvari?: boolean; rollCount?: number; count: number; plusMinus: '+' | '-' }>;
  /** chip 倍率 [pochi / shuvari / fever 合成]、 表示に反映 */
  export let chipMultiplier: number = 1;
  export let currentIdx: number;
  export let selectedCombo: [number, number] | null;
  export let rolls: Array<{ dice: [number, number]; hit: boolean; zoro: boolean }>;
  export let finalized: boolean;
  export let summary: { hits: number; chipN: number; zoroBonusTotal: number } | null;
  export let onSelectCombo: (a: number, b: number) => void;
  export let onRoll: (override?: [number, number]) => void;
  export let onAdvance: () => void;

  import { onDestroy } from 'svelte';
  import DiceCube from './DiceCube.svelte';

  $: chance = chances[currentIdx];
  $: nonZoroCount = rolls.filter((r) => !r.zoro).length;
  $: hits = rolls.filter((r) => r.hit).length;
  $: rollsLeft = Math.max(0, (chance?.rollCount ?? 4) - nonZoroCount);

  // 順序なし 15 通り [(1,2), (1,3), ... (5,6)] 生成
  const allCombos: Array<[number, number]> = [];
  for (let a = 1; a <= 6; a++) for (let b = a + 1; b <= 6; b++) allCombos.push([a, b]);

  // サイコロ アニメ + SE [2026-07-15 リョー指示: dice-box(WebGL物理) を内製 CSS cube に置換。
  // 出目は store/server が確定する。演出は表示専用で、init 失敗・watchdog の類は不要になった]
  let rolling = false;
  let displayD1 = 1;
  let displayD2 = 1;
  let drumAudio: HTMLAudioElement | null = null;
  let prevRollsCount = 0;
  let rollTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingResultCallback: (() => void) | null = null;
  // タンブル時間。止まり際の ease [0.55s] は DiceCube 側
  const SPIN_MS = 750;

  function stopDrumAudio() {
    if (!drumAudio) return;
    try { drumAudio.pause(); drumAudio.currentTime = 0; } catch (e) {}
    drumAudio = null;
  }

  function completePendingRoll() {
    const callback = pendingResultCallback;
    pendingResultCallback = null;
    rolling = false;
    stopDrumAudio();
    callback?.();
  }

  onDestroy(() => {
    if (rollTimer !== null) clearTimeout(rollTimer);
    rollTimer = null;
    pendingResultCallback = null;
    rolling = false;
    stopDrumAudio();
  });

  function playSE(src: string, volume = 0.6): HTMLAudioElement | null {
    try {
      const a = new Audio(src);
      a.volume = volume;
      a.play().catch(() => {});
      return a;
    } catch (e) { return null; }
  }

  function startSpin(callback: () => void) {
    rolling = true;
    drumAudio = playSE('/sounds/drum_roll.mp3', 0.55);
    pendingResultCallback = callback;
    rollTimer = setTimeout(() => {
      rollTimer = null;
      completePendingRoll();
    }, SPIN_MS);
  }

  function handleRoll() {
    if (rolling) return;
    startSpin(() => onRoll());
  }

  // 新規 roll 検出 → hit / ゾロ目 2 連続目以降 [ゾロ目連続特典] で ファンファーレ
  // 非 canOperate side [オンライン非 winner] では 視覚動画も WS sync で発火 [リョー指示 2026-05-13]
  // 物理 sim の land 値は捨てて text result は WS の `rolls` 配列の値で表示する [diceBox.roll は value 強制注入 path 無し]
  $: {
    if (rolls.length > prevRollsCount) {
      const newest = rolls[rolls.length - 1];
      const prev = rolls.length >= 2 ? rolls[rolls.length - 2] : null;
      if (newest) {
        displayD1 = newest.dice[0];
        displayD2 = newest.dice[1];
        const zoroConsecutive = newest.zoro && prev && prev.zoro;
        if (newest.hit || zoroConsecutive) {
          playSE('/sounds/se_a.mp3', 0.6);
        }
        // 非 winner 側: ws sync で rolls 増えた時、 タンブル演出を発火 [視覚同期。 値は WS 確定済]
        if (!canOperate && !rolling) {
          startSpin(() => {});
        }
      }
      prevRollsCount = rolls.length;
    }
  }
</script>

{#if chance}
  <div class="modal sai">
    <div class="title">🎲 サイコロチャンス [player {winner}] - {chance.name}</div>
    <div class="info">
      {currentIdx + 1} / {chances.length} 件目 | base {chance.baseChip} × {chance.count} 回 × 倍率 {chipMultiplier} = {chance.baseChip * chance.count * chipMultiplier} オール / hit
      {#if chance.alwaysShuvari}<span>[常時シュバサイ]</span>{:else if !chance.shuvariApplicable}<span class="non-shuvari">[シュバ非適用]</span>{/if}
    </div>

    {#if !selectedCombo}
      <div class="step">📌 出目宣言: 順序なし 15 通りから 1 つ選択 [ゾロ目は無効]</div>
      <div class="combos">
        {#each allCombos as [a, b]}
          <button class="combo" on:click={() => onSelectCombo(a, b)} disabled={!canOperate}>{a},{b}</button>
        {/each}
      </div>
      {#if !canOperate}<div class="step" style="color:#888">上がり者の出目宣言待ち…</div>{/if}
    {:else}
      <div class="step">🎯 宣言出目: <strong>{selectedCombo[0]}, {selectedCombo[1]}</strong></div>
      <div class="rolls">
        {#each rolls as r, i}
          <span class="roll {r.zoro ? 'zoro' : r.hit ? 'hit' : 'miss'}">
            #{i + 1}: ({r.dice[0]}, {r.dice[1]})
            {#if r.zoro} ゾロ目 ↻{:else if r.hit} ◎ hit{:else} ✗{/if}
          </span>
        {/each}
      </div>
      {#if !finalized}
        <div class="dice-stage" aria-label="サイコロ">
          <DiceCube value={displayD1} rolling={rolling} size={64} />
          <DiceCube value={displayD2} rolling={rolling} size={64} />
        </div>
        <!-- 直近 roll 結果 [text] -->
        {#if rolls.length > 0}
          <div class="roll-result">直近: ({rolls[rolls.length - 1].dice[0]}, {rolls[rolls.length - 1].dice[1]})</div>
        {/if}
        <div class="info">残り {rollsLeft} 振り | 現 {hits} hit</div>
        <div class="actions">
          <button class="roll-btn" on:click={handleRoll} disabled={rolling || !canOperate}>{rolling ? '🎲 振っています…' : (canOperate ? '🎲 サイコロを振る' : '🎲 上がり者の振り待ち…')}</button>
        </div>
      {:else}
        <div class="result">
          <div class="result-row">✅ 確定: <strong>{summary?.hits ?? hits} hit</strong> / base {chance.baseChip} × {chance.count} 回</div>
          <div class="result-row">📦 加算 chip: <strong>{summary?.chipN ?? 0} オール</strong></div>
          {#if (summary?.zoroBonusTotal ?? 0) !== 0}
            <div class="result-row">🎲 ゾロ目連続特典: <strong>{(summary?.zoroBonusTotal ?? 0) > 0 ? '+' : ''}{summary?.zoroBonusTotal ?? 0} オール{(summary?.zoroBonusTotal ?? 0) < 0 ? ' [払い]' : ''}</strong></div>
          {/if}
          {#if !chance.shuvariApplicable && !chance.alwaysShuvari}
            <div class="result-row note">[シュバ非適用]</div>
          {/if}
        </div>
        <div class="actions">
          <button class="roll-btn" on:click={onAdvance} disabled={!canOperate}>
            {canOperate ? (currentIdx + 1 < chances.length ? '次のサイコロチャンスへ' : '閉じる') : '上がり者の進行待ち…'}
          </button>
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .modal {
    position: fixed;
    top: 20%;
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a1a;
    color: #fff;
    padding: 14px 18px;
    z-index: 1010;
    border-radius: 8px;
    font-family: 'Noto Sans JP', sans-serif;
    min-width: 380px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  }
  .modal.sai { border: 2px solid #d4af37; }
  .title { font-weight: bold; margin-bottom: 6px; font-size: 14px; }
  .dice-stage {
    width: 100%;
    max-width: 480px;
    height: 130px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 26px;
    background: radial-gradient(ellipse at center, rgba(212, 175, 55, 0.20), transparent 70%);
    border: 2px solid rgba(212, 175, 55, 0.3);
    border-radius: 12px;
    margin: 6px auto 4px;
    box-sizing: border-box;
  }
  .roll-result {
    font-size: 12px;
    color: #d4af37;
    text-align: center;
    margin-bottom: 4px;
  }
  .info { font-size: 11px; opacity: 0.85; margin-bottom: 8px; }
  .non-shuvari { color: #f88; }
  .step { font-size: 12px; margin: 8px 0 6px; }
  .combos {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
    margin-bottom: 8px;
  }
  .combo {
    padding: 6px 4px;
    border: 1px solid #555;
    background: #2a2a2a;
    color: #fff;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-family: monospace;
  }
  .combo:hover { background: #3a3a3a; }
  .rolls {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 8px 0;
    font-family: monospace;
    font-size: 12px;
  }
  .roll.hit { color: #5f5; font-weight: bold; }
  .roll.miss { color: #999; }
  .roll.zoro { color: #fc5; }
  .result {
    margin: 10px 0 6px;
    padding: 8px 12px;
    background: #2a2a2a;
    border: 1px solid #d4af37;
    border-radius: 4px;
  }
  .result-row { font-size: 13px; margin: 2px 0; }
  .result-row.note { font-size: 11px; opacity: 0.8; color: #f88; }
  .actions { display: flex; gap: 8px; margin-top: 8px; }
  .actions button {
    padding: 8px 16px;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    color: #fff;
    font-weight: bold;
  }
  .roll-btn { background: #d4af37; color: #000; }
  .roll-btn:hover { background: #f0c850; }
</style>
