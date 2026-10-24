<script lang="ts">
  // [2026-10-22 リョー「金北選択時に盤面に戻って情報見れるように」]
  // 金北の選択の板を一時的にたたんだ間、画面の下に残す 1 本の帯。押すと選択に戻る。
  // 選択そのもの [pendingKinpei] ・ 制限時間は触らない。見た目を隠すだけ。
  export let onBack: () => void;
  // [2026-10-24 先輩「冬冬金北とか選ぶか考える時に山の残り枚数とか川とか見れるように」] 冬を使うかの板でも使う
  export let note = '金北の選択待ち [盤面を見ています]';
</script>

<div class="kinpei-peek-bar" role="status">
  <span class="kinpei-peek-note">{note}</span>
  <button type="button" class="kinpei-peek-back" on:click={onBack}>選択に戻る</button>
</div>

<style>
  .kinpei-peek-bar {
    position: fixed;
    left: 50%;
    bottom: calc(16vh + 8px);
    transform: translateX(-50%);
    z-index: 1001;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: calc(100vw - 16px);
    box-sizing: border-box;
    padding: 8px 12px;
    border: 2px solid #c0a040;
    border-radius: 10px;
    background: #fff4d9;
    color: #4a3b10 !important; /* main.mode-single * { color: inherit } に負けない */
    font-size: 13px;
    font-weight: 700;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }
  /* 盤面側の span 既定色 [明るい灰] が乗るので、帯の字の色はここで決める */
  .kinpei-peek-note { color: #4a3b10 !important; white-space: nowrap; }
  /* スマホ幅: ツモ切り ・ 自動和了の段の上に出し、手牌は隠さない */
  @media (max-width: 600px) {
    .kinpei-peek-bar { bottom: 270px; font-size: 12px; padding: 6px 10px; }
  }
  .kinpei-peek-back {
    flex: none;
    padding: 8px 14px;
    min-height: 40px;
    border: 0;
    border-radius: 6px;
    background: #c0a040;
    color: #fff !important;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
</style>
