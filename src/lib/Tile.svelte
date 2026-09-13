
<script lang="ts">
  // 牌 1 枚の表示。 FluffyStuff [MIT] + アンミカ独自 SVG を image で読み込む
  // 元 文字 fallback は最後の砦として残す
  export let pai: string = '';
  export let face: 'up' | 'down' = 'up';
  /** 表示サイズ: 'sm'=22x30 [header / inline]、 'md'=32x44 [手牌]、 'lg'=40x55 [debug 等] */
  export let size: 'sm' | 'md' | 'lg' = 'md';

  import { prefs } from './prefs';

  // pai 表記 → public/tiles/ 内の SVG ファイル名
  function paiSvg(p: string): string | null {
    if (!p) return null;
    const s = p[0];
    const n = p[1];
    if (s === 'm') {
      if (n === '0') return 'Man5-Dora.svg';
      return `Man${n}.svg`;
    }
    if (s === 'p') {
      if (n === '0') return 'Pin5-Dora.svg';
      return `Pin${n}.svg`;
    }
    if (s === 's') {
      if (n === '0') return 'Sou5-Dora.svg';
      return `Sou${n}.svg`;
    }
    if (s === 'z') {
      // z5 4 色ぽっち [リョー指示 2026-05-10]: z5b=青 / z5r=赤 / z5g=緑 / z5y=黄
      if (p === 'z5b') return 'Haku-Blue.svg';
      if (p === 'z5r') return 'Haku-Red.svg';
      if (p === 'z5g') return 'Haku-green.svg';
      if (p === 'z5y') return 'Haku-yellow.svg';
      const map: Record<string, string> = {
        '1': 'Ton.svg',     // 東
        '2': 'Nan.svg',     // 南
        '3': 'Shaa.svg',    // 西
        '4': 'Pei.svg',     // 北
        '5': 'Haku.svg',    // 白 [素のz5、 通常 z5* で来るはず]
        '6': 'Hatsu.svg',   // 發
        '7': 'Chun.svg',    // 中
      };
      return map[n] ?? null;
    }
    // アンミカ拡張表記 [Phase 2 想定]
    // f1-4 = 春夏秋冬、 g{p|s} = 金 5p/5s、 gN = 金北、 b{r|g|y|u} = ぽっち
    if (s === 'f') {
      const flowers = ['', 'spring.svg', 'summer.svg', 'autumn.svg', 'winter.svg'];
      return flowers[parseInt(n)] ?? null;
    }
    if (p === 'gp') return 'Pin5-Gold.svg';
    if (p === 'gs') return 'Sou5-Gold.svg';
    if (p === 'gN') return 'Pei-Gold.svg';
    if (p === 'br') return 'Haku-Red.svg';
    if (p === 'bg') return 'Haku-green.svg';
    if (p === 'by') return 'Haku-yellow.svg';
    if (p === 'bu') return 'Haku-Blue.svg';
    if (p === 'np3') return 'Pin3-Rainbow.svg';
    if (p === 'ns3') return 'Sou3-Rainbow.svg';
    if (p === 'nz3') return 'Shaa-Rainbow.svg';
    return null;
  }

  // text fallback
  function paiLabel(p: string): string {
    if (!p) return '';
    if (p === 'gp') return '金5p';
    if (p === 'gs') return '金5s';
    if (p === 'gN') return '金北';
    if (p === 'z5b') return '白[青]';
    if (p === 'z5r') return '白[赤]';
    if (p === 'z5g') return '白[緑]';
    if (p === 'z5y') return '白[黄]';
    if (p === 'np3') return '虹3p';
    if (p === 'ns3') return '虹3s';
    if (p === 'nz3') return '虹西';
    const s = p[0];
    const n = p[1];
    if (s === 'm') return n === '0' ? '赤5m' : `${n}m`;
    if (s === 'p') return n === '0' ? '赤5p' : `${n}p`;
    if (s === 's') return n === '0' ? '赤5s' : `${n}s`;
    if (s === 'z') {
      const z = ['東','南','西','北','白','發','中'][parseInt(n) - 1];
      return z ?? '?';
    }
    if (s === 'f') {
      return ['', '春', '夏', '秋', '冬'][parseInt(n)] ?? '?';
    }
    return p;
  }

  $: svg = paiSvg(pai);
  $: isRed = pai && pai[1] === '0';
  $: isRainbow = pai === 'np3' || pai === 'ns3' || pai === 'nz3';

  // [2026-09-14] 色彩調整。ぽっち 4 色・赤ドラ・金は色だけで区別されているので、
  // 設定が入っている時は右上に記号を重ねる [色が見分けにくい人向け]。
  const MARKS: Record<string, string> = {
    z5b: '青', z5r: '赤', z5g: '緑', z5y: '黄',
    bu: '青', br: '赤', bg: '緑', by: '黄',
    gp: '金', gs: '金', gN: '金',
    np3: '虹', ns3: '虹', nz3: '虹',
  };
  $: assistMark = $prefs.colorAssist
    ? (MARKS[pai] ?? (isRed ? '赤' : ''))
    : '';
