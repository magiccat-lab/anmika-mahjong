
<script lang="ts">
  // サイコロチャンス [出目当て] modal [MVP、 2026-05-12]
  // 仕様: 出目宣言 [順序なし 15 通り] → サイコロ 2 個振り 4 回 [ゾロ目はリプレイ] → 結果確認 → 次へ
  export let winnerName: string | null = null;
  export let winner: number;
  export let canOperate: boolean = true;  // false なら read-only [オンラインで上がり者以外、 2026-05-13]
  export let chances: Array<{ name: string; baseChip: number; shuvariApplicable: boolean; alwaysShuvari?: boolean; rollCount?: number; count: number; plusMinus: '+' | '-' }>;
  /** chip 倍率 [pochi / shuvari / fever 合成]、 表示に反映 */
  export let chipMultiplier: number = 1;
  /** この chance の持ち主が シュバリー宣言中か [2026-07-20 リョー要望: シュバ状態を画面で確認したい] */
  export let ownerShuvariActive: boolean = false;
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
  // 表示は「演出が着地した分」だけ [spin 中に結果 text が先バレしない]
  $: shownRolls = rolls.slice(0, revealedRollsCount);
  $: nonZoroCount = shownRolls.filter((r) => !r.zoro).length;
  $: hits = shownRolls.filter((r) => r.hit).length;
  $: rollsLeft = Math.max(0, (chance?.rollCount ?? 4) - nonZoroCount);

  // 順序なし 15 通り [(1,2), (1,3), ... (5,6)] 生成
  const allCombos: Array<[number, number]> = [];
  for (let a = 1; a <= 6; a++) for (let b = a + 1; b <= 6; b++) allCombos.push([a, b]);

  // サイコロ アニメ + SE [2026-07-15 リョー指示: dice-box(WebGL物理) を内製 CSS cube に置換]
  // [2026-07-22 Sol調査B fix] 演出と確定値の同期を作り直し:
  // - 振る操作は即 server/store へ送り、演出は rolls 配列の増分だけから駆動する
  //   [旧: 旧 display 値で 750ms 回してから送信 → 着地と確定結果がズレる]
  // - roll 1 件 = spin 1 回。連続着信は queue で直列再生 [上書きしない]
  // - chance が進んだら [currentIdx 変化] 計数と queue をリセット
  //   [旧: prevRollsCount 持ち越しで次 chance の演出が丸ごと死ぬ]
  // - mount 時の既存履歴は演出なしで即表示 [途中参加で過去 roll を再生しない]
  let rolling = false;
  let displayD1 = 1;
  let displayD2 = 1;
  let drumAudio: HTMLAudioElement | null = null;
  let rollTimer: ReturnType<typeof setTimeout> | null = null;
  let landingQueue: Array<{ d1: number; d2: number; fanfare: boolean; upto: number }> = [];
  let revealedRollsCount = 0;
  let prevRollsCount = 0;
  let awaitingRollAck = false;
  let trackedIdx: number | null = null;
  let bootstrapped = false;
  // タンブル時間。止まり際の ease [0.55s] は DiceCube 側
  const SPIN_MS = 750;

  $: settled = !rolling && landingQueue.length === 0;

  function stopDrumAudio() {
    if (!drumAudio) return;
    try { drumAudio.pause(); drumAudio.currentTime = 0; } catch (e) {}
    drumAudio = null;
  }

  onDestroy(() => {
    if (rollTimer !== null) clearTimeout(rollTimer);
    rollTimer = null;
    rolling = false;
    landingQueue = [];
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

  function startNextSpin() {
    const item = landingQueue.shift();
    landingQueue = landingQueue;
    if (!item) return;
    rolling = true;
    // DiceCube は rolling → false の瞬間に value へ settle するため、着地値を先に固定する
    displayD1 = item.d1;
    displayD2 = item.d2;
    drumAudio = playSE('/sounds/drum_roll.mp3', 0.55);
    rollTimer = setTimeout(() => {
      rollTimer = null;
      rolling = false;
      stopDrumAudio();
      revealedRollsCount = Math.max(revealedRollsCount, item.upto);
      if (item.fanfare) playSE('/sounds/se_a.mp3', 0.6);
      if (landingQueue.length > 0) startNextSpin();
    }, SPIN_MS);
  }

  function handleRoll() {
    if (rolling || awaitingRollAck || landingQueue.length > 0) return;
    // 即送信。演出は rolls 増分検出側 [下の $:] が確定値で発火する
    awaitingRollAck = true;
    onRoll();
  }

  $: {
    if (!bootstrapped || trackedIdx !== currentIdx) {
      // 初回 mount / chance 切替: 既存履歴は演出なしで表示状態に同期
      bootstrapped = true;
      trackedIdx = currentIdx;
      if (rollTimer !== null) { clearTimeout(rollTimer); rollTimer = null; }
      rolling = false;
      stopDrumAudio();
      landingQueue = [];
      awaitingRollAck = false;
      prevRollsCount = rolls.length;
      revealedRollsCount = rolls.length;
      const last = rolls[rolls.length - 1];
      if (last) { displayD1 = last.dice[0]; displayD2 = last.dice[1]; }
    } else if (rolls.length > prevRollsCount) {
      // winner / 非 winner 共通: rolls の増分 1 件につき spin 1 回を queue
      for (let i = prevRollsCount; i < rolls.length; i++) {
        const r = rolls[i];
        const prev = i >= 1 ? rolls[i - 1] : null;
        landingQueue.push({ d1: r.dice[0], d2: r.dice[1], fanfare: r.hit || (!!r.zoro && !!prev?.zoro), upto: i + 1 });
      }
      landingQueue = landingQueue;
      prevRollsCount = rolls.length;
      awaitingRollAck = false;
    }
    if (!rolling && landingQueue.length > 0) startNextSpin();
  }
</script>

{#if chance}
  <div class="modal sai">
    <div class="title">🎲 サイコロチャンス [{winnerName ?? `player ${winner}`}] - {chance.name}</div>
    <div class="info">
      {currentIdx + 1} / {chances.length} 件目 | base {chance.baseChip} × {chance.count} 回 × 倍率 {chipMultiplier} = {chance.baseChip * chance.count * chipMultiplier} オール / hit
    </div>
    <!-- 2026-07-20 リョー要望: このサイコロがシュバかどうかを常に明示する。
         祝儀計算自体は仕様どおりシュバ ×2 非適用、ゾロ目連続特典はシュバ不問の固定額 -->
    <div class="shuvari-row">
      このサイコロ:
      {#if chance.alwaysShuvari}
        <strong class="shuvari-yes">常時シュバサイ</strong>
      {:else if chance.shuvariApplicable && ownerShuvariActive}
        <strong class="shuvari-yes">シュバサイ</strong> <span class="shuvari-note">[シュバ宣言中]</span>
      {:else if chance.shuvariApplicable}
        <strong class="shuvari-no">非シュバサイ</strong> <span class="shuvari-note">[シュバ未宣言]</span>
      {:else}
        <strong class="non-shuvari">シュバ非適用</strong>
      {/if}
      <div class="shuvari-note">サイコロ祝儀にシュバ ×2 は乗らない / ゾロ目連続特典はシュバサイのみ・固定額</div>
    </div>

    {#if !selectedCombo}
      <div class="step">出目宣言: 順序なし 15 通りから 1 つ選択 [ゾロ目は無効]</div>
      <div class="combos">
        {#each allCombos as [a, b]}
          <button class="combo" on:click={() => onSelectCombo(a, b)} disabled={!canOperate}>{a},{b}</button>
        {/each}
      </div>
      {#if !canOperate}<div class="step" style="color:#888">上がり者の出目宣言待ち…</div>{/if}
    {:else}
      <div class="step">宣言出目: <strong>{selectedCombo[0]}, {selectedCombo[1]}</strong></div>
      <div class="rolls">
        {#each shownRolls as r, i}
          <span class="roll {r.zoro ? 'zoro' : r.hit ? 'hit' : 'miss'}">
            #{i + 1}: ({r.dice[0]}, {r.dice[1]})
            {#if r.zoro} ゾロ目 ↻{:else if r.hit} ◎ hit{:else} ✗{/if}
          </span>
        {/each}
      </div>
      {#if !finalized || !settled}
        <div class="dice-stage" aria-label="サイコロ">
          <DiceCube value={displayD1} rolling={rolling} size={64} />
          <DiceCube value={displayD2} rolling={rolling} size={64} />
        </div>
        <!-- 直近 roll 結果 [text] -->
        {#if shownRolls.length > 0}
          <div class="roll-result">直近: ({shownRolls[shownRolls.length - 1].dice[0]}, {shownRolls[shownRolls.length - 1].dice[1]})</div>
        {/if}
        <div class="info">残り {rollsLeft} 振り | 現 {hits} hit</div>
        <div class="actions">
          <button class="roll-btn" on:click={handleRoll} disabled={rolling || awaitingRollAck || landingQueue.length > 0 || !canOperate}>{(rolling || awaitingRollAck || landingQueue.length > 0) ? '🎲 振っています…' : (canOperate ? '🎲 サイコロを振る' : '🎲 上がり者の振り待ち…')}</button>
        </div>
      {:else}
        <div class="result">
          <div class="result-row">確定: <strong>{summary?.hits ?? hits} hit</strong> / base {chance.baseChip} × {chance.count} 回</div>
          <div class="result-row">加算チップ: <strong>{summary?.chipN ?? 0} オール</strong></div>
          {#if (summary?.zoroBonusTotal ?? 0) !== 0}
            <div class="result-row">ゾロ目連続特典: <strong>{(summary?.zoroBonusTotal ?? 0) > 0 ? '+' : ''}{summary?.zoroBonusTotal ?? 0} オール{(summary?.zoroBonusTotal ?? 0) < 0 ? ' [払い]' : ''}</strong></div>
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
    /* 2026-07-22 SP対応: 低背では上に寄せて max-height + scroll で必ず収める */
    top: min(20%, 24px);
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a1a;
    color: #fff;
    padding: clamp(10px, 3dvh, 14px) clamp(12px, 4dvw, 18px);
    z-index: 1010;
    border-radius: 8px;
    font-family: 'Noto Sans JP', sans-serif;
    min-width: min(380px, 88dvw);
    max-width: 94dvw;
    max-height: 88dvh;
    overflow-y: auto;
    box-sizing: border-box;
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
  /* 2026-07-22 リョー指摘: 背景箱が見づらい。箱をやめて文字自体を読めるサイズ・明度に */
  .shuvari-row {
    font-size: 13px;
    margin: 0 0 8px;
  }
  .shuvari-yes { color: #d9b8f8; font-size: 14px; }
  .shuvari-no { color: #c0c0c0; font-size: 14px; }
  .shuvari-note { font-size: 12px; color: #d6d0e4; }
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
