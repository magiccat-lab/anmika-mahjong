<script lang="ts">
  // 画面設定 [端末ごと]。localStorage に持つだけで対局の中身には触らない。
  // [2026-09-14 リョー「UI とか他のいろんな改善も検討してよ」→「全部やっといて」]
  import { prefs, type Prefs } from './prefs';

  export let onClose: () => void = () => {};

  const items: Array<{ key: keyof Prefs; label: string; note: string }> = [
    { key: 'muted', label: '🔇 ミュート', note: 'サイコロとぽっち開封の効果音を鳴らさない' },
    { key: 'showWall', label: '🗻 山を見る', note: '対局中も山構成と王牌を開けるようにする' },
    { key: 'colorAssist', label: '🎨 色彩調整', note: 'ぽっちの色と赤金に記号を重ねる [色覚多様性向け]' },
    { key: 'autoNuki', label: '⚡ 自動抜き', note: '自分の手番で抜ける華牌・北があれば自動で抜く' },
  ];
</script>

<div class="overlay" role="dialog" aria-label="画面設定">
  <div class="panel">
    <div class="head">
      <h2>⚙️ 画面設定</h2>
      <button class="close" on:click={onClose}>閉じる</button>
    </div>
    <p class="lead">この端末だけの設定です。ルールと点数には影響しません。</p>
    <ul>
      {#each items as it}
        <li>
          <label>
            <input
              type="checkbox"
              checked={$prefs[it.key]}
              on:change={() => prefs.toggle(it.key)}
            />
            <span class="label">{it.label}</span>
          </label>
          <span class="note">{it.note}</span>
        </li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
    padding: 16px;
    box-sizing: border-box;
  }
  .panel {
    width: min(520px, 100%);
    max-height: 85vh;
    overflow: auto;
    background: #1c2a22;
    color: #e8f0ea;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 12px;
    padding: 16px 18px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  h2 { margin: 0; font-size: 1.1rem; }
  .close {
    background: #345; color: #fff; border: 0; border-radius: 6px;
    padding: 6px 12px; cursor: pointer;
  }
  .lead { margin: 8px 0 12px; font-size: 12px; color: #9fb3a6; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  li { display: flex; flex-direction: column; gap: 2px; }
  label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .label { font-size: 15px; font-weight: 600; }
  .note { font-size: 12px; color: #9fb3a6; padding-left: 26px; }
</style>
