
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
  /** [2026-07-23 総点検 P1] reject/sync 受信時に親が進める復旧カウンタ。
   *  変化したら awaitingRollAck を解除する [送信が握り潰された/弾かれた時の片道切符対策] */
  export let recoveryNonce = 0;
  /** [2026-10-09 shun] リョー「CPUのサイコロは即結果が出るようにスキップできるボタンもつけて」。
   *  instant の間は振る演出を回さず、着いた目をそのまま出す */
  export let instant = false;
  /** CPU のサイコロの時だけ「スキップ」を出す */
  export let showSkip = false;
  export let onSkip: () => void = () => {};

  import { onDestroy } from 'svelte';
  import DiceCube from './DiceCube.svelte';
  import { playSound } from './prefs';
  import { planRoll, ZORO_WORD, type BallColor, type RollPlan } from './diceFx';

  $: chance = chances[currentIdx];
  // 表示は「演出が着地した分」だけ [spin 中に結果 text が先バレしない]
  $: shownRolls = rolls.slice(0, revealedRollsCount);
  $: nonZoroCount = shownRolls.filter((r) => !r.zoro).length;
  $: hits = shownRolls.filter((r) => r.hit).length;
  $: rollCount = chance?.rollCount ?? 4;
  $: rollsLeft = Math.max(0, rollCount - nonZoroCount);
  $: perHitChip = chance ? chance.baseChip * chance.count * chipMultiplier : 0;
  $: who = winnerName ?? `player ${winner}`;

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
  // [2026-10-14 リョー、演出のラフ 2 ・ 3 版] 1 振り = 玉の色 → 2 個を回す → 宣言の目が先に出たらリーチ
  // (もう 1 個をゆっくり) → 大当り ・ ゾロ目 / リプレイ ・ 外れ。色と順は出目から決めるので全員の画面で同じ。
  // 1 振りは長くて 2 秒 (CPU は 2.5 秒ごとに振る)。大当りの帯は次の振りを止めない
  let rolling = false;
  let rollingA = false;
  let rollingB = false;
  let slowDie: 0 | 1 | null = null;
  let reachDie: 0 | 1 | null = null;
  let hitDice = false;
  let displayD1 = 1;
  let displayD2 = 1;
  let landingQueue: Array<{ d1: number; d2: number; fanfare: boolean; upto: number; plan: RollPlan }> = [];
  let revealedRollsCount = 0;
  let prevRollsCount = 0;
  let awaitingRollAck = false;
  let trackedIdx: number | null = null;
  let bootstrapped = false;
  // 演出の層 (画面全体)
  let ballNow: BallColor | 'gone' | null = null;
  let ballPop = false;
  let band: { word: string; light: boolean; top: string; key: number } | null = null;
  let stamp: string | null = null;
  let rays = false;
  let dim = 0;
  let flashKey = 0;
  let shakeKey = 0;
  let confettiKey = 0;
  let chipsText: string | null = null;
  let seq = 0;          // 演出の世代。chance 切替 ・ destroy で上げて走っている演出を止める
  let fxGen = 0;        // 大当りなどの後片付けが次の振りの演出を消さないための世代
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let modalEl: HTMLDivElement | null = null;
  $: if (shakeKey && modalEl && typeof modalEl.animate === 'function') {
    // transform は単独の卓で App 側が上書きするので、揺れは translate で足す
    modalEl.animate([
      { translate: '0 0' }, { translate: '-12px 7px' }, { translate: '10px -8px' },
      { translate: '-7px -4px' }, { translate: '5px 4px' }, { translate: '0 0' },
    ], { duration: 450 });
  }
  // 紙吹雪 (位置は決め打ち。乱数にしないので画面ごとに揺れない)
  const CONFETTI_COLORS = ['#ff3b3b', '#ffd23b', '#3bff8a', '#3bb8ff', '#c63bff', '#fff'];
  const CONFETTI = Array.from({ length: 60 }, (_, i) => ({
    left: `${(i * 37) % 100}%`, color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    dur: `${1.3 + ((i * 7) % 10) / 8}s`, delay: `${((i * 13) % 10) / 25}s`,
  }));

  $: settled = !rolling && landingQueue.length === 0;

  let _lastRecoveryNonce = 0;
  $: if (recoveryNonce !== _lastRecoveryNonce) {
    _lastRecoveryNonce = recoveryNonce;
    awaitingRollAck = false;
  }

  function later(fn: () => void, ms: number) {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  }
  function sleep(ms: number): Promise<void> {
    return new Promise((r) => later(r, ms));
  }
  function clearFx() {
    band = null; stamp = null; rays = false; dim = 0; chipsText = null; ballPop = false;
  }
  function stopAll() {
    seq++;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    rolling = false; rollingA = false; rollingB = false; slowDie = null; reachDie = null; hitDice = false;
    ballNow = null;
    clearFx();
  }

  onDestroy(() => {
    stopAll();
    landingQueue = [];
  });

  // [2026-09-14] ミュート設定を見る。prefs.muted なら鳴らさない。
  function playSE(src: string, volume = 0.6): HTMLAudioElement | null {
    return playSound(src, volume);
  }
  function se(name: string, volume = 0.6) { playSE(`/sounds/fx/${name}.mp3`, volume); }

  async function playRoll(item: { d1: number; d2: number; fanfare: boolean; upto: number; plan: RollPlan }) {
    const my = ++seq;
    const live = () => my === seq;
    const p = item.plan;
    // 後ろに積まれていたら詰める [CPU の刻みや再接続でまとめて届いた時]
    const quick = landingQueue.length > 0;
    rolling = true;
    fxGen++;
    clearFx();
    hitDice = false; reachDie = null;
    // DiceCube は rolling → false の瞬間に value へ settle するため、着地値を先に固定する
    displayD1 = item.d1;
    displayD2 = item.d2;
    // 1. 玉が色を変える (期待度)
    ballNow = p.ball;
    if (p.ball === 'blue') se('pikiin', 0.5);
    else if (p.ball !== 'white') { se('pikiin', 0.6); se('kira', 0.6); }
    await sleep(quick ? 120 : 320);
    if (!live()) return;
    ballNow = 'gone';
    // 2. 2 個を回す。宣言の目の方を先に止める
    rollingA = true; rollingB = true;
    se('roll', 0.5);
    await sleep(quick ? 260 : 460);
    if (!live()) return;
    if (p.first === 0) rollingA = false; else rollingB = false;
    if (p.reach) {
      reachDie = p.first;
      slowDie = p.first === 0 ? 1 : 0;
      dim = 0.45;
      band = { word: 'リーチ', light: true, top: '13%', key: Date.now() };
      se('don', 0.5); se('gyuiin', 0.6);
      const beats = quick ? 1 : 3;
      for (let i = 0; i < beats; i++) { await sleep(400); if (!live()) return; se('heart', 0.7); }
      await sleep(quick ? 120 : 240);
      if (!live()) return;
      band = null;
    } else {
      se('don', 0.35);
      await sleep(quick ? 100 : 200);
      if (!live()) return;
    }
    rollingA = false; rollingB = false; slowDie = null;
    revealedRollsCount = Math.max(revealedRollsCount, item.upto);
    // 3. 結果
    const gen = fxGen;
    if (p.outcome === 'hit') {
      reachDie = null; hitDice = true;
      flashKey++; shakeKey++; rays = true; dim = 0.3; confettiKey++;
      band = { word: '大当り', light: false, top: '14%', key: Date.now() };
      se('gashan', 0.7); se('kyuin', 0.6); se('don', 0.7);
      later(() => { if (gen === fxGen) playSE('/sounds/se_a.mp3', 0.6); }, 260);
      const target = perHitChip;
      for (let k = 0; k <= 10; k++) later(() => { if (gen === fxGen) chipsText = `+${Math.round(target * k / 10)} オール`; }, 300 + k * 35);
      later(() => { if (gen === fxGen) { clearFx(); hitDice = false; } }, quick ? 900 : 1700);
    } else if (p.outcome === 'zoro') {
      reachDie = null; dim = 0;
      stamp = ZORO_WORD;
      se('pikiin', 0.6);
      if (item.fanfare) playSE('/sounds/se_a.mp3', 0.6);
      later(() => { if (gen === fxGen) { ballPop = true; ballNow = null; } }, 380);
      later(() => { if (gen === fxGen) clearFx(); }, quick ? 600 : 1000);
    } else {
      if (p.reach) se('hazure', 0.5);
      later(() => { if (gen === fxGen) { reachDie = null; dim = 0; } }, p.reach ? 500 : 0);
    }
    if (p.outcome !== 'zoro') ballNow = null;
    rolling = false;
    if (landingQueue.length > 0) startNextSpin();
  }

  function startNextSpin() {
    const item = landingQueue.shift();
    landingQueue = landingQueue;
    if (!item) return;
    void playRoll(item);
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
      stopAll();
      landingQueue = [];
      awaitingRollAck = false;
      prevRollsCount = rolls.length;
      revealedRollsCount = rolls.length;
      const last = rolls[rolls.length - 1];
      if (last) { displayD1 = last.dice[0]; displayD2 = last.dice[1]; }
    } else if (rolls.length < prevRollsCount) {
      // [2026-07-23 総点検 P2] currentIdx 不変のまま rolls が縮んだ場合 [rewind 等] の防御。
      // 計数を再同期しないと以後の増分が旧値を超えるまで演出も ack 解除も死ぬ
      prevRollsCount = rolls.length;
      revealedRollsCount = Math.min(revealedRollsCount, rolls.length);
      landingQueue = [];
      awaitingRollAck = false;
    } else if (rolls.length > prevRollsCount && instant) {
      // スキップ中: 演出なしで着いた目を出す [残っている演出も捨てる]
      stopAll();
      landingQueue = [];
      prevRollsCount = rolls.length;
      revealedRollsCount = rolls.length;
      const last = rolls[rolls.length - 1];
      if (last) { displayD1 = last.dice[0]; displayD2 = last.dice[1]; }
      awaitingRollAck = false;
    } else if (rolls.length > prevRollsCount) {
      // winner / 非 winner 共通: rolls の増分 1 件につき spin 1 回を queue
      for (let i = prevRollsCount; i < rolls.length; i++) {
        const r = rolls[i];
        const prev = i >= 1 ? rolls[i - 1] : null;
        const plan = planRoll(selectedCombo, r, [winner, currentIdx, i, r.dice[0], r.dice[1], selectedCombo?.[0] ?? 0, selectedCombo?.[1] ?? 0]);
        landingQueue.push({ d1: r.dice[0], d2: r.dice[1], fanfare: r.hit || (!!r.zoro && !!prev?.zoro), upto: i + 1, plan });
      }
      landingQueue = landingQueue;
      prevRollsCount = rolls.length;
      awaitingRollAck = false;
    }
    if (!rolling && landingQueue.length > 0) startNextSpin();
  }
