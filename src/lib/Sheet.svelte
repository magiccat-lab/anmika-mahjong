
<script lang="ts">
  // モーダル共通 Sheet shell [docs/sp-ui-redesign.md 手順E/F]。
  // 共通化するのは「見た目の shell」だけ: fixed 配置 / 横中央 / 最大高 + 本文スクロール /
  // safe-area padding / dialog の UA 既定リセット / 任意の暗幕。
  // 業務 props [winner / 候補 / roll / onSelect 等] は各 feature component に残す。
  export let ariaLabel: string;
  /** 明色パネル [和了・選択系] か暗色パネル [進行 modal] か */
  export let tone: 'light' | 'dark' = 'dark';
  /** 内側の詰め方。compact = 小さい確認、standard = 通常、wide = 牌グリッド付き */
  export let size: 'compact' | 'standard' | 'wide' = 'standard';
  /** 暗幕。'hand-peek' は下側を薄くして卓の手牌を透かす [2026-07-20 リョー要望] */
  export let backdrop: 'none' | 'hand-peek' = 'none';
  /** 上端位置。呼び出し側の従来値をそのまま渡す */
  export let top: string = '12px';
  /** 枠線 [色まで含めた指定]。feature ごとのアクセント */
  export let border: string = '2px solid #c0a040';
  /** 重なり順。従来の modal ごとの z-index を維持する */
  export let z: number = 1000;
</script>

{#if backdrop === 'hand-peek'}
  <div class="sheet-backdrop hand-peek" role="presentation" style="z-index: {z - 1}"></div>
{/if}
<dialog
  open
  class="sheet tone-{tone} size-{size}"
  aria-label={ariaLabel}
  style="--sheet-top: {top}; --sheet-border: {border}; z-index: {z}"
>
  <slot />
</dialog>

<style>
  .sheet-backdrop {
    position: fixed;
    inset: 0;
  }
  .sheet-backdrop.hand-peek {
    background: linear-gradient(
      to bottom,
      rgba(5, 17, 12, 0.72) 0%,
      rgba(5, 17, 12, 0.72) 58%,
      rgba(5, 17, 12, 0.20) 76%,
      rgba(5, 17, 12, 0.06) 100%
    );
  }
  /* dialog の UA 既定 [inset-inline:0 / margin:auto / border:solid / padding:1em /
     background:canvas] を全部潰してから shell を組み直す */
  .sheet {
    position: fixed;
    top: var(--sheet-top, 12px);
    left: 50%;
    right: auto;
    bottom: auto;
    transform: translateX(-50%);
    margin: 0;
    display: block;
    box-sizing: border-box;
    border: var(--sheet-border, 2px solid #c0a040);
    font-family: var(--sans);
    /* safe-area 込みで画面外へ出さない */
    max-width: min(94dvw, calc(100dvw - env(safe-area-inset-left) - env(safe-area-inset-right) - 12px));
    overflow: auto;
    overscroll-behavior: contain;
  }
  .sheet.tone-dark {
    background: #222;
    color: #fff;
    max-height: 86dvh;
  }
  .sheet.tone-light {
    background: #f8f4e7;
    color: #173126;
    text-align: center;
    max-height: min(62vh, 560px);
  }
  /* KinpeiModal 従来値 */
  .sheet.size-compact {
    padding: 12px 16px;
    border-radius: 8px;
  }
  /* FuyuModal 従来値 [2026-07-22 SP対応の流体寸法] */
  .sheet.size-standard {
    padding: clamp(12px, 4dvh, 22px) clamp(16px, 5dvw, 28px);
    border-radius: 10px;
    min-width: min(460px, 88dvw);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  }
  /* ぽっち選択 2 種 従来値 */
  .sheet.size-wide {
    width: min(720px, calc(100vw - 32px));
    padding: 18px;
    border-radius: 14px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.45);
  }
</style>