</script>

<span class="tile {face} size-{size}" class:red={isRed} class:rainbow={isRainbow}>
  {#if face === 'down'}
    <img class="tile-img" src="/tiles/Back.svg" alt="伏せ" />
  {:else if svg}
    <img class="tile-img" src={`/tiles/${svg}`} alt={paiLabel(pai)} title={paiLabel(pai)} />
  {:else}
    <span class="tile-text">{paiLabel(pai)}</span>
  {/if}
  {#if face === 'up' && assistMark}
    <span class="assist-mark" aria-hidden="true">{assistMark}</span>
  {/if}
</span>

<style>
  .tile {
    position: relative;
    display: inline-block;
    margin: 1px;
    border: 1px solid #888;
    border-radius: 4px;
    background: #f8f5e8;
    text-align: center;
    overflow: hidden;
    vertical-align: middle;
  }
  /* [2026-09-14] 色彩調整の記号。牌の絵を隠さないよう右上に小さく重ねる */
  .assist-mark {
    position: absolute;
    top: 0;
    right: 0;
    min-width: 9px;
    padding: 0 1px;
    font-size: 8px;
    line-height: 1.1;
    font-weight: 700;
    color: #111;
    background: rgba(255, 255, 255, 0.88);
    border-bottom-left-radius: 3px;
    pointer-events: none;
  }
  .tile.size-lg .assist-mark { font-size: 10px; min-width: 11px; }

  /* SP再設計 手順B [docs/sp-ui-redesign.md]: サイズを CSS custom props の正式APIに。
     fallback は従来の固定値なので、変数未設定の既存画面は見た目不変。
     v2 レイアウトが文脈ごとに --tile-*-w/h を設定してスケールさせる */
  .tile.size-sm { width: var(--tile-sm-w, 22px); height: var(--tile-sm-h, 30px); }
  .tile.size-md { width: var(--tile-md-w, 32px); height: var(--tile-md-h, 44px); }
  .tile.size-lg { width: var(--tile-lg-w, 40px); height: var(--tile-lg-h, 55px); }
  .tile.down {
    background: #506070;
    border-color: #303a44;
  }
  .tile.red {
    background: #fff0e8;
    border-color: #c04040;
  }
  .tile.rainbow {
    background: linear-gradient(135deg, #ffe8e8, #fff8e0, #e8ffe8, #e8f0ff, #f0e8ff);
    border-image: linear-gradient(135deg, #ff3333, #ffaa00, #33cc33, #3399ff, #cc33ff) 1;
    border-width: 2px;
    border-style: solid;
  }
  .tile-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .tile-text {
    display: inline-block;
    line-height: 44px;
    font-size: 12px;
    font-family: 'Noto Sans JP', sans-serif;
    color: #222;
  }
</style>
