
<script lang="ts">
  // 1 player の 手牌 + 副露 + 抜き華 + 抜きドラ + 河
  import Tile from './Tile.svelte';
  import type { FulouMianzi } from './fulouDisplay';
  import { lizhiPaiLabel } from './lizhiUi';
  export let player: number;
  export let label: string;
  export let isCurrent: boolean;
  export let shoupai: string[];
  export let fulou: FulouMianzi[];
  export let huapai: string[];
  export let nukidora: number;
  export let nukidoraGold: number = 0;
  export let goldHandZ: number;
  $: void goldHandZ; // 内部未使用 [将来 金北 表示用に予約、 svelte warn 抑止]
  export let he: string[];
  export let revealHand: boolean;
  export let lastZimoIdx: number;
  export let isLizhiCand: (t: string) => boolean = () => false;
  export let isNakiCand: (t: string) => boolean = () => false;
  export let isDoraPai: (t: string) => boolean = () => false;
  export let lizhiPending: boolean = false;
  export let lizhiKindLabel: string = 'リーチ';
  export let onTileClick: (p: number, t: string) => void = () => {};
  export let disabled: boolean = false;
  export let shuvariActive: boolean = false;
</script>

<section class="player" class:active={isCurrent}>
  <h2>
    {label} {isCurrent ? '←' : ''}
    {#if shuvariActive}<span class="shuvari-badge">シュバ</span>{/if}
  </h2>
  <div class="hand">
    {#each shoupai as t, i}
      {@const isPendingCandidate = isCurrent && lizhiPending && isLizhiCand(t)}
      <button
        class="tile-btn"
        class:tsumo-tile={i === lastZimoIdx && isCurrent}
        class:lizhi-cand={isPendingCandidate}
        class:naki-cand={isNakiCand(t)}
        class:dora-glow={isDoraPai(t)}
        data-naki-candidate={isNakiCand(t) ? 'true' : undefined}
        class:lizhi-dim={isCurrent && lizhiPending && !isLizhiCand(t)}
        aria-label={isPendingCandidate ? `${lizhiKindLabel}の宣言牌として${lizhiPaiLabel(t)}を切る` : undefined}
        title={isPendingCandidate ? `${lizhiKindLabel}: ${lizhiPaiLabel(t)}を切る` : undefined}
        data-lizhi-candidate={isPendingCandidate ? 'true' : undefined}
        on:click={() => onTileClick(player, t)}
        disabled={disabled || !isCurrent}
      >
        <Tile pai={t} face={revealHand ? 'up' : 'down'} />
        {#if isPendingCandidate}<span class="cut-marker" aria-hidden="true">切る</span>{/if}
      </button>
    {/each}
    {#each fulou as m}
      <span class="fulou-group">
        {#each m.tiles as t, i}
          {#if i === m.rotateIdx}
            <span class="rot-tile" data-testid="naki-rot-tile"><Tile pai={t} /></span>
            {#if m.kakanTile}
              <span class="rot-tile kakan-stack" data-testid="kakan-tile"><Tile pai={m.kakanTile} /></span>
            {/if}
          {:else}
            <Tile pai={t} />
          {/if}
        {/each}
      </span>
    {/each}
    {#if huapai.length > 0 || nukidora > 0 || nukidoraGold > 0}
      <span class="hua-group">
        {#each huapai as t}<Tile pai={t} />{/each}
        {#each Array(nukidora) as _, i}<Tile pai="z4" />{/each}
        {#each Array(nukidoraGold) as _, i}<Tile pai="gN" />{/each}
      </span>
    {/if}
  </div>
  <div class="he">
    <span class="label">河:</span>
    {#each he as t}
      {@const isLizhi = t.endsWith('_')}
      {@const woLizhi = t.replace(/_$/, '')}
      {@const isTsumogiri = woLizhi.endsWith('#t')}
      {@const woTsumogiri = woLizhi.replace(/#t$/, '')}
      {@const isNaki = woTsumogiri.endsWith('#n')}
      {@const tilePai = woTsumogiri.replace(/#n$/, '')}
      <span class="he-tile" class:lizhi-tile={isLizhi} class:tsumogiri-tile={isTsumogiri} class:naki-tile={isNaki}>
        <Tile pai={tilePai} />
      </span>
    {/each}
  </div>
</section>

<style>
  section.player {
    border: 1px solid #ddd;
    border-radius: 6px;
    padding: 8px;
    margin: 6px 0;
    background: #fafafa;
  }
  section.player.active {
    background: #fff8e1;
    border-color: #c8a020;
  }
  section.player h2 {
    margin: 0 0 4px;
    font-size: 13px;
    color: #555;
  }
  .hand, .he {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px;
  }
  .he {
    margin-top: 4px;
    min-height: 36px;
  }
  .he .label { font-size: 11px; color: #888; margin-right: 4px; }
  .he-tile { display: inline-block; vertical-align: middle; }
  .he-tile.lizhi-tile {
    transform: rotate(90deg);
    transform-origin: center;
    margin: 0 6px;
  }
  /* ツモ切り表示: 軽い透過 + dashed border で 手出しと識別 [2026-05-15] */
  .he-tile.tsumogiri-tile {
    opacity: 0.65;
    outline: 1px dashed #888;
    outline-offset: -1px;
    border-radius: 2px;
  }
  /* 鳴かれた牌 [F1 2026-05-15]: 河から消さず 薄く gray out で残す */
  .he-tile.naki-tile {
    opacity: 0.4;
    filter: grayscale(0.6);
  }
  .tile-btn {
    position: relative;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  /* SP再設計 手順B [docs/sp-ui-redesign.md]: タップ領域を表示サイズから分離。
     --tap-min 未設定 [=0px] では従来と完全同一。v2 が --tap-min: 44px を設定すると
     牌の見た目を変えずにヒット領域だけ広がる。隣接重複の管理は v2 側の責務 */
  .tile-btn::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    /* 縦横を分離: 縦は指の逃げを大きく取れるが、横は隣牌との hitbox 重複を
       避けるため gap 分しか広げられない [Sol レビュー] */
    width: max(100%, var(--tap-min-w, var(--tap-min, 0px)));
    height: max(100%, var(--tap-min-h, var(--tap-min, 0px)));
    transform: translate(-50%, -50%);
  }
  .tile-btn:disabled { cursor: default; opacity: 0.6; }
  .tile-btn.tsumo-tile { box-shadow: 0 0 0 2px #f0c040 inset; border-radius: 4px; margin-left: 16px; }
  /* [2026-07-22 リョー要望] 表ドラ現物の常時ハイライト [水色。鳴き金リングより弱め、下に置いて負ける] */
  .tile-btn.dora-glow {
    box-shadow: 0 0 0 2px #27c4e8, 0 0 8px rgba(39, 196, 232, 0.75);
    border-radius: 4px;
  }
  /* [2026-07-22 リョー要望] 鳴き判断対象の手牌側ハイライト [リーチ宣言牌と同系の金リング] */
  .tile-btn.naki-cand {
    box-shadow: 0 0 0 3px #ffb000, 0 0 10px rgba(255, 176, 0, 0.8);
    border-radius: 4px;
  }
  .tile-btn.lizhi-cand {
    box-shadow: 0 0 0 3px #ffb000, 0 0 12px rgba(255, 176, 0, 0.9);
    border-radius: 4px;
  }
  .tile-btn.lizhi-dim { opacity: 0.35; filter: grayscale(0.5); pointer-events: none; }
  .cut-marker {
    position: absolute;
    right: -3px;
    bottom: -5px;
    z-index: 2;
    padding: 1px 3px;
    border: 1px solid #fff;
    border-radius: 3px;
    background: #d62020;
    color: #fff;
    font-size: 9px;
    font-weight: 800;
    line-height: 1.1;
    pointer-events: none;
  }
  .fulou-group { display: inline-flex; gap: 1px; padding: 0 3px; border-left: 1px dashed #ccc; margin-left: 16px; align-items: flex-end; }
  /* F2 [2026-05-15]: 鳴き先方向で 横倒し 表示 */
  .fulou-group .rot-tile { display: inline-block; transform: rotate(90deg); transform-origin: center; margin: 0 6px; }
  /* 加槓 4 枚目は 横倒し tile に重ねて 上に積む */
  .fulou-group .rot-tile.kakan-stack { margin-left: -22px; margin-top: -16px; }
  .hua-group { display: inline-flex; gap: 1px; padding: 0 3px; border-left: 1px solid #c8a020; margin-left: 16px; }
  .shuvari-badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    background: #ff8c1e;
    border-radius: 3px;
    vertical-align: middle;
  }
</style>
