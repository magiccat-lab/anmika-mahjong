<script lang="ts">
  // [2026-10-09 遊真 C1/A2] 相手席の「切断中」「CPU 代打ち」と、host だけが押せる
  // 「CPU に替える / 戻す」。盤面の左右席の名前の下に置く [幅が狭いので小さく折り返す]
  import { isMemberCpuProxy, isMemberDisconnected, type OnlineMemberLike } from './onlineSeats';

  export let member: OnlineMemberLike | undefined = undefined;
  /** host で、この席が自分以外の人間の時だけ true */
  export let canToggle = false;
  export let onSetCpuProxy: (roomSeat: number, on: boolean) => void = () => {};

  $: disconnected = isMemberDisconnected(member);
  $: proxied = isMemberCpuProxy(member);
</script>

{#if member && (disconnected || proxied || canToggle)}
  <div class="oss">
    {#if disconnected}<span class="oss-badge oss-off">切断中</span>{/if}
    {#if proxied}<span class="oss-badge oss-proxy">CPU 代打ち</span>{/if}
    {#if canToggle}
      <button type="button" class="oss-toggle" on:click={() => member && onSetCpuProxy(member.seat, !proxied)}>
        {proxied ? '戻す' : 'CPU に替える'}
      </button>
    {/if}
  </div>
{/if}

<style>
  .oss {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    margin-top: 2px;
    max-width: 100%;
  }
  .oss-badge {
    display: inline-block;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 700;
    line-height: 1.2;
    text-align: center;
    color: #fff;
  }
  .oss-off { background: #8a8f98; }
  .oss-proxy { background: #3f7fd0; }
  .oss-toggle {
    max-width: 100%;
    padding: 2px 4px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.12);
    color: #f4f4f4;
    font-size: 9px;
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
  }
  .oss-toggle:hover { background: rgba(255, 255, 255, 0.22); }
</style>