</script>

{#if chance}
  <!-- 演出の層 (画面全体)。.modal は transform を持つので、その外に置く -->
  <div class="sd-layer" aria-hidden="true">
    <div class="sd-dim" style:opacity={dim}></div>
    <div class="sd-rays" class:on={rays}></div>
  </div>
  <div class="sd-layer front" aria-hidden="true">
    {#key flashKey}{#if flashKey}<div class="sd-flash"></div>{/if}{/key}
    {#if band}{#key band.key}
      <div class="sd-dr" class:light={band.light} style:--top={band.top}>
        <div class="sd-band"><span class="sd-word">{band.word}</span><span class="sd-who">{who}</span></div>
      </div>
    {/key}{/if}
    {#if stamp}<div class="sd-stamp">{stamp}</div>{/if}
    {#if chipsText}<div class="sd-chips">{chipsText}</div>{/if}
    {#key confettiKey}{#if confettiKey && hitDice}
      {#each CONFETTI as c}<i class="sd-confetti" style:left={c.left} style:background={c.color} style:animation-duration={c.dur} style:animation-delay={c.delay}></i>{/each}
    {/if}{/key}
  </div>
  <div class="modal sai" bind:this={modalEl}>
    <div class="title-row">
      <div class="title">サイコロチャンス [{who}] - {chance.name}</div>
      {#if showSkip && !instant}
        <button class="skip-btn" on:click={onSkip} title="CPU のサイコロの演出を飛ばして結果を出す">スキップ</button>
      {/if}
    </div>
    <div class="info">
      {currentIdx + 1} / {chances.length} 件目 | base {chance.baseChip} × {chance.count} 回 × 倍率 {chipMultiplier} = {perHitChip} オール / hit
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
      <div class="step decl">宣言 <DiceCube value={selectedCombo[0]} size={24} /><DiceCube value={selectedCombo[1]} size={24} /><span class="decl-text">{selectedCombo[0]}, {selectedCombo[1]}</span></div>
      {#if shownRolls.length > 0}
        <div class="rolls">
          {#each shownRolls as r, i}
            <span class="roll {r.zoro ? 'zoro' : r.hit ? 'hit' : 'miss'}">
              #{i + 1}: ({r.dice[0]}, {r.dice[1]})
              {#if r.zoro} {ZORO_WORD}{:else if r.hit} ◎ hit{:else} ✗{/if}
            </span>
          {/each}
        </div>
      {/if}
      {#if !finalized || !settled}
        <div class="dice-stage" aria-label="サイコロ">
          <div class="die-wrap" class:reach={reachDie === 0} class:hit={hitDice}><DiceCube value={displayD1} rolling={rollingA} slow={slowDie === 0} size={76} /></div>
          <div class="die-wrap" class:reach={reachDie === 1} class:hit={hitDice}><DiceCube value={displayD2} rolling={rollingB} slow={slowDie === 1} size={76} /></div>
        </div>
        <div class="balls" aria-label={`残り ${rollsLeft} 振り`}>
          <span class="cap">残り</span>
          {#each Array(rollCount) as _, i}
            <span class="ball {i < nonZoroCount ? 'gone' : (i === nonZoroCount && ballNow) ? ballNow : ''}" class:pop={i === nonZoroCount && ballPop}></span>
          {/each}
          <span class="hits">当たり {hits}</span>
        </div>
        <!-- 直近 roll 結果 [text] -->
        {#if shownRolls.length > 0}
          <div class="roll-result">直近: ({shownRolls[shownRolls.length - 1].dice[0]}, {shownRolls[shownRolls.length - 1].dice[1]})</div>
        {/if}
        <div class="actions">
          <button class="roll-btn" on:click={handleRoll} disabled={rolling || awaitingRollAck || landingQueue.length > 0 || !canOperate}>{(rolling || awaitingRollAck || landingQueue.length > 0) ? '振っています…' : (canOperate ? 'サイコロを振る' : '上がり者の振り待ち…')}</button>
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
    font-family: var(--sans);
    min-width: min(380px, 88dvw);
    max-width: 94dvw;
    max-height: 88dvh;
    overflow-y: auto;
    box-sizing: border-box;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  }
  .modal.sai { border: 2px solid #d4af37; }
  .title { font-weight: bold; margin-bottom: 6px; font-size: 14px; }
  .title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .skip-btn {
    flex: none;
    min-height: 36px;
    padding: 0 14px;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    border-radius: 4px;
    border: 1px solid currentColor;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
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
    flex-wrap: wrap;
    gap: 2px 12px;
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

  /* [2026-10-14] サイコロの演出 (演出のラフ 2 ・ 3 版)。帯はアプリのツモ ・ ロン (App.svelte の .dr-band) と同じ見た目 */
  .decl { display: flex; align-items: center; gap: 8px; color: #ffe27a; font-weight: 700; }
  .decl-text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .dice-stage { height: 120px; gap: 44px; }
  .die-wrap { border-radius: 14px; transition: filter 0.2s; }
  .die-wrap.reach { filter: drop-shadow(0 0 6px #ff4a4a) drop-shadow(0 0 18px rgba(255, 60, 60, 0.9)); }
  .die-wrap.hit { filter: drop-shadow(0 0 6px #f2d27a) drop-shadow(0 0 22px rgba(255, 210, 90, 0.95)); }
  .balls { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 2px 0 6px; }
  .balls .cap { color: #ffe27a; font-weight: 700; font-size: 14px; }
  .balls .hits { margin-left: 6px; font-size: 12px; opacity: 0.85; }
  .ball { width: 24px; height: 24px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff, #cfd6dd 60%, #8b96a0); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6); transition: transform 0.25s, opacity 0.25s; }
  .ball.blue { background: radial-gradient(circle at 35% 30%, #cfe6ff, #3a78ff 60%, #10307a); box-shadow: 0 0 12px 4px rgba(80, 140, 255, 0.8); }
  .ball.gold { background: radial-gradient(circle at 35% 30%, #fff6c8, #f2c23a 55%, #8a5a10); box-shadow: 0 0 16px 6px rgba(255, 200, 70, 0.9); }
  .ball.rainbow { background: conic-gradient(#ff3b3b, #ffd23b, #3bff8a, #3bb8ff, #c63bff, #ff3b3b); box-shadow: 0 0 18px 7px rgba(255, 255, 255, 0.8); animation: sdHue 0.6s linear infinite; }
  .ball.gone { transform: scale(0) translateY(-16px); opacity: 0; }
  .ball.pop { animation: sdPop 0.4s cubic-bezier(0.2, 1.8, 0.4, 1); }
  /* 暗幕と光は箱 (単独の卓は z 1001、オンラインは 1010) の下に、帯と字は上に出す */
  .sd-layer { position: fixed; inset: 0; pointer-events: none; z-index: 1000; overflow: hidden; }
  .sd-layer.front { z-index: 1020; }
  .sd-dim { position: absolute; inset: 0; background: #000; opacity: 0; transition: opacity 0.25s; }
  .sd-rays { position: absolute; left: 50%; top: 50%; width: 220vmax; height: 220vmax; margin: -110vmax 0 0 -110vmax; border-radius: 50%; opacity: 0; transition: opacity 0.2s;
    background: repeating-conic-gradient(#ff3b3b 0 6deg, transparent 6deg 12deg, #ffd23b 12deg 18deg, transparent 18deg 24deg, #3bff8a 24deg 30deg, transparent 30deg 36deg, #3bb8ff 36deg 42deg, transparent 42deg 48deg, #c63bff 48deg 54deg, transparent 54deg 60deg);
    -webkit-mask: radial-gradient(circle, #000 6%, transparent 50%); mask: radial-gradient(circle, #000 6%, transparent 50%); animation: sdSpin 5s linear infinite; }
  .sd-rays.on { opacity: 0.85; }
  .sd-flash { position: absolute; inset: 0; background: #fff; opacity: 0; z-index: 30; animation: sdFlash 0.35s ease-out; }
  /* 帯と字は .modal (z 1010) より上に出す */
  .sd-dr { --pink: #f2d27a; --pink2: #b8862b; --sh: #6b4a12; --h: clamp(80px, 22vh, 170px); --fs: calc(min(12vw, 130px, var(--h) * 0.62));
    position: fixed; inset: 0; z-index: 1020; overflow: hidden; pointer-events: none; }
  .sd-dr.light { --h: clamp(60px, 15vh, 120px); --fs: calc(min(9vw, 88px, var(--h) * 0.62)); }
  .sd-band { position: absolute; left: -10%; right: -10%; top: var(--top, 50%); height: var(--h); margin-top: calc(var(--h) / -2); display: flex; align-items: center; justify-content: center;
    background: repeating-linear-gradient(115deg, transparent 0 28px, rgba(0, 0, 0, 0.16) 28px 34px), linear-gradient(180deg, #111 0 7%, var(--pink) 7% 50%, var(--pink2) 50% 93%, #111 93% 100%);
    box-shadow: 0 0 0 4px #fff inset, 0 10px 30px rgba(0, 0, 0, 0.5); transform: rotate(-7deg); animation: sdBandIn 0.28s cubic-bezier(0.2, 0.9, 0.2, 1) both; }
  .sd-word { font-family: 'FX Kana', 'Zen Kaku Gothic New', sans-serif; font-size: var(--fs); line-height: 1; letter-spacing: 0.04em; white-space: nowrap; color: #fff;
    -webkit-text-stroke: calc(var(--fs) * 0.07) #111; paint-order: stroke fill; text-shadow: calc(var(--fs) * 0.06) calc(var(--fs) * 0.06) 0 var(--sh); transform: skewX(-12deg);
    animation: sdWord 0.4s cubic-bezier(0.2, 1.4, 0.3, 1) both; }
  .sd-who { position: absolute; right: 14%; bottom: 10%; padding: 3px 14px; background: #111; color: #fff; font: 700 clamp(12px, 2vw, 20px) 'Zen Kaku Gothic New', sans-serif; letter-spacing: 0.08em; transform: skewX(-12deg); }
  .sd-stamp { position: fixed; left: 50%; top: 62%; z-index: 1020; transform: translate(-50%, -50%); white-space: nowrap; font-family: 'FX Kana', 'Zen Kaku Gothic New', sans-serif;
    font-size: clamp(34px, 8vw, 96px); line-height: 1; color: #ffe27a; -webkit-text-stroke: 5px #3a2405; paint-order: stroke fill; text-shadow: 0 6px 0 #8a5a10, 0 0 30px rgba(255, 200, 80, 0.9);
    animation: sdSlam 0.38s cubic-bezier(0.2, 1.7, 0.4, 1) both; }
  .sd-chips { position: fixed; left: 50%; top: 80%; z-index: 1021; transform: translateX(-50%); white-space: nowrap; font-family: 'FX Kana', 'Zen Kaku Gothic New', sans-serif;
    font-size: clamp(30px, 7vw, 70px); color: #ffe27a; -webkit-text-stroke: 5px #3a2405; paint-order: stroke fill; }
  .sd-confetti { position: fixed; top: -30px; width: 12px; height: 20px; z-index: 1019; animation: sdFall linear forwards; }
  @keyframes sdBandIn { from { transform: rotate(-7deg) translateX(-120%); } to { transform: rotate(-7deg) translateX(0); } }
  @keyframes sdWord { 0% { opacity: 0; transform: skewX(-12deg) scale(2.4); } 60% { opacity: 1; transform: skewX(-12deg) scale(0.94); } 100% { opacity: 1; transform: skewX(-12deg) scale(1); } }
  @keyframes sdSlam { 0% { transform: translate(-50%, -50%) scale(3); opacity: 0; } 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
  @keyframes sdFlash { 0% { opacity: 0.9; } 100% { opacity: 0; } }
  @keyframes sdFall { to { transform: translateY(110vh) rotate(900deg); } }
  @keyframes sdSpin { to { transform: rotate(360deg); } }
  @keyframes sdHue { to { filter: hue-rotate(360deg); } }
  @keyframes sdPop { 0% { transform: scale(0); } 100% { transform: scale(1); } }
  @media (prefers-reduced-motion: reduce) {
    .sd-band, .sd-word, .sd-stamp, .sd-rays, .ball.rainbow, .ball.pop { animation: none; }
    .sd-confetti { display: none; }
  }
</style>
