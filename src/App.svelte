
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import Tile from './lib/Tile.svelte';
  import TileChecker from './lib/TileChecker.svelte';
  import ChipBreakdown from './lib/ChipBreakdown.svelte';
  import WallPanel from './lib/WallPanel.svelte';
  import DebugLogPanel from './lib/DebugLogPanel.svelte';
  import ZimoHistory from './lib/ZimoHistory.svelte';
  import FuyuModal from './lib/FuyuModal.svelte';
  import KinpeiModal from './lib/KinpeiModal.svelte';
  import SaiKoroModal from './lib/SaiKoroModal.svelte';
  import PochiRevealModal from './lib/PochiRevealModal.svelte';
  import LobbyPanel from './lib/LobbyPanel.svelte';
  import RoomPanel from './lib/RoomPanel.svelte';
  import EntryMenu from './lib/EntryMenu.svelte';
  import OnlineGameView from './lib/OnlineGameView.svelte';
  import PlayerStatus from './lib/PlayerStatus.svelte';
  import PlayerHandPanel from './lib/PlayerHandPanel.svelte';
  import HeaderInfo from './lib/HeaderInfo.svelte';
  import RoundEndPanel from './lib/RoundEndPanel.svelte';
  import GameEndPanel from './lib/GameEndPanel.svelte';
  import PaifuLoadPanel from './lib/PaifuLoadPanel.svelte';
  import FeverWaitsPanel from './lib/FeverWaitsPanel.svelte';
  import StampPallet from './lib/StampPallet.svelte';
  import StampPopup from './lib/StampPopup.svelte';
  import CutinOverlay from './lib/CutinOverlay.svelte';
  import { CUTIN_DURATION_MS, game, type StampId } from './lib/store';
  import type { PlayerId } from './lib/types';
  import { parseFulouList, fulouFlatTiles, applyAnmikaFulouIdentity } from './lib/fulouDisplay';
  import { createAutoTsumokiriScheduler, type AutoTsumokiriToken } from './lib/autoTsumokiriScheduler';
  import { buildCanonicalPaifuSnapshot, isSafePaifuSavePoint } from './lib/store/paifuIo';
  import { serializeCanonical } from './lib/canonicalJson';
  import { toCorePai } from './lib/helpers';

  // スタンプ pallet 開閉 [自家「💬」 button 押下時 true]
  let stampPalletOpen = false;
  function openStampPallet() { stampPalletOpen = true; }
  function closeStampPallet() { stampPalletOpen = false; }
  function onStampSelect(id: StampId) {
    // 自家 seat に local set + online なら ws send [server で from_seat 上書き]
    game.sendStamp(selfPlayer as PlayerId, id);
  }

  let cutinTimer: ReturnType<typeof setTimeout> | null = null;
  $: if (typeof window !== 'undefined' && !$game.cutin && ($game.cutinQueue?.length ?? 0) > 0 && cutinTimer === null) {
    game.playNextCutin();
  }
  $: if (typeof window !== 'undefined' && $game.cutin && cutinTimer === null) {
    const ts = $game.cutin.ts;
    cutinTimer = setTimeout(() => {
      cutinTimer = null;
      game.finishCutin(ts);
    }, CUTIN_DURATION_MS);
  }
  onDestroy(() => {
    if (cutinTimer !== null) clearTimeout(cutinTimer);
  });

  const PLAYERS = [0, 1, 2] as const satisfies readonly PlayerId[];

  // 開発モード: 他家手牌を見えるか
  let revealAll = true;
  // 自家 [プレイヤー視点]
  let selfPlayer = 0;

  $: state = $game.game.state;
  $: canSavePaifu = isSafePaifuSavePoint($game);
  // オンライン時 server seat rotation: display_seat 0/1/2 を 自席中心に rotate
  // rotateOffset を selfPlayer に直結 [リョー報告 2026-05-14: 「次の試合へ」 reset 後
  // selfPlayer と srv0 がズレて 自家手牌が face=down で表示される bug、 srv0=selfPlayer 一致を保証]
  $: rotateOffset = selfPlayer;
  // Svelte は $: ブロック内の 直接参照変数のみ dep tracking する、 関数呼び出し内部の参照は track しない
  // → rotateOffset を直接式に書く [前の srvSeat 関数経由だと反映されない]
  $: srv0 = (((0 + rotateOffset) % 3) + 3) % 3 as 0|1|2;
  $: srv1 = (((1 + rotateOffset) % 3) + 3) % 3 as 0|1|2;
  $: srv2 = (((2 + rotateOffset) % 3) + 3) % 3 as 0|1|2;
  function srvSeat(display: number): 0|1|2 {
    return (((display + rotateOffset) % 3) + 3) % 3 as 0|1|2;
  }

  function latestHuleDefenDelta(): [number, number, number] | null {
    const events = (($game.game.events ?? []) as any[]);
    let lastHule = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]?.type === 'hule') {
        lastHule = i;
        break;
      }
    }
    if (lastHule >= 0 && events[lastHule]?.delta) {
      let first = lastHule;
      while (first > 0 && events[first - 1]?.type === 'hule' && events[first - 1]?.delta) first--;
      const withDelta = events.slice(first, lastHule + 1);
      const merged = [0, 0, 0] as [number, number, number];
      for (const e of withDelta) {
        merged[0] += Number(e.delta[0] ?? 0);
        merged[1] += Number(e.delta[1] ?? 0);
        merged[2] += Number(e.delta[2] ?? 0);
      }
      return merged;
    }
    if (!$game.game.preHuleSnapshot) return null;
    return [0,1,2].map(p => state.defen[p as PlayerId] - (($game.game.preHuleSnapshot as any).defen[p] ?? 0)) as [number, number, number];
  }
  // R6 P2 #13 fix: DEV / Playwright のみ debug log を発火、 production console を汚さない
  $: { if (typeof window !== 'undefined' && onlineGameStarted && ((import.meta as any).env?.DEV || (typeof navigator !== 'undefined' && (navigator as any).webdriver))) console.log('[seat-debug] selfPlayer=', selfPlayer, 'srv0=', srv0, 'srv1=', srv1, 'srv2=', srv2, 'rotateOffset=', rotateOffset, 'revealCheck(srv0)=', selfPlayer === srv0); }
  $: { if (typeof window !== 'undefined' && onlineGameStarted && ((import.meta as any).env?.DEV || (typeof navigator !== 'undefined' && (navigator as any).webdriver))) console.log('[disabled-debug] currentPlayer=', currentPlayer, 'lunban=', state.lunban, 'srv0=', srv0, 'isCurrent(self)=', currentPlayer === srv0, 'needsZimo=', needsZimo, '_zimo(cur)=', $game.game.shoupai.get(currentPlayer)?._zimo, '_zimo(srv0)=', $game.game.shoupai.get(srv0)?._zimo, 'awaitRon=', $game.awaitingRonDecision, 'awaitFulou=', $game.awaitingFulou); }

  // オンライン CPU と期限切れ操作は Node authority が一度だけ発火する。
  // client timer は再接続 replay と競合するため、オンラインでは持たない。
  $: shoupai0 = handTiles($game.game.shoupai.get(srv0), srv0, pochiReveal?.player === srv0);
  $: shoupai1 = handTiles($game.game.shoupai.get(srv1), srv1, pochiReveal?.player === srv1);
  $: shoupai2 = handTiles($game.game.shoupai.get(srv2), srv2, pochiReveal?.player === srv2);
  // 2026-05-14 ゆーま 自走 bug fix: fulou0/1/2 が hardcoded 0/1/2 で、 オンライン
  // selfPlayer != 0 だと shoupai0 [srv0=自家] と player ID がズレて 他人の副露が表示される
  $: fulou0 = fulouMianzi($game.game.shoupai.get(srv0), srv0);
  $: fulou1 = fulouMianzi($game.game.shoupai.get(srv1), srv1);
  $: fulou2 = fulouMianzi($game.game.shoupai.get(srv2), srv2);
  $: he0 = handHe($game.game.he.get(srvSeat(0)), srvSeat(0));
  $: he1 = handHe($game.game.he.get(srvSeat(1)), srvSeat(1));
  $: he2 = handHe($game.game.he.get(srvSeat(2)), srvSeat(2));
  $: paishu = $game.game.shan.paishu;
  $: baopai = $game.game.shan.baopai;
  $: lastZimo = $game.lastZimo;
  $: currentPlayer = $game.game.lunbanToPlayerId(state.lunban);

  // 白ぽっち ツモ演出 [リョー指示 2026-05-13]
  // cpuStepImpl が複数ターンを1 update で回すため shan.lastZimoPochi は上書きされる。
  // events 配列から z5 の色を直接取り、キューで複数回分を順番に表示する
  let pochiReveal: { player: number; color: 'blue' | 'red' | 'green' | 'yellow'; isCpu: boolean } | null = null;
  let pochiRevealQueue: Array<{ player: number; color: 'blue' | 'red' | 'green' | 'yellow'; isCpu: boolean }> = [];
  let lastSeenZimoEventCount = 0;
  let lastSeenGameRef: any = null;
  const POCHI_COLOR_MAP: Record<string, 'blue'|'red'|'green'|'yellow'> = { z5b: 'blue', z5r: 'red', z5g: 'green', z5y: 'yellow' };
  $: {
    if ($game.game !== lastSeenGameRef) {
      lastSeenGameRef = $game.game;
      lastSeenZimoEventCount = 0;
      pochiRevealQueue = [];
    }
    const zimoEvents = $game.game.events.filter((e: any) => e.type === 'zimo') as Array<{ type: 'zimo'; player: 0|1|2; pai: string }>;
    if (zimoEvents.length < lastSeenZimoEventCount) {
      lastSeenZimoEventCount = 0;
      pochiRevealQueue = [];
      pochiReveal = null;
    }
    if (zimoEvents.length > lastSeenZimoEventCount) {
      for (let i = lastSeenZimoEventCount; i < zimoEvents.length; i++) {
        const ev = zimoEvents[i];
        const color = ev?.pai ? POCHI_COLOR_MAP[ev.pai] : undefined;
        if (color && $game.game.lizhi.has(ev.player)) {
          pochiRevealQueue.push({ player: ev.player, color, isCpu: $game.cpu[ev.player] === true });
        }
      }
      lastSeenZimoEventCount = zimoEvents.length;
      if (pochiReveal === null && pochiRevealQueue.length > 0) {
        pochiReveal = pochiRevealQueue.shift()!;
      }
    }
  }
  function closePochiReveal() {
    pochiReveal = null;
    if (pochiRevealQueue.length > 0) {
      pochiReveal = pochiRevealQueue.shift()!;
    }
  }
  // load 直後の中間 state [dapai 後 / 次 zimo 前] では shoupai._zimo===null。
  // この状態で 打牌させると majiang-core 内の Shoupai.dapai が throw する [ダハイ不可]。
  // 対策: 打牌 button disable + 「次へ」 button で zimo() 実行を促す。
  $: needsZimo = !$game.roundEnded
    && !$game.awaitingRonDecision
    && !$game.awaitingFulou
    && !$game.pendingFeverContinue
    && !$game.pendingFuyu
    && !$game.pendingKinpei
    && !$game.pendingKamiPochi
    && !$game.pendingPochiSwap
    && $game.game.shoupai.get(currentPlayer)?._zimo == null;
  $: progressControlsBlocked = $game.roundEnded
    || $game.pendingPingju
    || $game.awaitingRonDecision
    || $game.awaitingFulou
    || $game.pendingQianggang !== null
    || $game.pendingFeverContinue !== null
    || $game.pendingFuyu !== null
    || $game.pendingKinpei !== null
    || $game.pendingKamiPochi !== null
    || $game.pendingPochiSwap !== null
    || $game.pendingSaiKoro !== null
    || $game.lizhiPending !== null;

  // 各 player のシャンテン
  $: xt0 = $game.game.xiangting(srvSeat(0));
  $: xt1 = $game.game.xiangting(srvSeat(1));
  $: xt2 = $game.game.xiangting(srvSeat(2));

  // 現家がツモ和了可能か
  $: canTsumo = $game.game.canTsumo(currentPlayer);
  // 各家のロン可能性 [打牌直後のみ]
  // 2026-05-14 codex review #3 fix: canRon に fromPlayer [lastDapai.player] を渡す。
  // 間八萬の逆ぽ判定 / ロン方向 / ダマ禁止 仮判定 が実打牌者とズレないように
  // R14 P0 #4 fix: ronPassedPlayers / ronDeclaredPlayers を除外、 一度 pass した player の ronCandidates 残存表示 防止
  $: ronCandidates = $game.lastDapai && $game.awaitingRonDecision
    ? ([0, 1, 2] as number[]).filter(p =>
        p !== $game.lastDapai!.player
        && !($game.ronPassedPlayers ?? []).includes(p)
        && !($game.ronDeclaredPlayers ?? []).includes(p)
        && $game.game.canRon(p as any, $game.lastDapai!.pai, $game.lastDapai!.player as any))
    : [];

  type ActionStatus = { text: string; tone: 'action' | 'waiting' | 'complete' };

  function describeActionStatus(
    snapshot: any,
    activePlayer: number,
    myself: number,
    ronPlayers: number[],
    waitingForDraw: boolean,
    tsumoAvailable: boolean,
  ): ActionStatus {
    const sai = snapshot.pendingSaiKoro;
    if (sai) {
      const chance = sai.chances?.[sai.currentIdx];
      const owner = chance?.winner ?? sai.winner;
      return owner === myself
        ? { text: 'サイコロを操作', tone: 'action' }
        : { text: `P${owner} のサイコロ待ち`, tone: 'waiting' };
    }
    if (snapshot.pendingFuyu) {
      return (snapshot.pendingFuyu.decisionOwners ?? [snapshot.pendingFuyu.winner]).includes(myself)
        ? { text: '冬の効果を選択', tone: 'action' }
        : { text: `P${snapshot.pendingFuyu.winner} の冬選択待ち`, tone: 'waiting' };
    }
    if (snapshot.pendingKinpei) {
      return (snapshot.pendingKinpei.decisionOwners ?? [snapshot.pendingKinpei.winner]).includes(myself)
        ? { text: '金北の強化先を選択', tone: 'action' }
        : { text: `P${snapshot.pendingKinpei.winner} の金北選択待ち`, tone: 'waiting' };
    }
    if (snapshot.pendingKamiPochi) {
      return snapshot.pendingKamiPochi.decisionOwners.includes(myself)
        ? { text: '神ぽっちの牌を選択', tone: 'action' }
        : { text: `P${snapshot.pendingKamiPochi.winner} の神ぽっち選択待ち`, tone: 'waiting' };
    }
    if (snapshot.pendingPochiSwap) {
      return snapshot.pendingPochiSwap.decisionOwners.includes(myself)
        ? { text: 'ぽっちの高目を選択', tone: 'action' }
        : { text: `P${snapshot.pendingPochiSwap.winner} の高目選択待ち`, tone: 'waiting' };
    }
    if (snapshot.pendingFeverContinue) {
      return snapshot.pendingFeverContinue.winner === myself
        ? { text: 'フィーバーを続行', tone: 'action' }
        : { text: `P${snapshot.pendingFeverContinue.winner} の続行待ち`, tone: 'waiting' };
    }
    if (snapshot.awaitingRonDecision) {
      if (ronPlayers.includes(myself)) {
        return snapshot.game.shuvariActive[myself]
          ? { text: 'ロンしてください（強制）', tone: 'action' }
          : { text: 'ロン／見送るを選択', tone: 'action' };
      }
      return { text: 'ロン判定待ち', tone: 'waiting' };
    }
    if (snapshot.awaitingFulou) {
      const canCall = [...(snapshot.ponCandidates ?? []), ...(snapshot.kanCandidates ?? [])]
        .some((candidate: any) => candidate.player === myself && (candidate.mianzi?.length ?? 0) > 0);
      return canCall
        ? { text: '鳴く／見送るを選択', tone: 'action' }
        : { text: '鳴き判定待ち', tone: 'waiting' };
    }
    if (snapshot.pendingPingju) return { text: '流局処理中', tone: 'waiting' };
    if (snapshot.pendingQianggang) return { text: '槍槓判定中', tone: 'waiting' };
    if (snapshot.roundEnded) return { text: '局終了', tone: 'complete' };
    if (snapshot.lizhiPending !== null) {
      return snapshot.lizhiPending === myself
        ? { text: 'リーチする捨て牌を選択', tone: 'action' }
        : { text: `P${snapshot.lizhiPending} のリーチ牌待ち`, tone: 'waiting' };
    }
    if (activePlayer === myself) {
      if (waitingForDraw) return { text: 'ツモを進めてください', tone: 'action' };
      return tsumoAvailable
        ? { text: 'ツモ和了／打牌を選択', tone: 'action' }
        : { text: '打牌を選んでください', tone: 'action' };
    }
    return { text: `P${activePlayer} の手番`, tone: 'waiting' };
  }

  $: actionStatus = describeActionStatus($game, currentPlayer, selfPlayer, ronCandidates, needsZimo, canTsumo);

  // 牌譜 [event log] 全件
  $: events = $game.game.events;
  // ツモ履歴 [全 zimo event]
  $: zimoHistory = $game.game.events.filter((e: any) => e.type === 'zimo').map((e: any, i: number) => `${i+1}. p${e.player}: ${e.pai}`);

  // 全 116 枚集計 [山 + 手牌 + 副露 + 河 + 王牌 + ドラ + 抜き華]
  $: tileInventory = (() => {
    const counts: Record<string, number> = {};
    const inc = (p: string) => { if (!p) return; counts[p] = (counts[p] ?? 0) + 1; };
    const g = $game.game;
    // shan._pai [山 + 王牌込み]、 赤 [p0/s0/m0] / 金 [gp/gs/gN] / 4 色ぽ [z5*] は別 key 維持
    for (const p of ((g.shan as any)._pai ?? [])) inc(p);
    // 秋ドラ / カンドラで drawNewDora が _pai 末尾を pop して _baopai / _fubaopai に push してる、
    // 初期 2 枚 [index 0, 1] は _pai 内 [4, 5] / [9, 10] と重複なので skip、 index 2+ のみ追加カウント
    const _baopai = ((g.shan as any)._baopai ?? []) as string[];
    for (let i = 2; i < _baopai.length; i++) inc(_baopai[i]);
    const _fubaopai = ((g.shan as any)._fubaopai ?? []) as string[];
    for (let i = 2; i < _fubaopai.length; i++) inc(_fubaopai[i]);
    // 冬めくり牌 [shan._pai から pop されて 冬専用領域に保管]
    const _fuyuRevealed = ((g.shan as any)._fuyuRevealed ?? []) as string[];
    for (const p of _fuyuRevealed) inc(p);
    // 手牌 + 副露
    // debug: 各 player の bingpai.p[0]/bingpai.s[0] 集計確認
    const dbg: any = {};
    for (const pl of [0, 1, 2] as const) {
      const sp = g.shoupai.get(pl);
      if (sp) dbg[`p${pl}`] = { 'p[0]': sp._bingpai.p[0], 'p[5]': sp._bingpai.p[5], 's[0]': sp._bingpai.s[0], 's[5]': sp._bingpai.s[5], 'z[4]': sp._bingpai.z[4], gold: g.goldHand[pl] };
    }
    if ((window as any).__ANMIKA_DEBUG__) console.log('[tile inv]', JSON.stringify(dbg));
    for (const pl of [0, 1, 2] as const) {
      const sp = g.shoupai.get(pl);
      if (sp) {
        for (const s of ['m', 'p', 's', 'z']) {
          const len = s === 'z' ? 8 : 10;
          for (let n = 0; n < len; n++) {
            let cnt = sp._bingpai[s][n] ?? 0;
            // 0 補正: bingpai[s][0] = 赤 + 金 [両方 's0' / 'p0' で normalize されて bingpai に入る]
            // 集計で 's0' = 純粋赤、 'gs' = 金 別key にしたいので 金分を控除
            if (n === 0 && (s === 'p' || s === 's')) cnt -= g.goldHand[pl]?.[s] ?? 0;
            // 5 補正: bingpai[s][5] には赤 [s][0] + 金 含まれる
            if (n === 5 && s !== 'z') {
              cnt -= sp._bingpai[s][0] ?? 0;
              // 注: bingpai[s][0] には金分含む、 別途 goldHand 控除不要 [既に [s][0] 控除でカバー]
            }
            // 北 補正: bingpai.z[4] には金北 [goldHand.z] 含まれる
            if (n === 4 && s === 'z') cnt -= g.goldHand[pl]?.z ?? 0;
            if (s === 'z' && n === 5) continue;
            for (let k = 0; k < cnt; k++) inc(`${s}${n}`);
          }
        }
        // 金牌は別 key
        for (let k = 0; k < (g.goldHand[pl]?.p ?? 0); k++) inc('gp');
        for (let k = 0; k < (g.goldHand[pl]?.s ?? 0); k++) inc('gs');
        for (let k = 0; k < (g.goldHand[pl]?.z ?? 0); k++) inc('gN');
        // z5 系: pochiHand から 4 色別に inc
        const ph = g.pochiHand[pl] ?? { blue: 0, red: 0, green: 0, yellow: 0 };
        for (let k = 0; k < ph.blue; k++) inc('z5b');
        for (let k = 0; k < ph.red; k++) inc('z5r');
        for (let k = 0; k < ph.green; k++) inc('z5g');
        for (let k = 0; k < ph.yellow; k++) inc('z5y');
        // sp._zimo は _bingpai に既に含まれてる [majiang-core 仕様]、 別途 inc しない
        // R10 P2 #10 fix: mianzi 実 format は suite + digits [例: 'p333']
        for (const m of (sp._fulou ?? [])) {
          const stripped = (m as string).replace(/[\+=\-_*]/g, '');
          const suite = stripped[0];
          for (let i = 1; i < stripped.length; i++) {
            const digit = stripped[i];
            if (!/[0-9]/.test(digit)) continue;
            inc(suite + digit);
          }
        }
      }
      // 河: discardLog の gold/pochi meta を見て 正しい key に inc
      // [he._pai は plain key で記録されてるが、 金 / pochi 色は discardLog に残ってる]
      const dlog = g.discardLog[pl] ?? [];
      const he = g.he.get(pl);
      if (he?._pai) {
        const hePai = he._pai as string[];
        for (let i = 0; i < hePai.length; i++) {
          const stripped = hePai[i].replace(/[\+=\-_*]/g, '');
          const meta = dlog[i];
          // 金牌は gold key、 pochi 色は z5* key、 それ以外は plain
          if (meta?.gold && stripped === 'p0') inc('gp');
          else if (meta?.gold && stripped === 's0') inc('gs');
          else if (meta?.gold && stripped === 'z4') inc('gN');
          else if (meta?.pochi && stripped === 'z5') {
            const colorKey = { blue: 'z5b', red: 'z5r', green: 'z5g', yellow: 'z5y' }[meta.pochi];
            inc(colorKey ?? 'z5');
          } else inc(stripped);
        }
      }
      // 抜き華
      for (const hp of (g.huapai[pl] ?? [])) inc(hp);
      // 抜きドラ [通常 z4 抜き = nukidora、 金北抜き = nukidoraGold で別 inc]
      const nuki = g.nukidora[pl] ?? 0;
      const nukiG = (g as any).nukidoraGold?.[pl] ?? 0;
      for (let k = 0; k < nuki; k++) inc('z4');
      for (let k = 0; k < nukiG; k++) inc('gN');
    }
    return counts;
  })();
  $: tileExpected = (() => {
    const exp: Record<string, number> = {};
    for (const n of [7, 9]) exp[`m${n}`] = 4;
    for (const s of ['p', 's']) for (let n = 1; n <= 9; n++) {
      if (n === 5) exp[`${s}${n}`] = 2; // 5p/5s 通常は 2 枚 [赤 1 + 金 1 + 通常 2 = 4 枚]
      else exp[`${s}${n}`] = 4;
    }
    exp['p0'] = 1; exp['gp'] = 1; // 赤 5p / 金 5p 各 1
    exp['s0'] = 1; exp['gs'] = 1;
    for (let n = 1; n <= 7; n++) {
      if (n === 5) exp[`z${n}`] = 0; // z5 は 4 色別
      else if (n === 4) exp[`z${n}`] = 3; // 北 通常 3 + 金北 1
      else exp[`z${n}`] = 4;
    }
    exp['gN'] = 1;
    for (const c of ['z5b', 'z5r', 'z5g', 'z5y']) exp[c] = 1;
    for (let n = 1; n <= 4; n++) exp[`f${n}`] = 2;
    return exp;
  })();
  $: tileDiff = (() => {
    const diff: Array<{ pai: string; got: number; exp: number }> = [];
    const allKeys = new Set([...Object.keys(tileInventory), ...Object.keys(tileExpected)]);
    for (const k of Array.from(allKeys).sort()) {
      const got = tileInventory[k] ?? 0;
      const exp = tileExpected[k] ?? 0;
      // 赤牌 m0/p0/s0 は 5m と一緒にカウントしてる前提で別表示
      if (got !== exp) diff.push({ pai: k, got, exp });
    }
    return diff;
  })();

  // ドラ [表示牌の次] を計算
  function doraFrom(indicator: string): string {
    if (!indicator) return '';
    const core = toCorePai(indicator);
    const s = core[0];
    if (s === 'f') return indicator; // 華牌はドラ対象外、 そのまま華牌を表示
    const n = core[1] === '0' ? 5 : parseInt(core[1]);
    if (!Number.isFinite(n)) return indicator;
    if (s === 'z') {
      if (n <= 4) return 'z' + (n % 4 + 1);
      return 'z' + ((n - 4) % 3 + 5);
    }
    // アンミカ独自: 萬子は 7m/9m のみ、 7m → 9m / 9m → 7m 循環
    if (s === 'm') {
      if (n === 7) return 'm9';
      if (n === 9) return 'm7';
    }
    return s + (n % 9 + 1);
  }
  function eventLabel(e: any): string {
    if (e.type === 'qipai') return `配[p${e.player}] 13 枚`;
    if (e.type === 'zimo') return `ツモ[p${e.player}] ${e.pai}`;
    if (e.type === 'dapai') return `打[p${e.player}] ${e.pai}`;
    if (e.type === 'lizhi') return `リーチ[p${e.player}]`;
    return e.type;
  }

  // モバイル用 debug log [console を hijack して画面に表示]
  // R4 P2 #25 fix: dev mode のみ enable + リングバッファ [max 1000 件]、 長時間プレイで メモリ枯渇 防止
  // production [import.meta.env.PROD] では skip して console を一切 monkey patch しない
  const DEBUG_LOG_ENABLED = !!(import.meta as any).env?.DEV;
  const DEBUG_LOG_MAX = 1000;
  let debugLogs: string[] = [];
  if (typeof window !== 'undefined' && DEBUG_LOG_ENABLED) {
    const W = window as any;
    if (!W.__debugLogStore) W.__debugLogStore = [];
    if (!W.__debugLogHooked) {
      const stringify = (args: any[], prefix = '') => {
        try {
          return prefix + args.map((a) => {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
            try { return JSON.stringify(a); } catch { return String(a); }
          }).join(' ');
        } catch { return prefix + '[unstringifiable]'; }
      };
      const pushBounded = (entry: string) => {
        W.__debugLogStore.push(entry);
        if (W.__debugLogStore.length > DEBUG_LOG_MAX) {
          W.__debugLogStore.splice(0, W.__debugLogStore.length - DEBUG_LOG_MAX);
        }
      };
      const origLog = console.log.bind(console);
      const origWarn = console.warn.bind(console);
      const origErr = console.error.bind(console);
      console.log = (...args: any[]) => { pushBounded(stringify(args)); origLog(...args); };
      console.warn = (...args: any[]) => { pushBounded(stringify(args, '⚠️ ')); origWarn(...args); };
      console.error = (...args: any[]) => { pushBounded(stringify(args, '❌ ')); origErr(...args); };
      window.addEventListener('error', (e) => {
        pushBounded(`❌ uncaught: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack ?? ''}`);
      });
      window.addEventListener('unhandledrejection', (e) => {
        pushBounded(`❌ unhandled rejection: ${e.reason?.message ?? e.reason}\n${e.reason?.stack ?? ''}`);
      });
      W.__debugLogHooked = true;
    }
    // 200ms 間隔で window store → reactive debugLogs に同期
    const syncLogs = () => {
      if (W.__debugLogStore.length !== debugLogs.length) {
        debugLogs = [...W.__debugLogStore];
      }
    };
    // window 上に interval id を保持して 多重起動を防ぐ [HMR / remount で積み重ねないように]
    if (W.__debugLogSyncInterval) clearInterval(W.__debugLogSyncInterval);
    W.__debugLogSyncInterval = setInterval(syncLogs, 200);
    syncLogs();
  }

  // 牌譜 ロード [load]
  let loadedPaifu: { events: any[]; state: any; timestamp: string } | null = null;
  let loadedReplayIdx = 0;

  function onPaifuFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.type !== 'anmika-mahjong-paifu') {
          alert('対応していない牌譜形式');
          return;
        }
        loadedPaifu = data;
        loadedReplayIdx = 0;
        const ver = data.version ?? 1;
        // v1 [旧形式] は state 完全復元不可、 event 表示のみ
        if (ver < 2) {
          alert(
            '⚠️ 牌譜 v1 [旧形式] を load しました。\n\n' +
            'event list の表示のみ可能、 game state の完全復元はできません。\n' +
            '[v1 は shoupai / shan の snapshot を持たないため]\n\n' +
            'replay 機能は使えますが、 途中再開や 役満再現は v2 で取得した牌譜が必要です。',
          );
        } else if (confirm('牌譜から game state を完全復元する？')) {
          game.loadFromPaifu(data);
        }
      } catch (err) {
        alert('牌譜パース失敗: ' + err);
      }
    };
    reader.readAsText(file);
  }

  function replayLabel(e: any): string {
    if (!e) return '';
    if (e.type === 'qipai') return `配[p${e.player}] ${(e.tiles ?? []).join(' ')}`;
    if (e.type === 'zimo') return `ツモ[p${e.player}] ${e.pai}`;
    if (e.type === 'dapai') return `打[p${e.player}] ${e.pai}`;
    if (e.type === 'fulou') return `副露[p${e.player}] from p${e.from} ${e.mianzi}`;
    if (e.type === 'gang') return `カン[p${e.player}] ${e.mianzi}`;
    if (e.type === 'lizhi') return `リーチ[p${e.player}]`;
    return e.type;
  }

  function exportPaifu() {
    if (!canSavePaifu) {
      alert('牌譜は、選択待ちのない安全な手番開始時か半荘終了時に保存できます。');
      return;
    }
    const data = buildCanonicalPaifuSnapshot($game);
    const blob = new Blob([serializeCanonical(data, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paifu_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ポッチ開封演出中は自家手牌のツモ牌 [末尾] の色を伏せる [2026-07-16 リョー報告:
  // 「ポッチ何かな」演出中に手牌側で色が即バレしてた]
  const POCHI_COLORED_KEYS = new Set(['z5b', 'z5r', 'z5g', 'z5y', 'bu', 'br', 'bg', 'by']);
  function maskZimoPochi(tiles: string[]): string[] {
    if (tiles.length === 0) return tiles;
    const last = tiles[tiles.length - 1];
    if (!POCHI_COLORED_KEYS.has(last)) return tiles;
    const out = [...tiles];
    out[out.length - 1] = 'z5';
    return out;
  }

  function handTiles(sp: any, player?: number, maskPochiZimo = false): string[] {
    if (!sp) return [];
    if (sp._bingpai?.__anmika) {
      const bp = sp._bingpai;
      const x = bp.__anmika;
      const out: string[] = [];
      const pushN = (pai: string, n: number) => { for (let i = 0; i < Math.max(0, n); i++) out.push(pai); };
      for (const s of ['m', 'p', 's', 'z']) {
        const len = s === 'z' ? 8 : 10;
        for (let n = 1; n < len; n++) {
          if (s === 'z' && n === 5) continue;
          let cnt = bp[s]?.[n] ?? 0;
          if ((s === 'p' || s === 's') && n === 5) cnt -= bp[s]?.[0] ?? 0;
          if (s === 'z' && n === 4) cnt -= x.gN ?? 0;
          if (s === 'p' && n === 3) cnt -= x.np3 ?? 0;
          if (s === 's' && n === 3) cnt -= x.ns3 ?? 0;
          if (s === 'z' && n === 3) cnt -= x.nz3 ?? 0;
          pushN(`${s}${n}`, cnt);
        }
        if (s === 'p') {
          pushN('p0', (bp.p?.[0] ?? 0) - (x.gp ?? 0));
          pushN('gp', x.gp ?? 0);
        } else if (s === 's') {
          pushN('s0', (bp.s?.[0] ?? 0) - (x.gs ?? 0));
          pushN('gs', x.gs ?? 0);
        }
      }
      pushN('np3', x.np3 ?? 0);
      pushN('ns3', x.ns3 ?? 0);
      pushN('gN', x.gN ?? 0);
      pushN('nz3', x.nz3 ?? 0);
      pushN('z5b', x.z5b ?? 0);
      pushN('z5r', x.z5r ?? 0);
      pushN('z5g', x.z5g ?? 0);
      pushN('z5y', x.z5y ?? 0);
      const coloredZ5 = (x.z5b ?? 0) + (x.z5r ?? 0) + (x.z5g ?? 0) + (x.z5y ?? 0);
      pushN('z5', (bp.z?.[5] ?? 0) - coloredZ5);
      // Online seat projections represent undisclosed physical faces only as
      // an anonymous count.  They must render as backs and never be invented
      // as ordinary core tiles.
      pushN('back', bp._ ?? 0);
      out.sort(compareTiles);
      const rawZimo = sp._anmikaZimo ?? sp._zimo;
      if (rawZimo && String(rawZimo).length <= 3) {
        const idx = out.lastIndexOf(rawZimo);
        if (idx >= 0) {
          out.splice(idx, 1);
          out.push(rawZimo);
        }
      }
      return maskPochiZimo ? maskZimoPochi(out) : out;
    }
    const bingpaiStr: string = sp.toString().split(',')[0] ?? '';
    let tiles: string[] = parseTilesFromStr(bingpaiStr);
    tiles.sort(compareTiles);
    // ツモ牌があれば末尾に分離 [視覚的に区別]、 _zimo が mianzi の場合は副露後の擬似 zimo なのでスキップ
    if (sp._zimo && sp._zimo.length <= 3) {
      const idx = tiles.lastIndexOf(sp._zimo);
      if (idx >= 0) {
        tiles.splice(idx, 1);
        tiles.push(sp._zimo);
      }
    }
    // 金牌の表記置換 [アンミカ独自レイヤー]: goldHand[player] の枚数分、 該当牌を金表記に
    // R12 P1 #4 fix: ツモ牌 [末尾] が gold/pochi なら 先に 末尾 へ割り当て、 残数を左から
    // 通常 remap。 旧 code は左から remap で ツモ牌の色が 別牌に migrate する bug
    if (player !== undefined) {
      const gh = { ...$game.game.goldHand[player as 0 | 1 | 2] };
      const ph = { ...$game.game.pochiHand[player as 0 | 1 | 2] };
      const lzi = ($game.game as any).lastZimoInfo;
      const isOwnZimo = lzi && lzi.player === player && tiles.length > 0;
      const lastIdx = tiles.length - 1;
      const lastPai = isOwnZimo ? tiles[lastIdx] : null;
      if (isOwnZimo && lzi.gold && lastPai) {
        if (lastPai === 'p0' && gh.p > 0) { tiles[lastIdx] = 'gp'; gh.p -= 1; }
        else if (lastPai === 's0' && gh.s > 0) { tiles[lastIdx] = 'gs'; gh.s -= 1; }
        else if (lastPai === 'z4' && gh.z > 0) { tiles[lastIdx] = 'gN'; gh.z -= 1; }
      }
      if (isOwnZimo && lzi.pochi && lastPai === 'z5' && (ph as any)[lzi.pochi] > 0) {
        const colorKey: Record<string, string> = { blue: 'bu', red: 'br', green: 'bg', yellow: 'by' };
        tiles[lastIdx] = colorKey[lzi.pochi] ?? 'z5';
        (ph as any)[lzi.pochi] -= 1;
      }
      tiles = remapGoldTiles(tiles, gh);
      tiles = remapPochiTiles(tiles, ph);
    }
    return maskPochiZimo ? maskZimoPochi(tiles) : tiles;
  }

  function remapGoldTiles(tiles: string[], gh: { p: number; s: number; z: number }): string[] {
    const out = [...tiles];
    let np = gh.p, ns = gh.s, nz = gh.z;
    for (let i = 0; i < out.length && (np || ns || nz); i++) {
      if (np > 0 && out[i] === 'p0') { out[i] = 'gp'; np--; }
      else if (ns > 0 && out[i] === 's0') { out[i] = 'gs'; ns--; }
      else if (nz > 0 && out[i] === 'z4') { out[i] = 'gN'; nz--; }
    }
    return out;
  }

  /** z5 を player の pochiHand 色に応じて [bu / br / bg / by] に展開 */
  function remapPochiTiles(tiles: string[], ph: { blue: number; red: number; green: number; yellow: number }): string[] {
    const out = [...tiles];
    let nb = ph.blue, nr = ph.red, ng = ph.green, ny = ph.yellow;
    for (let i = 0; i < out.length && (nb || nr || ng || ny); i++) {
      if (out[i] === 'z5') {
        if (nb > 0) { out[i] = 'bu'; nb--; }
        else if (nr > 0) { out[i] = 'br'; nr--; }
        else if (ng > 0) { out[i] = 'bg'; ng--; }
        else if (ny > 0) { out[i] = 'by'; ny--; }
      }
    }
    return out;
  }

  function lastZimoIndex(sp: any, tiles: string[]): number {
    if (!sp || !sp._zimo) return -1;
    // _zimo が mianzi 文字列 [length > 3] の場合は副露後の擬似 zimo、 マーク不要
    if (sp._zimo.length > 3) return -1;
    return tiles.length - 1;
  }

  // 鳴き向き [Bug 1 fix 2026-05-20]: viewer-relative に rotateIdx を 再計算。
  // 視覚配置 [リョー確認 P1 左 / P0 中央 / P2 右] に対し、 鳴き元 [fromPlayer] が
  // 表示中 player の どちら側に位置するかで rotateIdx を 0 [左端] or 2 [右端] に決める。
  // 既存 majiang-core marker [+/-/=] による rotateIdx は seat index 基準で
  // viewer 配置と食い違う [riichi 反時計回り vs 視覚 P1→P0→P2]、 これを 正す。
  const VIEWER_SEAT_X: Record<number, number> = { 0: 1, 1: 0, 2: 2 };
  function viewerRotateIdx(player: number, fromPlayer: number, fallback: number | null): number | null {
    if (fromPlayer == null || fromPlayer === player) return fallback;
    const ps = VIEWER_SEAT_X[player];
    const fs = VIEWER_SEAT_X[fromPlayer];
    if (ps === undefined || fs === undefined) return fallback;
    if (fs < ps) return 0;
    if (fs > ps) return 2;
    return 1;
  }

  function fulouMianzi(sp: any, player: number): import('./lib/fulouDisplay').FulouMianzi[] {
    if (!sp || !sp._fulou) return [];
    const parsed = parseFulouList(sp._fulou as string[]);
    const openMeta = sp._anmikaFulou ?? [];
    const physicalMeta = sp._anmikaFulouPhysical ?? [];
    return parsed.map((m, i) => {
      const entry = openMeta[i] ?? {};
      const adjustedRotate = entry.from != null
        ? viewerRotateIdx(player, entry.from, m.rotateIdx)
        : m.rotateIdx;
      const mianzi = (sp._fulou as string[])[i] ?? '';
      const applied = applyAnmikaFulouIdentity(mianzi, { ...m, rotateIdx: adjustedRotate }, openMeta, physicalMeta, adjustedRotate);
      return applied;
    });
  }

  function parseTilesFromStr(s: string): string[] {
    const tiles: string[] = [];
    let i = 0;
    let prefix = '';
    while (i < s.length) {
      const c = s[i];
      if (c === 'm' || c === 'p' || c === 's' || c === 'z') {
        prefix = c;
        i++;
      } else if (c === ',' || c === '_' || c === '*') {
        i++;
      } else {
        tiles.push(prefix + c);
        i++;
      }
    }
    return tiles;
  }

  function compareTiles(a: string, b: string): number {
    // [Bug 1 fix 2026-05-20] 金牌 [gp/gs/gN] / 白ポッチ [z5b/r/g/y] を core 牌
    // [p5/s5/z4/z5] と同じ位置で ソート、 完全独立化 [4d1f476] で 「一番右」 に
    // 飛ばされてた bug 修正。 同一数字グループ内 の subtype 順は 通常→赤→金→白色 順。
    function tileKey(t: string): { suit: number; num: number; sub: number } {
      const order = { m: 0, p: 1, s: 2, z: 3 };
      if (t === 'back') return { suit: 99, num: 99, sub: 99 };
      // 金牌
      if (t === 'gp') return { suit: 1, num: 5, sub: 2 };
      if (t === 'gs') return { suit: 2, num: 5, sub: 2 };
      if (t === 'gN') return { suit: 3, num: 4, sub: 1 };
      // 虹牌
      if (t === 'np3') return { suit: 1, num: 3, sub: 1 };
      if (t === 'ns3') return { suit: 2, num: 3, sub: 1 };
      if (t === 'nz3') return { suit: 3, num: 3, sub: 1 };
      // 白ポッチ
      if (t === 'z5b') return { suit: 3, num: 5, sub: 1 };
      if (t === 'z5r') return { suit: 3, num: 5, sub: 2 };
      if (t === 'z5g') return { suit: 3, num: 5, sub: 3 };
      if (t === 'z5y') return { suit: 3, num: 5, sub: 4 };
      // 旧 svelte 表記 [bu/br/bg/by 河描画用、 通常 hand には 来ない が 安全側]
      if (t === 'bu') return { suit: 3, num: 5, sub: 1 };
      if (t === 'br') return { suit: 3, num: 5, sub: 2 };
      if (t === 'bg') return { suit: 3, num: 5, sub: 3 };
      if (t === 'by') return { suit: 3, num: 5, sub: 4 };
      const suit = order[t[0] as keyof typeof order] ?? 9;
      const ch = t[1] ?? '';
      const num = ch === '0' ? 5 : (parseInt(ch) || 0);
      const sub = ch === '0' ? 1 : 0;  // 赤 5 は 通常 5 の直後
      return { suit, num, sub };
    }
    const ka = tileKey(a);
    const kb = tileKey(b);
    if (ka.suit !== kb.suit) return ka.suit - kb.suit;
    if (ka.num !== kb.num) return ka.num - kb.num;
    return ka.sub - kb.sub;
  }

  function handHe(he: any, player?: number): string[] {
    if (!he) return [];
    // `__` suffix [リーチ宣言牌 marker、 bug 2 fix 2026-05-14] は preserve、 他の制御文字は strip
    // 注意: ツモ切り convention `<tile>_` も `_` 付きで来る、 区別のため lizhi は `__` を使う
    let lizhiSeen = false;
    // F1 [2026-05-15]: He.fulou で 末尾に付与される 副露 marker [+/=/-] を検出 → `#n` suffix で 河 表示薄化
    const raw = (he._pai ?? []).map((p: string) => {
      const hasLizhi = p.endsWith('__');
      const hasNaki = /[\+\=\-]/.test(p);
      const stripped = p.replace(/[\+\=\-_*]/g, '');
      let s = stripped;
      if (hasNaki) s = s + '#n';
      if (hasLizhi && !lizhiSeen) {
        lizhiSeen = true;
        s = s + '_';  // 内部 marker は `_` のまま [PlayerHandPanel 等 既存 css 互換]
      }
      return s;
    });
    if (player === undefined) return raw;
    // discardLog から色情報を取得して z5 を bu/br/bg/by に / 金 5p を gp に置換
    const log = $game.game.discardLog[player as 0 | 1 | 2] ?? [];
    return raw.map((p: string, i: number) => {
      const entry = log[i];
      const hasLizhi = p.endsWith('_');
      const woLizhi = p.replace(/_$/, '');
      // F1: `#n` 副露 marker を 一旦 退避、 remap 後に 再付与
      const hasNaki = woLizhi.includes('#n');
      const base = woLizhi.replace(/#n/g, '');
      const remap = (b: string): string => {
        if (!entry) return b;
        if (entry.pai === 'gp' || entry.pai === 'gs' || entry.pai === 'gN'
            || entry.pai === 'z5b' || entry.pai === 'z5r' || entry.pai === 'z5g' || entry.pai === 'z5y'
            || entry.pai === 'np3' || entry.pai === 'ns3' || entry.pai === 'nz3') {
          return entry.pai;
        }
        if (entry.gold) {
          if (b === 'p0') return 'gp';
          if (b === 's0') return 'gs';
        }
        if (entry.pochi) {
          const m: Record<string, string> = { blue: 'bu', red: 'br', green: 'bg', yellow: 'by' };
          return m[entry.pochi] ?? b;
        }
        return b;
      };
      const mapped = remap(base);
      // ツモ切り marker `#t` / 鳴かれ marker `#n` を suffix で渡す [PlayerHandPanel が判定して css 適用]
      // 順序: <tile>(#n)?(#t)?(_)?  lizhi `_` は最後尾 [既存 endsWith('_') 互換]
      const withNaki = hasNaki ? mapped + '#n' : mapped;
      const withTsumogiri = entry?.tsumogiri ? withNaki + '#t' : withNaki;
      return hasLizhi ? withTsumogiri + '_' : withTsumogiri;
    });
  }

  function onTileClick(player: number, pai: string) {
    if (player !== currentPlayer) return; // 自家以外は無視
    // 2026-05-14 codex review #3 fix: modal / ロン / 副露待ち / フィーバー継続 中の手牌クリック を
    // game.discard へ到達させない、 各種 modal pending 中の打牌入力を遮断
    // R4 P1 #17 fix: lizhiPending 中も リーチ宣言牌 [isLizhiCand] のみ許可、 全 block ではない。
    // store.discard 側に lizhiPending 宣言牌判定 path がある [line 561-594] ので、 候補なら通す
    if ($game.roundEnded || $game.awaitingRonDecision || $game.awaitingFulou
        || $game.pendingFuyu || $game.pendingKinpei || $game.pendingKamiPochi || $game.pendingPochiSwap || $game.pendingSaiKoro
        || $game.pendingFeverContinue) return;
    if ($game.lizhiPending !== null && !isLizhiCand(pai)) return;
    // online 中は自席のみ
    if (onlineGameStarted && player !== selfPlayer) return;
    // 金牌 [gp/gs/gN] / 白ぽっち [bu/br/bg/by] を内部 majiang-core 表記 + meta に変換
    // 通常 p0 / s0 [赤] / z4 [北] も明示 meta=false を渡して dapai の auto-pick 金 を抑制
    let actualPai = pai;
    let meta: { gold?: boolean; pochi?: 'blue' | 'red' | 'green' | 'yellow' } | undefined;
    // 2026-05-14 codex review P2 fix: consumeGold/consumePochi の事前 call を削除、
    // discard(meta) 内 game.dapai が meta.gold / meta.pochi 見て自前 decrement する設計に
    // 統一。 二重 decrement リスク + online 非送信 で 同期破れる 問題 を解消。
    if (pai === 'gp') {
      actualPai = 'p0';
      meta = { gold: true };
    } else if (pai === 'gs') {
      actualPai = 's0';
      meta = { gold: true };
    } else if (pai === 'gN') {
      // 金北: actualPai は z4 にして、 nukiBei 経路で declareNukiBei が gold 抜き判定する
      actualPai = 'z4';
      meta = { gold: true };
    } else if (pai === 'p0' || pai === 's0') {
      // 赤 5p/5s [金じゃない]、 明示
      meta = { gold: false };
    } else if (pai === 'bu' || pai === 'br' || pai === 'bg' || pai === 'by'
        || pai === 'z5b' || pai === 'z5r' || pai === 'z5g' || pai === 'z5y') {
      actualPai = pai.startsWith('z5') ? pai : 'z5';
      const colorMap: Record<string, 'blue' | 'red' | 'green' | 'yellow'> = {
        bu: 'blue', br: 'red', bg: 'green', by: 'yellow',
        z5b: 'blue', z5r: 'red', z5g: 'green', z5y: 'yellow',
      };
      meta = { pochi: colorMap[pai] };
    }
    // 北 [z4] / 金北 [gN]: アンミカ独自仕様で 「河に切れない、 北抜きのみ」 [リョー指示 2026-05-11]
    // canNukiBei 可能ならその場で北抜き、 不可なら no-op silent [流し役満 を成立させるための保護]
    // R12 P2 #5 fix: gN / z4 を区別して meta.gold を渡す。 旧 code は meta なしで
    // declareNukiBei が常に 金北優先消費 → 通常北クリックで金北が抜かれる bug
    if (actualPai === 'z4') {
      if ($game.game.canNukiBei(player as any)) {
        game.nukiBei({ gold: meta?.gold === true });
      }
      return;
    }
    // リーチ中は物理的なツモ牌そのものだけを切れる。core 化後に比較すると
    // gp→p0 等で正しい金牌ツモ切りを拒否し、逆に別物の赤牌を許してしまう。
    const selectedPhysicalPai = pai.replace(/[_*]$/, '');
    const drawnPhysicalPai = $game.lastZimo?.replace(/[_*]$/, '') ?? null;
    if ($game.game.lizhi.has(player as any) && drawnPhysicalPai && selectedPhysicalPai !== drawnPhysicalPai) {
      return;
    }
    // フィーバー立直中は フィーバー宣言者以外は ツモ切り強制 [抜き牌は別動線で OK]
    const someoneFever = ([0, 1, 2] as const).some((p) => $game.game.feverActive[p]);
    if (someoneFever && !$game.game.feverActive[player as 0|1|2]) {
      if (drawnPhysicalPai && selectedPhysicalPai !== drawnPhysicalPai) {
        return;
      }
    }
    game.discard(actualPai, meta);
  }

  type FeverWaitRow = {
    tile: string;
    remain: number;
    hasRed?: boolean;
    hasGold?: boolean;
    hasNiji?: boolean;
  };

  // フィーバー中 待ち牌の残り枚数 + 赤金虹有無。
  // 残り = 4 - 全 player の手牌 + 全 player の河 + 全 副露 + 表ドラ表示牌
  function feverWaitInfo(player: number): FeverWaitRow[] {
    // 対戦中の他家の山・手牌はクライアントに存在しない。成立後にサーバーが
    // 公開した裁定済み情報だけを表示し、伏せ牌から推測し直さない。
    if (onlineGameStarted) {
      const published = (($game.game as any).feverWaitPublicInfo ?? []) as Array<{
        player: number;
        waits: FeverWaitRow[];
      }>;
      const row = published.find((entry) => entry.player === player);
      return row ? row.waits.map((wait) => ({ ...wait })) : [];
    }
    const sp = $game.game.shoupai.get(player as 0|1|2);
    if (!sp) return [];
    // フィーバー中は declare 時の固定 wait を使う [リョー指示 2026-05-12: tsumo で変動しないように]
    const tings: string[] = $game.game.feverActive[player as 0|1|2]
      ? ($game.game.feverDeclareTing?.[player as 0|1|2] ?? [])
      : (($game.game as any).getTingpaiList?.(player) ?? []);
    const baseTile = (p: string) => {
      const stripped = p.replace(/[\+=\-_*]/g, '');
      const core = toCorePai(stripped);
      return core[0] + (core[1] === '0' ? '5' : core[1]);
    };
    const countVisible = (ss: string, nn: number): number => {
      const target = ss + nn;
      let n = 0;
      for (const p of [0, 1, 2] as const) {
        const psp = $game.game.shoupai.get(p);
        if (psp) {
          n += (psp._bingpai?.[ss]?.[nn] ?? 0);
          // _bingpai[ss][nn] already includes red/gold physical copies.
          // 副露の中身も探す
          // R10 P2 #10 fix: mianzi 実フォーマットは suite + digits [例: 'p333', 'z5555', 'p333+']、
          // 各 digit を suite と組み合わせて pai に展開
          for (const m of psp._fulou ?? []) {
            const stripped = (m as string).replace(/[\+=\-]/g, '');
            const suite = stripped[0];
            for (let i = 1; i < stripped.length; i++) {
              const digit = stripped[i];
              if (!/[0-9]/.test(digit)) continue;
              if (baseTile(suite + digit) === target) n++;
            }
          }
        }
        const phe = $game.game.he.get(p);
        if (phe?._pai) {
          for (const d of phe._pai as string[]) {
            if (baseTile(d) === target) n++;
          }
        }
      }
      // 表ドラ表示牌
      for (const b of $game.game.shan.baopai ?? []) {
        if (baseTile(b) === target) n++;
      }
      return n;
    };
    return tings
      .map((t) => {
        const normalized = baseTile(t);
        const ss = normalized[0]; const nn = parseInt(normalized[1]);
        const visible = countVisible(ss, nn);
        // 白ぽっちだけが山に残っていても FEVER の生存待ちには数えない。
        const remain = normalized === 'z5' ? 0 : Math.max(0, 4 - visible);
        const info: any = { tile: normalized, remain };
        if ((ss === 'p' && nn === 5) || (ss === 's' && nn === 5)) {
          info.hasRed = remain > 0;
          info.hasGold = remain > 1;
        }
        if ((ss === 'p' || ss === 's' || ss === 'z') && nn === 3) {
          info.hasNiji = remain > 0;
        }
        return info;
      });
  }

  function fuyuWaitRemain(player: PlayerId, tings: string[]): number {
    if (onlineGameStarted) {
      const published = (($game.game as any).feverWaitPublicInfo ?? []) as Array<{
        player: number; waits: Array<{ tile: string; remain: number }>;
      }>;
      const row = published.find((entry) => entry.player === player);
      return row?.waits
        .filter((wait) => displayTileWaitCore(wait.tile) !== 'z5')
        .reduce((sum, wait) => sum + wait.remain, 0) ?? 0;
    }
    const waits = new Set(tings.map(displayTileWaitCore).filter((tile) => tile !== 'z5'));
    return (((($game.game.shan as any)._pai ?? []) as string[])
      .filter((pai) => waits.has(displayTileWaitCore(pai))).length);
  }
  // フィーバー成立後の待ちは、ルール手順で他家が当たり牌を晒すため公開情報。
  // 宣言牌へのロン窓が閉じる前はまだ手牌・待ちとも公開しない。
  $: feverWaits = ([0, 1, 2] as const).map((p) => {
    if (!$game.game.isFeverConfirmed(p)) return null;
    return { player: p, waits: feverWaitInfo(p) };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  // フィーバー時: 他家手牌にあるアガリ牌 [フィーバー待ち] を強制表示 [2026-07-16 リョー指示]
  // ぽっちは白 [z5] 待ちの時だけ見せる [z5 待ちならぽっち含め表示、それ以外の待ちでぽっちは伏せたまま]
  function displayTileWaitCore(t: string): string {
    if (t === 'bu' || t === 'br' || t === 'bg' || t === 'by') return 'z5';
    const core = toCorePai(t);
    if (core.length >= 2 && core[1] === '0') return core[0] + '5';
    return core;
  }
  function computeSideTiles(
    tiles: string[], seat: number, waitCores: Set<string>, reveal: boolean, self: number,
  ): string[] {
    if (reveal || self === seat) return tiles;
    // 宣言牌がロンされず、フィーバーが成立してから宣言者の手牌を公開する。
    if ($game.game.isFeverConfirmed(seat as 0|1|2)) return tiles;
    if (waitCores.size === 0) return tiles.map(() => 'back');
    return tiles.map((t) => (waitCores.has(displayTileWaitCore(t)) ? t : 'back'));
  }
  // feverWaitCores: UI テキスト表示用 (online privacy filter 適用済み)
  $: feverWaitCores = new Set(feverWaits.flatMap((fw) => fw.waits.map((w) => w.tile)));
  // feverRevealCores: 牌の表向き表示用 — feverDeclareTing から直接取得
  // online mode でも他家フィーバー待ち牌はゲーム機構として表向き表示する
  $: feverRevealCores = new Set(
    ([0, 1, 2] as const).flatMap((p) => {
      if (!$game.game.isFeverConfirmed(p)) return [];
      return ($game.game.feverDeclareTing?.[p] ?? []);
    })
  );
  $: sideTiles1 = computeSideTiles(shoupai1, srv1, feverRevealCores, revealAll, selfPlayer);
  $: sideTiles2 = computeSideTiles(shoupai2, srv2, feverRevealCores, revealAll, selfPlayer);

  // リーチ宣言牌候補 [リーチ button 押下後に表示、 候補以外を grayout]
  // 2026-07-16 リョー裁定: フィーバー宣言中はフィーバーが成立する宣言牌だけに絞る
  // [7 暗刻を崩す牌は候補に出さない。通常リーチへの自動降格は廃止]
  $: lizhiCandidates = (() => {
    if (!$game.game.canLizhi(currentPlayer)) return [];
    const base = $game.game.getLizhiCandidates(currentPlayer);
    if (($game as any)._lizhiFever && $game.lizhiPending === currentPlayer) {
      const feverMap = $game.game.feverCandidatesByDapai(currentPlayer);
      const norm = (p: string) => p.replace(/_$/, '');
      return base.filter((c: string) => feverMap.has(norm(c)));
    }
    return base;
  })();
  function isLizhiCand(pai: string): boolean {
    if (lizhiCandidates.length === 0) return false;
    // R8 fix: 表示牌 [gp/gs/gN/bu/br/bg/by] を 内部候補 [p0/s0/z4/z5] に normalize、
    // リーチ pending 中の 金牌 / 色付き白 が宣言牌候補なのに click 弾かれる bug 解消
    const normalize = (p: string): string => {
      if (p === 'gp') return 'p0';
      if (p === 'gs') return 's0';
      if (p === 'gN') return 'z4';
      if (p === 'bu' || p === 'br' || p === 'bg' || p === 'by'
          || p === 'z5b' || p === 'z5r' || p === 'z5g' || p === 'z5y') return 'z5';
      if (p === 'np3') return 'p3';
      if (p === 'ns3') return 's3';
      if (p === 'nz3') return 'z3';
      return p;
    };
    const target = normalize(pai);
    return lizhiCandidates.some((c) => normalize(c.replace(/_$/, '')) === target);
  }

  // [2026-05-16 bug 8 wiring] 打牌候補ごと fever 可否、 「9s 切れば fever、 他は通常リーチ」 表示用
  $: feverDapaiMap = $game.game.canLizhi(currentPlayer)
    ? $game.game.feverCandidatesByDapai(currentPlayer)
    : new Map();
  $: feverDapaiTiles = Array.from(feverDapaiMap.keys()) as string[];
  $: feverAvailable = $game.game.canFeverLizhi(currentPlayer).ok || feverDapaiTiles.length > 0;
  $: feverIsConditional = feverDapaiTiles.length > 0 && feverDapaiTiles.length < lizhiCandidates.length;

  // 手牌中のドラ数 [赤牌 + 表ドラ一致]
  function countDora(sp: any): number {
    if (!sp) return 0;
    let count = 0;
    const dora = baopai.map(doraFrom);
    const tiles = handTiles(sp);
    tiles.push(...fulouFlatTiles(sp?._fulou));
    for (const t of tiles) {
      if (t[1] === '0') count++; // 赤
      const norm = t[0] + (t[1] === '0' ? '5' : t[1]);
      if (dora.some((d) => d === norm || d === t)) count++;
    }
    return count;
  }
  $: oyaPlayer = (((state.qijia ?? 0) - (state.jushu ?? 0)) % 3 + 3) % 3;
  $: dora0 = countDora($game.game.shoupai.get(0));
  $: dora1 = countDora($game.game.shoupai.get(1));
  $: dora2 = countDora($game.game.shoupai.get(2));

  // view mode toggle [リョー指示 2026-05-12 一人回しモード]
  // default: 一人回しモード [single] [リョー指示 2026-05-12 default 化]
  let viewMode: 'dev' | 'single' | 'online' = 'single';
  // app 起動時メニュー: 「一人回し / 対戦」 2 button、 リョー指示 2026-05-13
  let appMode: 'menu' | 'started' = 'menu';
  let currentRoomId: string | null = null;
  let onlineMe: { user_id: string; username: string } | null = null;
  let onlineGameStarted = false;
  let onlineRoomMeta: { isHost: boolean; hostUserId: string; mySeat: number } | null = null;
  let onlineWs: WebSocket | null = null;
  let onlineMembers: Array<{ seat: number; user_id: string; username: string; is_cpu: boolean }> = [];
  let onlineSocketGeneration = 0;
  let onlineReconnectAttempt = 0;
  let onlineReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let onlineShouldReconnect = false;
  let lastReadyNextRoundKey = '';

  function seatName(seat: number): string {
    const m = onlineMembers.find((x) => x.seat === seat);
    if (m) return m.username + (m.is_cpu ? ' [CPU]' : '');
    return `P${seat}`;
  }

  function initializeOnlineFromStart(ws: WebSocket, msg: any, protocol = { revision: 0, matchId: 1, roundId: 1 }): boolean {
    onlineMembers = msg.members ?? [];
    const hostMember = onlineMembers.find((m: any) => m.user_id === onlineRoomMeta?.hostUserId);
    const hostSeat = hostMember?.seat as 0|1|2|undefined;
    const initOpts: any = {
      ws,
      qijia: msg.qijia ?? 0,
      cpuSeats: onlineMembers.filter((m: any) => m.is_cpu).map((m: any) => m.seat),
      mySeat: onlineRoomMeta?.mySeat as 0|1|2|undefined,
      isHost: !!onlineRoomMeta?.isHost,
      hostSeat,
      ...protocol,
    };
    if (msg.blindStart) {
      initOpts.blindStart = {
        hands: msg.hands, firstZimo: msg.firstZimo, paishu: msg.paishu,
        baopai: msg.baopai, fubaopai: msg.fubaopai,
        huapai: msg.huapai, goldHand: msg.goldHand, pochiHand: msg.pochiHand,
      };
    } else {
      initOpts.preShuffledPool = msg.preShuffledPool;
    }
    game.initOnlineGame(initOpts);
    if (msg.state && !game.hydrateOnlineProjection(msg.state)) {
      return false;
    }
    onlineGameStarted = true;
    viewMode = 'single';
    selfPlayer = onlineRoomMeta!.mySeat as 0 | 1 | 2;
    revealAll = false;
    if (msg.chipLedger) {
      const currentGame = (get(game) as any).game;
      for (const k of [0, 1, 2]) {
        const value = msg.chipLedger[String(k)] ?? msg.chipLedger[k];
        if (typeof value === 'number') currentGame.chipLedger[k] = value;
      }
    }
    const projectedBaseline = msg.state?.store?.matchStartChipLedger;
    if (projectedBaseline) {
      matchStartChipLedger = {
        0: Number(projectedBaseline[0] ?? projectedBaseline['0'] ?? 0),
        1: Number(projectedBaseline[1] ?? projectedBaseline['1'] ?? 0),
        2: Number(projectedBaseline[2] ?? projectedBaseline['2'] ?? 0),
      };
    }
    return true;
  }

  function applyRevisionedAction(ws: WebSocket, msg: any): void {
    const current = game.getOnlineProtocolState();
    if (!Number.isInteger(msg.revision)) return;
    if (msg.revision <= current.revision) return;
    if (msg.revision !== current.revision + 1) {
      ws.send(JSON.stringify({ type: 'resync', expectedVersion: current.revision }));
      return;
    }
    const fromSeat = msg.from_seat;
    if (fromSeat !== 0 && fromSeat !== 1 && fromSeat !== 2) {
      ws.send(JSON.stringify({ type: 'resync', expectedVersion: current.revision }));
      return;
    }
    const applied = game.applyOnlineRemoteAction(fromSeat, msg.action);
    if (msg.action?._state && applied !== true) {
      ws.send(JSON.stringify({ type: 'resync', expectedVersion: current.revision }));
      return;
    }
    if (msg.action?.type === 'nextMatch') {
      const started = (get(game) as any).game;
      matchStartChipLedger = {
        0: started?.chipLedger?.[0] ?? 0,
        1: started?.chipLedger?.[1] ?? 0,
        2: started?.chipLedger?.[2] ?? 0,
      };
    }
    game.setOnlineProtocolState({
      ws,
      revision: msg.revision,
      matchId: msg.matchId,
      roundId: msg.roundId,
    });
  }

  function applyCanonicalSync(ws: WebSocket, snapshot: any): void {
    if (!snapshot?.started || !snapshot.start) return;
    if (!initializeOnlineFromStart(ws, snapshot.start)) {
      ws.send(JSON.stringify({ type: 'resync', expectedVersion: 0 }));
      return;
    }
    if (!snapshot.state || !game.hydrateOnlineProjection(snapshot.state)) {
      ws.send(JSON.stringify({ type: 'resync', expectedVersion: 0 }));
      return;
    }
    const projectedBaseline = snapshot.state?.store?.matchStartChipLedger;
    const baseline = projectedBaseline ? {
      0: Number(projectedBaseline[0] ?? projectedBaseline['0'] ?? 0),
      1: Number(projectedBaseline[1] ?? projectedBaseline['1'] ?? 0),
      2: Number(projectedBaseline[2] ?? projectedBaseline['2'] ?? 0),
    } : {
      0: Number(snapshot.start.chipLedger?.[0] ?? snapshot.start.chipLedger?.['0'] ?? 0),
      1: Number(snapshot.start.chipLedger?.[1] ?? snapshot.start.chipLedger?.['1'] ?? 0),
      2: Number(snapshot.start.chipLedger?.[2] ?? snapshot.start.chipLedger?.['2'] ?? 0),
    };
    game.setOnlineProtocolState({
      ws,
      revision: snapshot.revision,
      matchId: snapshot.matchId,
      roundId: snapshot.roundId,
    });
    matchStartChipLedger = baseline;
  }

  function scheduleOnlineReconnect(): void {
    if (!onlineShouldReconnect || !currentRoomId || !onlineRoomMeta || !onlineMe) return;
    if (onlineReconnectTimer) clearTimeout(onlineReconnectTimer);
    const delay = Math.min(10_000, 500 * (2 ** Math.min(onlineReconnectAttempt, 5)));
    onlineReconnectAttempt += 1;
    onlineReconnectTimer = setTimeout(() => {
      onlineReconnectTimer = null;
      void connectOnlineWs(true);
    }, delay);
  }

  async function connectOnlineWs(_isRetry = false) {
    if (!currentRoomId || !onlineMe || !onlineRoomMeta) return;
    onlineShouldReconnect = true;
    const roomAtConnect = currentRoomId;
    const generation = ++onlineSocketGeneration;
    let token = '';
    let wsBase = '';
    try {
      const response = await fetch('/api/ws-token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: roomAtConnect }),
      });
      if (!response.ok) throw new Error(`ws-token ${response.status}: ${await response.text().catch(() => '')}`);
      const data = (await response.json()) as { token: string; ws_url?: string };
      token = data.token;
      wsBase = data.ws_url ?? '';
    } catch (error) {
      console.error('[anmika] ws-token fetch failed', error);
      if (generation === onlineSocketGeneration) scheduleOnlineReconnect();
      return;
    }
    if (generation !== onlineSocketGeneration || currentRoomId !== roomAtConnect) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const endpoint = wsBase || `${protocol}//${location.host}`;
    const url = `${endpoint.replace(/\/$/, '')}/ws/room/${roomAtConnect}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    onlineWs = ws;
    ws.onopen = () => {
      if (generation !== onlineSocketGeneration) { ws.close(); return; }
      onlineReconnectAttempt = 0;
      if (onlineRoomMeta?.isHost) ws.send(JSON.stringify({ type: 'start', qijia: 0 }));
    };
    ws.onmessage = (event) => {
      if (generation !== onlineSocketGeneration) return;
      let msg: any; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'start') {
        const initialized = initializeOnlineFromStart(ws, msg, {
          revision: msg.revision ?? 0,
          matchId: msg.matchId ?? 1,
          roundId: msg.roundId ?? 1,
        });
        if (!initialized) ws.send(JSON.stringify({ type: 'resync', expectedVersion: 0 }));
      } else if (msg.type === 'sync') {
        applyCanonicalSync(ws, msg.snapshot);
      } else if (msg.type === 'lobby') {
        onlineMembers = msg.members ?? [];
      } else if (msg.type === 'action') {
        applyRevisionedAction(ws, msg);
      } else if (msg.type === 'reject') {
        console.warn('[online] command rejected', msg.reason, msg.commandId);
      }
    };
    ws.onclose = () => {
      if (generation !== onlineSocketGeneration) return;
      onlineWs = null;
      scheduleOnlineReconnect();
    };
    ws.onerror = () => { /* onclose handles retry */ };
  }
  function disconnectOnline() {
    onlineShouldReconnect = false;
    onlineSocketGeneration += 1;
    if (onlineReconnectTimer) clearTimeout(onlineReconnectTimer);
    onlineReconnectTimer = null;
    if (onlineWs) { try { onlineWs.close(); } catch (e) {} onlineWs = null; }
    game.disconnectOnline();
    onlineGameStarted = false;
    onlineRoomMeta = null;
  }
  // 勝利後の選択・サイコロがすべて終わった client だけが safe revision を通知する。
  // Node authority はこの通知を受けてから次局 timeout を開始する。
  $: {
    const protocolState = game.getOnlineProtocolState();
    const safeForNextRound = onlineGameStarted
      && !!onlineWs
      && onlineWs.readyState === WebSocket.OPEN
      && $game.roundEnded
      && !$game.game.state.finished
      && !$game.awaitingRonDecision
      && !$game.awaitingFulou
      && !$game.pendingFuyu
      && !$game.pendingKinpei
      && !$game.pendingKamiPochi
      && !$game.pendingPochiSwap
      && !$game.pendingFeverContinue
      && !$game.pendingSaiKoro
      && !$game.pendingQianggang;
    const authorized = !!onlineRoomMeta?.isHost
      || ($game.lastWinner !== null && onlineRoomMeta?.mySeat === $game.lastWinner);
    const key = `${onlineSocketGeneration}:${protocolState.revision}`;
    if (safeForNextRound && authorized && key !== lastReadyNextRoundKey) {
      lastReadyNextRoundKey = key;
      onlineWs?.send(JSON.stringify({ type: 'readyNextRound', revision: protocolState.revision }));
    }
  }
  onMount(async () => {
    // 起動時 single モードの初期化 [P1/P2 CPU on、 revealAll off、 self=0]
    if (viewMode === 'single') {
      revealAll = false;
      selfPlayer = 0;
      if (!$game.cpu[1]) game.toggleCpu(1);
      if (!$game.cpu[2]) game.toggleCpu(2);
      if ($game.cpu[0]) game.toggleCpu(0);
    }
    // ?room= 指定時 オンライン部屋に直入り [test / share link 用]
    try {
      const params = new URLSearchParams(window.location.search);
      const rid = params.get('room');
      if (rid) {
        const r = await fetch(`/api/me`, { credentials: 'include' });
        if (r.ok) {
          onlineMe = await r.json();
          const joined = await fetch(`/api/rooms/${encodeURIComponent(rid)}/join`, {
            method: 'POST',
            credentials: 'include',
          });
          if (joined.ok) {
            currentRoomId = rid;
            appMode = 'started';
            viewMode = 'online';
          }
        }
      }
    } catch (e) {}
  });
  function toggleViewMode() {
    viewMode = viewMode === 'dev' ? 'single' : 'dev';
    // single モードでは他家手牌 隠す、 dev モードでは default 全公開
    if (viewMode === 'single') {
      revealAll = false;
      selfPlayer = 0;
      // 一人回しモード: P1 / P2 を強制 CPU [自家 P0 のみ手動]
      if (!$game.cpu[1]) game.toggleCpu(1);
      if (!$game.cpu[2]) game.toggleCpu(2);
      // P0 が CPU だった場合は OFF に [自分で打つ]
      if ($game.cpu[0]) game.toggleCpu(0);
    } else { revealAll = true; }
  }
  function toggleRevealAll() { revealAll = !revealAll; }

  // reset 後 solo mode 維持 [リョー指示 2026-05-12 fix: 次の試合へ 後 CPU が動かなくなる bug]
  // R13 P0 #1 fix: online 中は CPU 復元 走らせない、 viewMode='single' は online でも
  // セットされるが オンラインの cpuSeats は initOnlineGame / nextMatch action 経由で
  // 維持される。 一人回しの強制 CPU 化は !onlineGameStarted のみ
  let resetCheckLastFinished = false;
  $: if (viewMode === 'single' && !onlineGameStarted && resetCheckLastFinished && !state.finished) {
    // 試合 reset 直後 [前回 finished だったが今 false に切替]
    if (!$game.cpu[1]) game.toggleCpu(1);
    if (!$game.cpu[2]) game.toggleCpu(2);
    if ($game.cpu[0]) game.toggleCpu(0);
  }
  $: resetCheckLastFinished = state.finished;

  // debug / e2e: window.__game に state expose [F12 console / Playwright snapshot]
  // R14 P0 #5 fix: 対戦製品としての公平性のため、 オンライン対戦中は expose 禁止。
  // single mode [身内戦 / 一人回し] は維持、 online は他家手牌が見えるのを防ぐ。
  // Playwright [navigator.webdriver] は online でも expose 維持 [test 用]。
  const __isPlaywright = typeof navigator !== 'undefined' && (navigator as any).webdriver === true;
  $: __EXPOSE_GLOBALS = !onlineGameStarted || __isPlaywright;
  $: if (typeof window !== 'undefined') {
    if (__EXPOSE_GLOBALS) {
      (window as any).__game = $game;
      (window as any).__gameStore = game;
      (window as any).__setSaiKoroOpened = (v: boolean) => { saiKoroOpened = v; };
    } else {
      try { delete (window as any).__game; } catch { (window as any).__game = undefined; }
      try { delete (window as any).__gameStore; } catch { (window as any).__gameStore = undefined; }
      try { delete (window as any).__setSaiKoroOpened; } catch { (window as any).__setSaiKoroOpened = undefined; }
    }
  }

  // body class + #app に inline style 直接当てる [bulletproof、 CSS 効かない環境保険]
  $: if (typeof document !== 'undefined') {
    document.body.classList.toggle('solo-mode', viewMode === 'single');
    const appEl = document.getElementById('app');
    if (appEl) {
      if (viewMode === 'single') {
        appEl.style.width = '100vw';
        appEl.style.maxWidth = 'none';
        appEl.style.borderInline = '0';
        appEl.style.marginLeft = '0';
        appEl.style.marginRight = '0';
      } else {
        appEl.style.width = '';
        appEl.style.maxWidth = '';
        appEl.style.borderInline = '';
        appEl.style.marginLeft = '';
        appEl.style.marginRight = '';
      }
    }
  }

  // ツモ切り auto モード [リョー指示 2026-05-12 checkbox 化]
  let autoTsumoKiri = false;
  function readAutoTsumokiriToken(): AutoTsumokiriToken | null {
    const snap = get(game);
    const player = snap.game.lunbanToPlayerId(snap.game.state.lunban);
    const phaseReady = viewMode === 'single'
      && !onlineGameStarted
      && !snap.roundEnded
      && !snap.awaitingRonDecision
      && !snap.awaitingFulou
      && !snap.pendingFuyu
      && !snap.pendingKinpei
      && !snap.pendingKamiPochi
      && !snap.pendingPochiSwap
      && !snap.pendingSaiKoro
      && !snap.pendingFeverContinue
      && !snap.lizhiPending
      && player === selfPlayer
      && !!snap.lastZimo
      && !snap.game.canTsumo(player);
    const enabled = autoTsumoKiri || snap.game.lizhi.has(player);
    if (!phaseReady || !enabled) return null;
    const stateNow = snap.game.state;
    const revision = [
      stateNow.changbang,
      stateNow.jushu,
      stateNow.benbang,
      stateNow.lunban,
      snap.game.events?.length ?? 0,
      snap.lastZimo,
    ].join(':');
    return { player, revision };
  }
  const autoTsumokiriScheduler = createAutoTsumokiriScheduler({
    delayMs: 600,
    readCurrent: readAutoTsumokiriToken,
    fire: (expectedPlayer) => game.tsumokiri(expectedPlayer),
  });
  onDestroy(() => autoTsumokiriScheduler.cancel());
  // 次の試合へ時 chip リセット option [リョー指示、 default 持越し]
  let resetChipOnNextMatch = false;
  let __matchPostInflight = false;
  // R16 P0 #3 fix: 試合開始時 chipLedger snapshot、 chip_delta = total - this[seat] で計算
  let matchStartChipLedger: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
  // R17 #2 fix: POST 成功済 match_no を 記録、 再押下時 重複 POST せず nextMatch のみ実行
  let __lastPostedMatch: { roomId: string; matchNo: number } | null = null;
  async function handleNextMatch() {
    // R15 P0 #5 fix: 順序を 「1. resetChip 確認 → 2. POST [host のみ、 finalize 後最終 chip 反映]
    //   → 3. nextMatch 実行」 に。 旧 code は POST が finalize 前 + await ナシで連打可能、
    //   ダブルクリックで二重 INSERT、 resetChip キャンセル後も POST 済 になってた
    if (resetChipOnNextMatch) {
      if (!window.confirm('チップを 0 にリセットして次の試合へ進みます。 本当に？')) return;
    }
    // R17 #2 + R18 #3 fix: 直前 試合 [room_id + match_no] の POST が済んでれば 二重 POST 回避。
    // events.length 依存は偶然一致 / リロードで baseline 失う問題があったので、
    // server レスポンスの match_no を baseline + sessionStorage で persist
    // 「同 room の 「次の match_no が 既存最大+1 と一致」 の前提」 で 重複判定
    // R19 #2 fix: 重複判定は 「server 409 catch で idempotency 扱い」 に統一、
    // client side baseline は撤回 [リロードで失う + events.length 偶然一致 不安定]
    // server 側 room+match_no UNIQUE で 二重 INSERT は防がれる、 409 は ack 扱い
    const sessionPostKey = `anmikaPostedMatch:${currentRoomId}`;
    const alreadyPosted = false;  // 常に POST 試行、 二重は server 409 で catch して ack に
    // R14 P1 #4 + R15 P0 #5 + P1 [CPU 全 member 必須] fix
    if (
      !__matchPostInflight
      && !alreadyPosted
      && onlineGameStarted && onlineRoomMeta?.isHost
      && currentRoomId && $game.game.state.finished
      && !resetChipOnNextMatch  // chip reset 時は match 永続化スキップ
    ) {
      __matchPostInflight = true;
      try {
        // finalScore [chipBase + uma + topN + tontonbu] を計算 → 全 user_id 分の delta
        let finalScores: Array<{ player: number; total: number }> = [];
        try {
          finalScores = ($game.game as any).getFinalScore() ?? [];
        } catch {}
        const chipDelta: Record<string, number> = {};
        for (const m of onlineMembers) {
          if (!m.user_id) continue;
          const seat = m.seat;
          if (seat !== 0 && seat !== 1 && seat !== 2) {
            chipDelta[m.user_id] = 0;
            continue;
          }
          const fs = finalScores.find((s) => s.player === seat);
          // R15 P1 fix: server は CPU 含む全 member chip_delta key 必須、
          // CPU は user_id "CPU_..." で 0 を必ず送る
          // R16 P0 #3 fix: total は累積値、 「今試合差分」 = total - matchStartChipLedger[seat]
          // を送って server で users.chip_total に正しく加算する [二重加算防止]
          const total = fs?.total ?? 0;
          chipDelta[m.user_id] = total - (matchStartChipLedger[seat] ?? 0);
        }
        const paifu = ($game.game.events ?? []).slice(0, 5000);
        // R20 #1 fix: deterministic match_uuid を client/server で 共有、 リトライ重複保存 防止。
        // sessionStorage に persist [リロード後も 同 uuid で再 POST]、
        // server で room_id+match_uuid UNIQUE で 二重保存 reject [409]
        const uuidKey = `anmikaMatchUuid:${currentRoomId}`;
        let matchUuid: string;
        try {
          const stored: string | null = sessionStorage.getItem(uuidKey);
          let v: string;
          if (stored) {
            v = stored;
          } else {
            v = ((crypto as any).randomUUID?.() as string | undefined) ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            sessionStorage.setItem(uuidKey, v);
          }
          matchUuid = v;
        } catch {
          matchUuid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }
        const r = await fetch('/api/matches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ room_id: currentRoomId, paifu, chip_delta: chipDelta, match_uuid: matchUuid }),
        });
        if (!r.ok) {
          const detail = await r.text().catch(() => '');
          // R19 #2 fix: 409 は idempotency ヒット [既に同 match_no 保存済] = ack 扱い、
          // game.nextMatch 進める。 リロード後の再 POST もこれで安全
          if (r.status === 409) {
            // R23 #4 fix: server 409 typed response [reason: 'idempotency_hit'] を 利用、
            // detail JSON parse して reason 別 toast、 match_no race vs uuid 重複を区別
            let typed: any = null;
            try { typed = JSON.parse(detail); } catch {}
            const reason = typed?.detail?.reason ?? typed?.reason ?? 'unknown';
            const mno = typed?.detail?.match_no ?? typed?.match_no;
            console.info('[matches POST] 409 typed', { reason, match_no: mno });
            if (reason !== 'idempotency_hit' && reason !== 'unknown') {
              console.warn('[matches POST] 409 unexpected reason', reason, detail);
            }
          } else {
            // R16 P0 #4 fix: POST 失敗時 nextMatch 進行を ブロック、 user に通知 + 再試行可能
            console.warn('[matches POST] failed', r.status, detail);
            window.alert(`試合結果の保存に失敗 [HTTP ${r.status}]、 「次の試合へ」 を 再度押してリトライ。 ${detail.slice(0, 200)}`);
            __matchPostInflight = false;
            return;  // game.nextMatch せず 中断
          }
        }
        // R20 #1 fix: POST 成功 [or 409 ack] → 現 match_uuid は使用済 → 削除、
        // 次試合 nextMatch で 新 uuid 自動生成 [server 採番と整合]
        try {
          const respJson = await r.json().catch(() => ({}));
          const mno = Number(respJson?.match_no ?? 0);
          __lastPostedMatch = { roomId: currentRoomId, matchNo: mno };
          try { sessionStorage.setItem(sessionPostKey, String(mno)); } catch {}
          try { sessionStorage.removeItem(uuidKey); } catch {}
        } catch {}
      } catch (e) {
        // R16 P0 #4 fix: ネットワーク error も同様 ブロック
        console.warn('[matches POST] err', e);
        window.alert(`試合結果の保存中ネットワークエラー、 「次の試合へ」 再押下でリトライ ${String(e).slice(0, 200)}`);
        __matchPostInflight = false;
        return;
      } finally {
        __matchPostInflight = false;
      }
    }
    if (resetChipOnNextMatch) {
      // chip reset case: broadcast & finalize=false [skip getFinalScore writeback]
      game.nextMatch({ finalize: false, resetChip: true });
    } else {
      // 半荘終了時は finalScore を chipLedger に書き戻し、 次試合に最終精算を持ち越す
      // online: WS broadcast → 全 client で同期 reset
      game.nextMatch({ finalize: true, resetChip: false });
    }
    // reset 後 直接 CPU set [reactive 待ちだと race condition 起きうる]
    // R13 P0 #1 fix: online 中は CPU 復元 触らない、 cpuSeats は nextMatch action で同期済
    setTimeout(() => {
      if (viewMode === 'single' && !onlineGameStarted) {
        if (!$game.cpu[1]) game.toggleCpu(1);
        if (!$game.cpu[2]) game.toggleCpu(2);
        if ($game.cpu[0]) game.toggleCpu(0);
      }
      // R16 P0 #3 + R18 #5 fix: single mode のみ ここで snap、
      // online は WS の new start [synthetic start] 受信時 onmessage 内で snap される [server echo 後]、
      // ここで 50ms タイマーは race [実際の reset は server echo 後] になるので skip
      if (!onlineGameStarted) {
        const sg = (get(game) as any).game;
        matchStartChipLedger = { 0: sg?.chipLedger?.[0] ?? 0, 1: sg?.chipLedger?.[1] ?? 0, 2: sg?.chipLedger?.[2] ?? 0 };
      }
    }, 50);
  }

  // CPU 打牌 ラグ モード [リョー指示 2026-05-12]
  let cpuSlowMode = false; // true: 2-3 秒ラグ / false: 即打 [リョー指示 2026-05-12 default off]
  // SaiKoroModal を 「サイコロへ」 button click で開く [リョー指示 2026-05-12]
  let saiKoroOpened = false;
  $: if (!$game.pendingSaiKoro) saiKoroOpened = false;
  // 2026-05-15 [bug A] fix: 自家 [selfPlayer] が現 chance の owner なら 自動で modal を開く。
  //   旧仕様 [button click で開く] は saiKoroOpened false のまま 別 path で進めようとして
  //   「サイコロが skip された」 と誤解される report 続発、 強制 open に変更。
  $: {
    const _ps = $game.pendingSaiKoro;
    if (_ps) {
      const _cur = _ps.chances[_ps.currentIdx] as any;
      const _owner = (_cur?.winner ?? _ps.winner);
      if (_owner === selfPlayer) saiKoroOpened = true;
    }
  }
  $: feverInProgress = ([0, 1, 2] as const).some((p) => $game.game.feverActive[p]);
  // フィーバー中は最低800msの間を空けて1巡ずつ見せる
  $: cpuDelayMs = cpuSlowMode ? 2500 : feverInProgress ? 800 : 0;

  // R15 P1 #30 + R16 P0 #8 fix: CPU が saiKoro chance owner なら 駆動側 [single mode 誰でも、
  // online は host のみ] が 自動 advance、 chain 詰まりで online 卓停止を防ぐ。
  // R16 fix: 旧 code は window.__game 参照、 R15 P0 #5 で online 中 expose 削除済 → prod fail。
  // svelte $game store を 直接 参照する path に変更 [getStoreValue 経由 同期取得]
  let __cpuSaiKoroLatch = false;
  $: {
    const ps = $game.pendingSaiKoro;
    if (ps && !__cpuSaiKoroLatch) {
      const cur = ps.chances[ps.currentIdx] as any;
      const owner = ((cur?.winner ?? ps.winner) as 0|1|2);
      const isOwnerCpu = !!$game.cpu[owner];
      // Online CPU post-win decisions are owned by the Node authority so one
      // server timer, not a host browser timer, advances them.
      const canDrive = !onlineGameStarted;
      // 2026-07-16 リョー指示: CPU 和了のサイコロは人間の確認 [ackCpuWin] まで開始しない。
      // cutin 再生中も待つ [遷移を視認してから動く]
      if (isOwnerCpu && canDrive && $game.cpuWinAck && !$game.cutin) {
        __cpuSaiKoroLatch = true;
        // 2026-05-15 [bug A] fix: CPU 駆動が 200ms × 3 で finalize → close まで走り、
        //   ユーザーが modal を視認できないまま 「サイコロが skip された」 と誤解する。
        //   各 step に 視認できる遅延 [combo 800 / roll 1500 / advance 1500] を入れて、
        //   さらに roll 段階は dicebox 物理アニメ完了後に発火するため modal が開いてから
        //   実際のロール開始まで待つ。
        const ps0 = ps as any;
        // [2026-05-15 bug 10 fix] CPU saikoro 体感 skip 抑制で 各 step 延長:
        // combo 800→1500ms / roll 1500→2500ms / advance 1500→2000ms
        // [dicebox 物理アニメ + 結果視認 + 次 chance 移行 を 確実に見せる]
        const stepDelay = !ps0.selectedCombo ? 1500 : (!ps0.finalized ? 2500 : 2000);
        setTimeout(() => {
          __cpuSaiKoroLatch = false;
          // R16 P0 #8 fix: window.__game 不依存、 store snapshot を 直接 取得
          const snap = get(game) as any;
          const ps2 = snap?.pendingSaiKoro;
          if (!ps2) return;
          const cur2 = ps2.chances[ps2.currentIdx];
          const owner2 = ((cur2?.winner ?? ps2.winner) as 0|1|2);
          if (!snap.cpu[owner2]) return;  // owner 変更で停止
          if (!ps2.selectedCombo) {
            game.selectSaiKoroCombo(1, 6);
          } else if (!ps2.finalized) {
            // R17 #4 fix: 1-6 等確率、 ゾロ目も許容 [CPU もゾロ目ボーナス引ける、 公平]
            const d1 = 1 + Math.floor(Math.random() * 6);
            const d2 = 1 + Math.floor(Math.random() * 6);
            game.rollSaiKoroDice([d1, d2]);
          } else {
            game.advanceSaiKoro();
          }
        }, stepDelay);
      }
    }
  }

  // 一人回しモード 自動 CPU 進行: P0 dapai 後 / 局終了以外 で 現家が P1/P2 [CPU] なら自動 cpuStep
  // [P0 zimo 待ち or modal 待ち or 副露候補 待ち で停止]
  // ※ オンライン時は host CPU driver に任せる、 各 client が独立 cpuStep 呼ぶと WS で連発 send になる
  // 2026-05-14 fix: reactive 反復で同一手番に対して複数 setTimeout が積まれる不具合を防ぐ、
  // jushu + lunban の合成 key で dedupe
  let lastCpuStepKey: string | null = null;
  $: {
    const cur = $game.game.lunbanToPlayerId($game.game.state.lunban);
    const key = `${state.jushu}-${state.lunban}`;
    // [2026-07-16 リョー指示: 演出同期] cutin 再生中は CPU を進めない。
    // 再生終了で canStep が立ち直った時に同一手番でも再発火できるよう latch を解除する
    const cutinBusy = !!$game.cutin || (($game.cutinQueue?.length ?? 0) > 0);
    const canStep = !onlineGameStarted && viewMode === 'single' && !$game.roundEnded
      && !$game.awaitingRonDecision && !$game.awaitingFulou
      && !$game.pendingFuyu && !$game.pendingKinpei && !$game.pendingKamiPochi && !$game.pendingPochiSwap && !$game.pendingSaiKoro && !$game.pendingFeverContinue
      && !cutinBusy
      && cur !== 0 && $game.cpu[cur];
    if (canStep && lastCpuStepKey !== key) {
      lastCpuStepKey = key;
      setTimeout(() => game.cpuStep(), cpuDelayMs);
    } else if (!canStep && (cur === 0 || $game.roundEnded || cutinBusy)) {
      lastCpuStepKey = null;
    }
  }
  // CPU ツモ和了のみ 自動遷移 [3 秒、 リョー指示 2026-05-12]、 CPU ロンは P0 に
  // 見せる必要あるので user click 待ち
  // R13 P0 #1 fix: online 中の auto nextRound は host CPU driver の責務、 各 client が
  // 独立 fire すると 同 action 重複 send で desync する
  let cpuAutoAdvanceFired = false;
  $: if (viewMode === 'single' && !onlineGameStarted && $game.roundEnded && $game.lastWinner !== null
        && $game.cpu[$game.lastWinner as PlayerId] && !state.finished
        && !$game.pendingKinpei && !$game.pendingFuyu && !$game.pendingKamiPochi && !$game.pendingPochiSwap && !$game.pendingSaiKoro
        && !$game.lastDapai  // ron 時は lastDapai が残ってる、 tsumo のみ
        && !cpuAutoAdvanceFired) {
    cpuAutoAdvanceFired = true;
    setTimeout(() => {
      if ($game.roundEnded && !state.finished) {
        game.nextRound();
      }
      cpuAutoAdvanceFired = false;
    }, 3000);
  }
  $: if (!$game.roundEnded) cpuAutoAdvanceFired = false;

  // WSA-A8: checkbox 自動とリーチ強制を同じキャンセル可能 scheduler に統合。
  // 発火時にも player・phase・局面 revision を readAutoTsumokiriToken で再検証する。
  $: {
    // 依存を明示し、Svelte が phase 変化ごとに予約を更新できるようにする。
    void viewMode; void onlineGameStarted; void autoTsumoKiri; void selfPlayer;
    void state.lunban; void state.jushu; void state.changbang; void state.benbang;
    void $game.roundEnded; void $game.awaitingRonDecision; void $game.awaitingFulou;
    void $game.pendingFuyu; void $game.pendingKinpei; void $game.pendingKamiPochi; void $game.pendingPochiSwap; void $game.pendingSaiKoro;
    void $game.pendingFeverContinue; void $game.lizhiPending; void $game.lastZimo;
    void $game.game.events.length; void canTsumo;
    const token = readAutoTsumokiriToken();
    if (token) autoTsumokiriScheduler.schedule(token);
    else autoTsumokiriScheduler.cancel();
  }
</script>

{#if appMode === 'menu'}
  <EntryMenu
    onSelectSolo={() => { appMode = 'started'; viewMode = 'single'; }}
    onSelectOnline={() => { appMode = 'started'; viewMode = 'online'; }}
  />
{:else if viewMode === 'online' && !onlineGameStarted}
  {#if currentRoomId && onlineMe}
    <RoomPanel
      roomId={currentRoomId}
      me={onlineMe}
      onLeave={() => { disconnectOnline(); currentRoomId = null; }}
      onStart={async () => {
        try {
          const r = await fetch(`/api/rooms/${currentRoomId}`, { credentials: 'include' });
          if (r.ok) {
            const data = await r.json();
            const mySeatMember = data.members.find((m: any) => m.user_id === onlineMe!.user_id);
            onlineRoomMeta = {
              isHost: data.room.host_user_id === onlineMe!.user_id,
              hostUserId: data.room.host_user_id,
              mySeat: mySeatMember?.seat ?? 0,
            };
            (window as any).__anmikaIsHost = onlineRoomMeta.isHost;
            connectOnlineWs();
          }
        } catch (e) {}
      }}
    />
  {:else}
    <LobbyPanel onJoinRoom={(rid, user) => { currentRoomId = rid; onlineMe = user; }} />
  {/if}
  <div class="online-back-wrap">
    <button class="mode-toggle" on:click={() => { viewMode = 'single'; disconnectOnline(); currentRoomId = null; onlineMe = null; }}>← オフラインに戻る</button>
  </div>
{:else}
<main class:mode-single={viewMode === 'single' || (viewMode === 'online' && onlineGameStarted)}>
  <div class="orientation-notice" role="status">
    <strong>端末を横向きにしてください</strong>
    <span>対局画面は横向きで全体を確認できます</span>
  </div>
  <header>
    <h1>アンミカ三麻 [{onlineGameStarted ? `オンライン [部屋 ${currentRoomId}]` : (viewMode === 'single' ? '一人回しモード' : 'phase 1 dev')}]
      <button class="mode-toggle" on:click={() => { appMode = 'menu'; viewMode = 'single'; disconnectOnline(); currentRoomId = null; onlineMe = null; }}>
        🏠 メニューに戻る
      </button>
      {#if !onlineGameStarted}
        <button class="mode-toggle online-btn" on:click={() => { viewMode = 'online'; }}>
          🌐 オンライン対戦
        </button>
      {/if}
      {#if viewMode === 'single' && !onlineGameStarted}
        <button class="mode-toggle" on:click={toggleRevealAll}>
          {revealAll ? '🙈 他家手牌を隠す' : '👁️ 他家手牌を開く'}
        </button>
        <label class="cpu-speed-toggle">
          <input type="checkbox" bind:checked={cpuSlowMode}>
          ⏱️ CPU 2.5 秒ラグ
        </label>
      {/if}
    </h1>
    <HeaderInfo
      changbang={state.changbang}
      jushu={state.jushu}
      benbang={state.benbang}
      lizhibang={state.lizhibang}
      paishu={paishu}
      baopai={baopai}
      dora={baopai.map(doraFrom)}
      currentPlayer={currentPlayer}
      lastZimo={lastZimo}
    />
    <div class="defen">
      {#each PLAYERS as p}
        <PlayerStatus
          player={p}
          isCurrent={currentPlayer === p}
          zifengZ={$game.game.zifengZ(p)}
          defen={state.defen[p]}
          xiangting={$game.game.xiangting(p)}
          dora={[dora0, dora1, dora2][p]}
          lizhi={$game.game.lizhi.has(p)}
          openLizhi={$game.game.openLizhi.has(p)}
          tingpai={$game.game.getTingpaiList(p as 0 | 1 | 2)}
          nukidora={$game.game.nukidora[p]}
          nukidoraGold={$game.game.nukidoraGold[p] ?? 0}
          chip={$game.game.chipLedger[p]}
        />
      {/each}
    </div>
    <!-- 2026-05-14 ゆーま 自走 bug fix: 進行 row は debug 寄り、 オンライン中は
         ツモ切り / 自動 / CPU button が 他人手番でも代理 action になるので非表示。
         CPU toggle は local 状態 [single mode 用]、 単独表示にする -->
    {#if !onlineGameStarted}
      <div class="action-row">
        <span class="row-label">進行:</span>
        <button on:click={() => game.tsumokiri()} disabled={progressControlsBlocked}>ツモ切り</button>
        <button on:click={() => game.autoAdvance()} disabled={progressControlsBlocked}>⏩ 自動</button>
        <button on:click={() => game.cpuStep()} disabled={progressControlsBlocked}>🤖 CPU</button>
        <span class="cpu-toggles">
          CPU:
          {#each PLAYERS as p}
            <label><input type="checkbox" checked={$game.cpu[p]} on:change={() => game.toggleCpu(p)}>p{p}</label>
          {/each}
        </span>
      </div>
    {/if}
    <!-- 2026-05-14 codex review #3 fix: フィーバー継続 button は winner client のみ表示 -->
    {#if $game.game.canDeclareLateShuvari(selfPlayer as 0 | 1 | 2) && (!onlineGameStarted || selfPlayer === onlineRoomMeta?.mySeat)}
      <button class="lizhi-btn shuvari" on:click={() => game.shuvari(selfPlayer)}>シュバ追加宣言</button>
    {/if}
    {#if $game.pendingFeverContinue && !$game.pendingSaiKoro && (!onlineGameStarted || $game.pendingFeverContinue.winner === selfPlayer)}
      <div class="action-row hot">
        <span class="row-label">🔥 フィーバー継続:</span>
        <button class="next-btn" on:click={() => game.continueFever()}>▶ 続行</button>
      </div>
    {/if}
    <!-- 2026-05-14 ゆーま 自走 bug fix: online で他人の手番に 私の旧 toolbar ツモ button
         が出て 代理ツモ宣言 できてた、 currentPlayer === selfPlayer gate 追加 -->
    {#if canTsumo && !$game.roundEnded && !$game.awaitingRonDecision && !$game.awaitingFulou && !$game.pendingSaiKoro && !$game.pendingFeverContinue && !$game.pendingFuyu && !$game.pendingKinpei && !$game.lastDapai && (!onlineGameStarted || currentPlayer === selfPlayer)}
      <div class="action-row hot">
        <span class="row-label">アガリ:</span>
        <button class="tsumo-btn" on:click={() => game.tsumo()}>🎉 ツモ宣言</button>
        {#if $game.game.lizhi.has(currentPlayer) && $game.game.shoupai.get(currentPlayer)?._zimo === 'z5' && $game.game.getKanCandidates(currentPlayer).some((m: string) => m.startsWith('z5'))}
          <button class="kan-btn" on:click={() => game.declareKan('z5z5z5z5')}>🤍 白暗カン</button>
        {/if}
      </div>
    {/if}
    {#if !$game.roundEnded && !$game.awaitingRonDecision && !$game.awaitingFulou && !$game.pendingFeverContinue && !$game.pendingFuyu && !$game.pendingKinpei && $game.game.canLizhi(currentPlayer) && (!onlineGameStarted || currentPlayer === selfPlayer)}
      {@const lp = ($game as any).lizhiPendingFlags ?? null}
      {@const lpActive = $game.lizhiPending === currentPlayer && lp}
      <div class="action-row">
        <span class="row-label">リーチ:</span>
        <button class="lizhi-btn" class:active={lpActive && !lp.shuvari && !lp.fever && !lp.open} on:click={() => game.lizhi()}>通常</button>
        {#if !$game.game.shuvariUsed[currentPlayer]}
          <button class="lizhi-btn shuvari" class:active={lpActive && lp.shuvari && !lp.fever && !lp.open} on:click={() => game.lizhi({shuvari:true})}>シュバ</button>
        {/if}
        {#if feverAvailable}
          <button class="lizhi-btn fever" class:active={lpActive && lp.fever && !lp.shuvari} on:click={() => game.lizhi({fever:true})}>フィバ</button>
          {#if !$game.game.shuvariUsed[currentPlayer]}
            <button class="lizhi-btn shuvari-fever" class:active={lpActive && lp.fever && lp.shuvari} on:click={() => game.lizhi({shuvari:true,fever:true})}>シュバフィバ</button>
          {/if}
          {#if feverIsConditional}
            <span class="fever-cond-hint">[{feverDapaiTiles.join('/')} 切れば fever、 他は通常リーチ]</span>
          {/if}
        {/if}
        <button class="lizhi-btn open" class:active={lpActive && lp.open && !lp.shuvari} on:click={() => game.lizhi({open:true})}>オープン</button>
        {#if !$game.game.shuvariUsed[currentPlayer]}
          <button class="lizhi-btn shuvari-open" class:active={lpActive && lp.open && lp.shuvari} on:click={() => game.lizhi({shuvari:true, open:true})}>シュバオープン</button>
        {/if}
      </div>
    {/if}
    <!-- 2026-05-14 ゆーま 自走 bug fix: online で 他人手番の 北抜き / カン button が
         出てしまい 代理 action 可能だった、 currentPlayer === selfPlayer gate 追加 -->
    {#if (!onlineGameStarted || currentPlayer === selfPlayer) && !$game.roundEnded && !$game.awaitingRonDecision && (
      $game.game.canNukiBei(currentPlayer) ||
      ($game.game.getKanCandidates(currentPlayer).length > 0 && !$game.awaitingFulou)
    )}
      <div class="action-row">
        <span class="row-label">宣言:</span>
        {#if $game.game.canNukiBei(currentPlayer)}
          <button on:click={() => game.nukiBei()}>北抜き</button>
        {/if}
        {#if !$game.awaitingFulou}
          {#each $game.game.getKanCandidates(currentPlayer) as km}
            <button class="kan-btn" on:click={() => game.declareKan(km)}>カン [{km}]</button>
          {/each}
        {/if}
      </div>
    {/if}
    {#if $game.awaitingRonDecision && !$game.pendingFeverContinue && !$game.pendingFuyu && !$game.pendingKinpei}
      <div class="action-row hot">
        <span class="row-label alert">⚠ {$game.message}</span>
        {#each ronCandidates.filter((p) => p === selfPlayer) as p}
          <button class="ron-btn" on:click={() => game.ron(p)}>p{p} ロン{$game.game.shuvariActive[p as PlayerId] ? ' [必須]' : ''}</button>
        {/each}
        {#if !ronCandidates.some((p) => $game.game.shuvariActive[p as PlayerId]) && (!onlineGameStarted || ronCandidates.includes(selfPlayer))}
          <button on:click={() => game.pass()}>見送る</button>
        {/if}
      </div>
    {/if}
    {#if $game.awaitingFulou}
      <div class="action-row hot">
        <span class="row-label alert">⚠ {$game.message}</span>
        {#each $game.ponCandidates.filter((c) => c.player === selfPlayer) as cand}
          {#each cand.mianzi as m}
            <button class="pon-btn" on:click={() => game.pon(cand.player, m)}>p{cand.player} ポン [{m}]</button>
          {/each}
        {/each}
        {#each $game.kanCandidates.filter((c) => c.player === selfPlayer) as cand}
          {#each cand.mianzi as m}
            <button class="kan-btn" on:click={() => game.damingang(cand.player, m)}>p{cand.player} 大明槓 [{m}]</button>
          {/each}
        {/each}
        {#if !onlineGameStarted || $game.ponCandidates.some((c) => c.player === selfPlayer) || $game.kanCandidates.some((c) => c.player === selfPlayer)}
          <button on:click={() => game.pass()}>見送る</button>
        {/if}
      </div>
    {/if}
    {#if $game.message && !$game.awaitingRonDecision && !$game.awaitingFulou}
      <div class="action-row"><span class="alert">{$game.message}</span></div>
    {/if}
    {#if $game.lastHuleResult?.chipBreakdown?.length > 0 && viewMode !== 'single'}
      <ChipBreakdown breakdown={$game.lastHuleResult.chipBreakdown} total={$game.lastHuleResult.chipTotal ?? 0} />
    {/if}
    <!-- 2026-05-14 codex review #3 fix: online で 自家 [selfPlayer] のみ表示、
         他家のぽっち色 [非公開情報] 漏洩防止 -->
    {#if pochiReveal && (!onlineGameStarted || pochiReveal.player === selfPlayer)}
      <PochiRevealModal player={pochiReveal.player} color={pochiReveal.color} isCpu={pochiReveal.isCpu} onClose={closePochiReveal} />
    {/if}
    <!-- 2026-05-14 ゆーま 自走 bug fix: FuyuModal も winner client のみ表示、
         非 winner が誤クリックで selectFuyu broadcast するのを防ぐ -->
    {#if $game.pendingFuyu && (!onlineGameStarted || ($game.pendingFuyu.decisionOwners ?? [$game.pendingFuyu.winner]).includes(selfPlayer))}
      {@const tingW = $game.game.feverDeclareTing?.[$game.pendingFuyu.winner as 0|1|2] ?? $game.game.getTingpaiList($game.pendingFuyu.winner as 0|1|2)}
      {@const remainW = fuyuWaitRemain($game.pendingFuyu.winner as PlayerId, tingW)}
      <FuyuModal
        winner={$game.pendingFuyu.winner}
        waitRemain={remainW}
        shanRemain={paishu}
        onSelect={(use) => game.selectFuyu(use)}
      />
    {/if}
    <!-- 2026-05-14 ゆーま 自走 bug fix: online で winner != selfPlayer の client にも
         modal が出てて 誤クリックで他人の金北選択を送れた、 winner のみ表示に gate -->
    {#if $game.pendingKinpei && viewMode !== 'single' && (!onlineGameStarted || ($game.pendingKinpei.decisionOwners ?? [$game.pendingKinpei.winner]).includes(selfPlayer))}
      <KinpeiModal winner={$game.pendingKinpei.winner} huapai={$game.pendingKinpei.availableHuapai ?? $game.game.effectiveHuapaiAtHule($game.pendingKinpei.winner as PlayerId)} onSelect={(t) => game.selectKinpei(t)} allowHold={$game.game.feverActive[$game.pendingKinpei.winner as PlayerId]} />
    {/if}
    {#if $game.pendingKamiPochi && (!onlineGameStarted || $game.pendingKamiPochi.decisionOwners.includes(selfPlayer))}
      <div class="pochi-choice-backdrop" role="presentation">
        <dialog open class="pochi-choice-modal" aria-label="神ぽっちの牌選択">
          <h2>神ぽっち</h2>
          <p>
            P{$game.pendingKamiPochi.winner}・{$game.pendingKamiPochi.context === 'fuyu' ? `冬 ${$game.pendingKamiPochi.tier === 'lower' ? '下段' : '上段'}` : 'ドラ表示'}
            の正ぽっちを取る牌を選択
          </p>
          <div class="pochi-choice-grid">
            {#each $game.pendingKamiPochi.candidates as pai}
              <button type="button" class="pochi-choice-tile" aria-label={`${pai} に取る`} on:click={() => game.selectKamiPochi(pai, $game.pendingKamiPochi?.occurrenceKey)}>
                <Tile {pai} size="md" />
              </button>
            {/each}
          </div>
        </dialog>
      </div>
    {/if}
    {#if $game.pendingPochiSwap && (!onlineGameStarted || $game.pendingPochiSwap.decisionOwners.includes(selfPlayer))}
      <div class="pochi-choice-backdrop" role="presentation">
        <dialog open class="pochi-choice-modal" aria-label="ぽっちの高目選択">
          <h2>{$game.pendingPochiSwap.kind === 'deka' ? 'でかぽっち' : '白ぽっち'} 高目選択</h2>
          <p>祝儀期待値が同率の候補から選択</p>
          <div class="pochi-choice-grid">
            {#each $game.pendingPochiSwap.candidates as candidate}
              <button type="button" class="pochi-choice-tile" aria-label={`${candidate.target} に取る`} on:click={() => game.selectPochiSwap(candidate.target)}>
                <Tile pai={candidate.target} size="md" />
                <small>{candidate.expectedChip}枚期待</small>
              </button>
            {/each}
          </div>
        </dialog>
      </div>
    {/if}
    <!-- 2026-07-16 リョー指示: solo の CPU 和了サイコロは人間の確認までモーダルも進行も止める -->
    {#if viewMode === 'single' && $game.pendingSaiKoro && !$game.cpuWinAck}
      <div class="cpu-sai-ack">
        <button class="cpu-sai-ack-btn" on:click={() => { saiKoroOpened = true; game.ackCpuWin(); }}>
          🎲 CPU のサイコロチャンスを見る
        </button>
      </div>
    {/if}
    <!-- 2026-05-14: 非 winner client にも modal は見せる [dice 物理動画 WS sync を視認可能に]、
         操作は canOperate prop で完全遮断、 store 側 send-gate でも二重防御 -->
    {#if $game.pendingSaiKoro && (viewMode !== 'single' || (saiKoroOpened && $game.cpuWinAck))}
      {@const _curChance = $game.pendingSaiKoro.chances[$game.pendingSaiKoro.currentIdx]}
      {@const _chanceOwner = (((_curChance as any)?.winner) ?? $game.pendingSaiKoro.winner) as PlayerId}
      <!-- R5 P1 #2 fix: canOperate / chipMultiplier も current chance owner 基準に [ダブロン 2 人目 winner 操作権] -->
      <SaiKoroModal
        winner={_chanceOwner}
        canOperate={!onlineGameStarted || _chanceOwner === selfPlayer}
        chances={$game.pendingSaiKoro.chances}
        currentIdx={$game.pendingSaiKoro.currentIdx}
        selectedCombo={$game.pendingSaiKoro.selectedCombo}
        rolls={$game.pendingSaiKoro.rolls}
        finalized={$game.pendingSaiKoro.finalized}
        summary={$game.pendingSaiKoro.summary}
        chipMultiplier={$game.game.computeChipMultiplier(_chanceOwner, { bypassShuvari: true, bypassFever: false, bypassPochi: (_curChance as any)?.mode === 'ron', mode: (_curChance as any)?.mode ?? 'tsumo' })}
        onSelectCombo={(a, b) => game.selectSaiKoroCombo(a, b)}
        onRoll={(override?: [number, number]) => game.rollSaiKoroDice(override)}
        onAdvance={() => game.advanceSaiKoro()}
      />
    {/if}
    {#if $game.roundEnded && !$game.pendingSaiKoro}
      <!-- R21 P0 fix: nextRound は host or winner [人間] or 親 [agariyame] 許容 [server で gate]、
           次局へ は 流局 = host、 和了 = winner 自身 が押す自然な UX に -->
      <div class="action-row">
        <span class="row-label">局終了:</span>
        {#if !onlineGameStarted || onlineRoomMeta?.isHost || $game.lastWinner === selfPlayer || ($game.lastWinner !== null && $game.cpu[$game.lastWinner as 0|1|2])}
          <button class="next-btn" on:click={() => game.nextRound()}>次局へ</button>
          {#if $game.lastWinner !== null && $game.game.canAgariyame($game.lastWinner as PlayerId) && !$game.cpu[$game.lastWinner as 0|1|2] && (!onlineGameStarted || $game.lastWinner === selfPlayer)}
            <button class="next-btn agariyame" on:click={() => game.agariyame()}>アガリ止め</button>
          {/if}
        {:else}
          <button class="next-btn" disabled>p{$game.lastWinner} の「次局へ」待ち</button>
        {/if}
      </div>
    {/if}
    <!-- 2026-05-14 codex review #3 fix: system row [reset / paifu load / revealAll / selfPlayer radio]
         は online 中は 全 非表示。 local state 操作 / 他家手牌 公開 / 自家変更 で 同期破る -->
    {#if !onlineGameStarted}
    <div class="action-row sys">
      <span class="row-label">システム:</span>
      <button on:click={() => game.reset()}>初期化</button>
      <button on:click={exportPaifu} disabled={!canSavePaifu} title={canSavePaifu ? '現在の局面を保存' : '安全な手番開始時に保存できます'}>牌譜保存</button>
      <label class="paifu-load-btn">
        <input type="file" accept="application/json" on:change={onPaifuFile} style="display:none" />
        📂 牌譜ロード
      </label>
      <label class="reveal-toggle">
        <input type="checkbox" bind:checked={revealAll}>全手牌
      </label>
      <span class="self-select">
        自家:
        {#each PLAYERS as p}
          <label><input type="radio" bind:group={selfPlayer} value={p}>p{p}</label>
        {/each}
      </span>
    </div>
    {/if}
    {#if needsZimo && (!onlineGameStarted || currentPlayer === selfPlayer)}
      <div class="action-row hot">
        <span class="row-label">🃏 次の手番:</span>
        <button class="next-btn" on:click={() => game.drawNext()}>▶ ツモ [p{currentPlayer}]</button>
        <span class="hint" style="margin-left:8px">load 後 / dapai 後の中間 state、 ツモ してから打牌</span>
      </div>
    {:else}
      <div class="hint">手牌の牌をクリックして打牌</div>
    {/if}
  </header>

  {#if viewMode === 'single'}
    <!-- 上部 row: フィーバー待ち [左、 ドラ表と同列 inline] + ドラ表示牌 + 設定 -->
    <div class="dora-row">
      <span class="turn-status status-{actionStatus.tone}" aria-live="polite">
        <span class="status-dot" aria-hidden="true"></span>
        {actionStatus.text}
      </span>
      <div class="dora-main">
        {#if feverWaits.length > 0}
          <span class="fever-inline-label">🔥 フィーバー</span>
          {#each feverWaits as fw}
            <span class="fever-inline-player">p{fw.player}:</span>
            {#each fw.waits as w}
              <span class="fever-inline-wait">
                <Tile pai={w.tile} size="md" />
                <span class="fever-inline-remain">残{w.remain}</span>
              </span>
            {/each}
          {/each}
          <span class="dora-divider">|</span>
        {/if}
        <span class="dora-label">ドラ表</span>
        {#each baopai.filter((t) => typeof t === 'string' && !t.startsWith('f')) as t}
          <Tile pai={t} size="md" />
        {/each}
      </div>
      <div class="settings-group">
        {#if !onlineGameStarted}
          <label title="自分の手番を自動でツモ切り"><input type="checkbox" bind:checked={autoTsumoKiri}>ツモ切り</label>
        {/if}
        {#if !onlineGameStarted}
          <label title="他家の手牌を表示"><input type="checkbox" checked={revealAll} on:change={toggleRevealAll}>他家手牌</label>
          <label title="CPU の操作を2.5秒遅らせる"><input type="checkbox" bind:checked={cpuSlowMode}>CPU ラグ</label>
          <button class="table-setting-btn online" on:click={() => { viewMode = 'online'; }} title="オンライン対戦へ" aria-label="オンライン対戦へ">🌐 <span class="settings-label">オンライン対戦</span></button>
          <button class="table-setting-btn save" on:click={exportPaifu} disabled={!canSavePaifu} title={canSavePaifu ? '現在の局面を保存' : '安全な手番開始時に保存できます'} aria-label="牌譜保存">📂 <span class="settings-label">牌譜保存</span></button>
        {:else}
          <button class="table-setting-btn leave" on:click={() => { disconnectOnline(); viewMode = 'online'; }} title="対局から退出" aria-label="対局から退出">× <span class="settings-label">退出</span></button>
        {/if}
      </div>
    </div>
    <div class="center-board">
      <!-- ロン / ツモ 中央 overlay button [score-box の上に重ねる]
           2026-05-14 ゆーま 自走 bug fix: hardcoded 0 を selfPlayer 参照に、 オンライン
           で selfPlayer != 0 の時 ツモ / ロン button 出なかった bug -->
      <!-- 2026-05-15 [bug C] fix: 他家打牌で ロン判定中 [awaitingRonDecision] や 直前打牌が残ってる
           [lastDapai !== null] 状態では 「ツモ」 button を出さない。 これが残ると ロン宣言時 UI に
           ツモ button が被って 「ロンなのにツモ表示」 と混同させる -->
      {#if currentPlayer === selfPlayer && canTsumo && !$game.roundEnded
            && !$game.awaitingRonDecision && !$game.awaitingFulou && !$game.lastDapai
            && !$game.pendingSaiKoro && !$game.pendingFeverContinue && !$game.pendingFuyu && !$game.pendingKinpei}
        <button class="agari-center-btn tsumo-center" on:click={() => game.tsumo()}>ツモ</button>
      {/if}
      {#if $game.awaitingRonDecision && !$game.pendingFeverContinue && !$game.pendingFuyu && !$game.pendingKinpei && ronCandidates.includes(selfPlayer)}
        <div class="ron-choice-panel">
          <button class="ron-half" on:click={() => game.ron(selfPlayer)}>P{$game.lastDapai?.player ?? '?'}→P{selfPlayer} ロン</button>
          {#if !ronCandidates.some((p) => $game.game.shuvariActive[p as PlayerId])}
            <button class="skip-half" on:click={() => game.pass()}>見送る</button>
          {/if}
        </div>
      {/if}
      <!-- 中央の score-box [仕組み図 中央四角]、 oya 方向に外枠 [リョー指示] -->
      <!-- 2026-05-14 codex review #3 fix: oyaPlayer は real player id、 視覚座 srv0/srv1/srv2 への
           mapping で direction 決める。 online で selfPlayer != 0 の時に親枠方向 ズレを防ぐ -->
      <div class="score-box oya-{oyaPlayer === srv0 ? 'bottom' : (oyaPlayer === srv1 ? 'left' : (oyaPlayer === srv2 ? 'right' : 'bottom'))}">
        <div class="score-side score-top">場 {['東','南','西','北'][state.changbang] ?? '東'}{state.jushu + 1}局</div>
        <div class="score-side score-left lizhi-{$game.game.lizhi.has(srv1)} {$game.game.shuvariActive[srv1] ? 'shuvari' : ''} {$game.game.feverActive[srv1] ? 'fever' : ''} {oyaPlayer === srv1 ? 'is-oya' : ''}">
          <div class="sname">{onlineGameStarted ? seatName(srv1) : 'P1'}{$game.game.lizhi.has(srv1) ? ' リーチ' : ''}{$game.game.shuvariActive[srv1] ? ' [シュバ]' : ''}{$game.game.feverActive[srv1] ? ' [フィバ]' : ''}</div>
          <div class="sval">{$game.game.state.defen[srv1].toLocaleString()}</div>
          <div class="ssub">
            {#if revealAll || selfPlayer === srv1}シャンテン {xt1} / {/if}チップ {$game.game.chipLedger[srv1] ?? 0}<br>{$game.game.shuvariUsed[srv1] ? 'シュバ済' : 'シュバ未'}
          </div>
        </div>
        <div class="score-center">
          <div class="benbang">{state.benbang} 本場</div>
          <div class="paishu">山 {paishu}</div>
        </div>
        <div class="score-side score-right lizhi-{$game.game.lizhi.has(srv2)} {$game.game.shuvariActive[srv2] ? 'shuvari' : ''} {$game.game.feverActive[srv2] ? 'fever' : ''} {oyaPlayer === srv2 ? 'is-oya' : ''}">
          <div class="sname">{onlineGameStarted ? seatName(srv2) : 'P2'}{$game.game.lizhi.has(srv2) ? ' リーチ' : ''}{$game.game.shuvariActive[srv2] ? ' [シュバ]' : ''}{$game.game.feverActive[srv2] ? ' [フィバ]' : ''}</div>
          <div class="sval">{$game.game.state.defen[srv2].toLocaleString()}</div>
          <div class="ssub">
            {#if revealAll || selfPlayer === srv2}シャンテン {xt2} / {/if}チップ {$game.game.chipLedger[srv2] ?? 0}<br>{$game.game.shuvariUsed[srv2] ? 'シュバ済' : 'シュバ未'}
          </div>
        </div>
        <div class="score-side score-bottom lizhi-{$game.game.lizhi.has(srv0)} {$game.game.shuvariActive[srv0] ? 'shuvari' : ''} {$game.game.feverActive[srv0] ? 'fever' : ''} {oyaPlayer === srv0 ? 'is-oya' : ''}">
          <div class="sname">{onlineGameStarted ? seatName(srv0) : 'P0'} [自]{$game.game.lizhi.has(srv0) ? ' リーチ' : ''}{$game.game.shuvariActive[srv0] ? ' [シュバ]' : ''}{$game.game.feverActive[srv0] ? ' [フィバ]' : ''}</div>
          <div class="sval">{$game.game.state.defen[srv0].toLocaleString()}</div>
          <div class="ssub">シャンテン {xt0} / チップ {$game.game.chipLedger[srv0] ?? 0} / {$game.game.shuvariUsed[srv0] ? 'シュバ済' : 'シュバ未'}</div>
        </div>
      </div>
      <!-- 4 方向 河ゾーン [雀魂風、 6 牌/行で wrap]、 各 player の向きに合わせて回転 -->
      <div class="hez hez-bottom">
        {#each he0 as t, i}
          <span class="hez-tile {t.endsWith('_') ? 'lizhi-tile' : ''} {t.includes('#n') ? 'naki-tile' : ''} {t.includes('#t') ? 'tsumogiri-tile' : ''}" style="top: {Math.floor(i / 6) * 6}vmin; left: {(i % 6) * 5.5}vmin;">
            <Tile pai={t.replace(/(#[nt])+|_$/g, '')} size="md" />
          </span>
        {/each}
      </div>
      <div class="hez hez-left">
        {#each he1 as t, i}
          <span class="hez-tile {t.endsWith('_') ? 'lizhi-tile' : ''} {t.includes('#n') ? 'naki-tile' : ''} {t.includes('#t') ? 'tsumogiri-tile' : ''}" style="top: {(i % 6) * 5.5}vmin; right: {Math.floor(i / 6) * 6}vmin;">
            <Tile pai={t.replace(/(#[nt])+|_$/g, '')} size="md" />
          </span>
        {/each}
      </div>
      <div class="hez hez-right">
        {#each he2 as t, i}
          <span class="hez-tile {t.endsWith('_') ? 'lizhi-tile' : ''} {t.includes('#n') ? 'naki-tile' : ''} {t.includes('#t') ? 'tsumogiri-tile' : ''}" style="bottom: {(i % 6) * 5.5}vmin; left: {Math.floor(i / 6) * 6}vmin;">
            <Tile pai={t.replace(/(#[nt])+|_$/g, '')} size="md" />
          </span>
        {/each}
      </div>
    </div>
    <!-- 抜き牌 3 box 上部に並べる [srv1 / srv0 / srv2 順、 視覚座 = 左 / 自 / 右]、 center-board の外
         2026-05-14 ゆーま 自走 bug fix: hardcoded nukidora[0/1/2] だと online で
         selfPlayer != 0 の時 自分の box に他人の抜き牌が表示される、 srv* 参照に変更 -->
    <div class="nuki-row">
      <div class="nuki">
        <div class="nuki-label">{onlineGameStarted ? seatName(srv1) : 'P1'} 抜</div>
        {#each Array($game.game.nukidora[srv1] ?? 0) as _, i}<Tile pai="z4" size="md" />{/each}
        {#each Array($game.game.nukidoraGold[srv1] ?? 0) as _, i}<Tile pai="gN" size="md" />{/each}
        {#each $game.game.huapai[srv1] ?? [] as h}<Tile pai={h} size="md" />{/each}
      </div>
      <div class="nuki">
        <div class="nuki-label">{onlineGameStarted ? seatName(srv0) : 'P0'} 抜 [自]</div>
        {#each Array($game.game.nukidora[srv0] ?? 0) as _, i}<Tile pai="z4" size="md" />{/each}
        {#each Array($game.game.nukidoraGold[srv0] ?? 0) as _, i}<Tile pai="gN" size="md" />{/each}
        {#each $game.game.huapai[srv0] ?? [] as h}<Tile pai={h} size="md" />{/each}
      </div>
      <div class="nuki">
        <div class="nuki-label">{onlineGameStarted ? seatName(srv2) : 'P2'} 抜</div>
        {#each Array($game.game.nukidora[srv2] ?? 0) as _, i}<Tile pai="z4" size="md" />{/each}
        {#each Array($game.game.nukidoraGold[srv2] ?? 0) as _, i}<Tile pai="gN" size="md" />{/each}
        {#each $game.game.huapai[srv2] ?? [] as h}<Tile pai={h} size="md" />{/each}
      </div>
    </div>
  {/if}

  <!-- スタンプ slot bar [画面下、 手牌の上、 左から P1 / P0 / P2] -->
  <div class="stamp-slot-bar">
    <div class="stamp-slot stamp-slot-p1"><StampPopup stamp={$game.stamps[1]} /></div>
    <div class="stamp-slot stamp-slot-p0"><StampPopup stamp={$game.stamps[0]} /></div>
    <div class="stamp-slot stamp-slot-p2"><StampPopup stamp={$game.stamps[2]} /></div>
  </div>
  <CutinOverlay cutin={$game.cutin} />

  <div class="seat seat-bottom" style="position:relative">
    {#if viewMode === 'single'}
      <div class="toolbar toolbar-red">
        <!-- 現在 player [手番] が P0 [user] の時だけ アクション button 表示 [リョー指示 2026-05-12: CPU 手番中 北抜きボタンが出る bug fix] -->
        <!-- ツモ button は center overlay に移動 [リョー指示 2026-05-12]、 toolbar 側は白暗カンのみ -->
        {#if currentPlayer === selfPlayer && canTsumo && !$game.roundEnded && !$game.awaitingRonDecision && !$game.awaitingFulou && !$game.pendingSaiKoro && !$game.pendingFeverContinue && !$game.pendingFuyu && !$game.pendingKinpei && !$game.lastDapai}
          {#if $game.game.lizhi.has(currentPlayer) && $game.game.shoupai.get(currentPlayer)?._zimo === 'z5' && $game.game.getKanCandidates(currentPlayer).some((m: string) => m.startsWith('z5'))}
            <div class="tb-row hot">
              <button class="kan-btn" on:click={() => game.declareKan('z5z5z5z5')}>白暗カン</button>
            </div>
          {/if}
        {/if}
        {#if currentPlayer === selfPlayer && !$game.roundEnded && !$game.awaitingRonDecision && !$game.awaitingFulou && !$game.pendingFeverContinue && !$game.pendingFuyu && !$game.pendingKinpei && $game.game.canLizhi(currentPlayer)}
          <div class="tb-row">
            <button class="lizhi-btn" on:click={() => game.lizhi()}>リーチ</button>
            {#if !$game.game.shuvariUsed[currentPlayer]}
              <button class="lizhi-btn shuvari" on:click={() => game.lizhi({shuvari:true})}>シュバ</button>
            {/if}
            {#if feverAvailable}
              <button class="lizhi-btn fever" on:click={() => game.lizhi({fever:true})}>フィバ</button>
              {#if !$game.game.shuvariUsed[currentPlayer]}
                <button class="lizhi-btn shuvari-fever" on:click={() => game.lizhi({shuvari:true,fever:true})}>シュバフィバ</button>
              {/if}
              {#if feverIsConditional}
                <span class="fever-cond-hint">[{feverDapaiTiles.join('/')} 切れば fever]</span>
              {/if}
            {/if}
            <button class="lizhi-btn open" on:click={() => game.lizhi({open:true})}>オープン</button>
            {#if !$game.game.shuvariUsed[currentPlayer]}
              <button class="lizhi-btn shuvari-open" on:click={() => game.lizhi({shuvari:true, open:true})}>シュバオープン</button>
            {/if}
          </div>
        {/if}
        {#if currentPlayer === selfPlayer && !$game.roundEnded && !$game.awaitingRonDecision && !$game.awaitingFulou}
          {#each $game.game.getKanCandidates(currentPlayer) as km}
            <div class="tb-row"><button class="kan-btn" on:click={() => game.declareKan(km)}>カン</button></div>
          {/each}
        {/if}
        <!-- ロン+スキップ は ron-choice-panel に移動 [center overlay 白 bg]、 toolbar 側は出さない -->

        <!-- 自家 [selfPlayer] が候補のときだけ ポン/カン/スキップ を表示 [mianzi 非空チェック]
             2026-05-14 ゆーま 自走 bug fix: 旧 hardcoded 0 だと online で selfPlayer != 0
             の時 ポンボタンが出ない、 selfPlayer 参照に修正 -->
        {#if $game.awaitingFulou && ([...($game.ponCandidates ?? []), ...($game.kanCandidates ?? [])].some(c => c.player === selfPlayer && (c.mianzi?.length ?? 0) > 0))}
          {#each ($game.ponCandidates ?? []).filter(c => c.player === selfPlayer) as cand}
            {#each cand.mianzi as m}
              <div class="tb-row hot"><button class="pon-btn" on:click={() => game.pon(cand.player, m)}>ポン</button></div>
            {/each}
          {/each}
          {#each ($game.kanCandidates ?? []).filter(c => c.player === selfPlayer) as cand}
            {#each cand.mianzi as m}
              <div class="tb-row hot"><button class="kan-btn" on:click={() => game.damingang(cand.player, m)}>カン</button></div>
            {/each}
          {/each}
          <div class="tb-row"><button on:click={() => game.pass()}>見送る</button></div>
        {/if}
        <!-- 2026-05-14 codex review #3 fix: 続行 / drawNext も winner / currentPlayer===selfPlayer gate -->
        {#if $game.pendingFeverContinue && !$game.pendingSaiKoro && (!onlineGameStarted || $game.pendingFeverContinue.winner === selfPlayer)}
          <div class="tb-row hot"><button class="next-btn" on:click={() => game.continueFever()}>続行</button></div>
        {/if}
        {#if needsZimo && (!onlineGameStarted || currentPlayer === selfPlayer)}
          <div class="tb-row hot">
            <button class="next-btn" on:click={() => game.drawNext()}>▶ ツモ [p{currentPlayer}]</button>
          </div>
        {/if}
        {#if $game.message && !$game.awaitingRonDecision && !$game.awaitingFulou && !$game.lastHuleResult}
          <div class="tb-row"><span class="alert">{$game.message}</span></div>
        {/if}
        <!-- スタンプ button [自家のみ表示、 cosmetic、 game state 副作用なし] -->
        <div class="tb-row"><button class="stamp-open-btn" on:click={openStampPallet} title="スタンプ">💬</button></div>
      </div>
    {/if}
    <PlayerHandPanel
      player={srv0} label="player {srv0} [自家]"
      isCurrent={currentPlayer === srv0}
      shoupai={shoupai0} fulou={fulou0}
      huapai={$game.game.huapai[srv0]}
      nukidora={$game.game.nukidora[srv0]}
      nukidoraGold={$game.game.nukidoraGold[srv0] ?? 0}
      goldHandZ={$game.game.goldHand[srv0].z}
      he={he0}
      revealHand={selfPlayer === srv0 || (!onlineGameStarted && revealAll) || $game.game.openLizhi.has(srv0) || $game.game.isFeverConfirmed(srv0)}
      lastZimoIdx={lastZimoIndex($game.game.shoupai.get(srv0), shoupai0)}
      isLizhiCand={isLizhiCand}
      lizhiPending={$game.lizhiPending === currentPlayer}
      onTileClick={onTileClick}
      disabled={needsZimo}
      shuvariActive={$game.game.shuvariActive[srv0]}
    />
  </div>
  <div class="seat seat-left" style="position:relative">
    {#if viewMode === 'single'}
      <div class="vplayer left {currentPlayer === srv1 ? 'current' : ''}">
        <div class="vinfo">
          <span class="vfeng">{['東','南','西'][$game.game.zifengZ(srv1) - 1] ?? ''}</span>
          <span class="vname">{onlineGameStarted ? seatName(srv1) + ' 上家' : 'P1 上家'}</span>
          {#if $game.game.shuvariActive[srv1]}<span class="vshuvari-badge">シュバ</span>{/if}
        </div>
        <div class="vhand vleft-hand">
          {#each sideTiles1 as t}
            <span class="vtile rot-l back-{state.jushu % 2 === 0 ? 'blue' : 'orange'}">
              {#if t === 'back'}
                <Tile pai="m1" face="down" size="md" />
              {:else}
                <Tile pai={t} size="md" />
              {/if}
            </span>
          {/each}
          {#each fulou1 as m}
            <span class="vfulou-group">
              {#each m.tiles as t, ti}<span class="vtile rot-l" class:vclaimed={ti === m.rotateIdx}><Tile pai={t} size="md" /></span>{/each}
              {#if m.kakanTile}<span class="vtile rot-l vclaimed"><Tile pai={m.kakanTile} size="md" /></span>{/if}
            </span>
          {/each}
        </div>
      </div>
    {:else}
      <PlayerHandPanel
        player={srv1} label="player {srv1} [上家]"
        isCurrent={currentPlayer === srv1}
        shoupai={shoupai1} fulou={fulou1}
        huapai={$game.game.huapai[srv1]}
        nukidora={$game.game.nukidora[srv1]}
        nukidoraGold={$game.game.nukidoraGold[srv1] ?? 0}
        goldHandZ={$game.game.goldHand[srv1].z}
        he={he1}
        revealHand={selfPlayer === srv1 || (!onlineGameStarted && revealAll) || $game.game.openLizhi.has(srv1) || $game.game.isFeverConfirmed(srv1)}
        lastZimoIdx={lastZimoIndex($game.game.shoupai.get(srv1), shoupai1)}
        isLizhiCand={isLizhiCand}
      lizhiPending={$game.lizhiPending === currentPlayer}
        onTileClick={onTileClick}
        disabled={needsZimo}
        shuvariActive={$game.game.shuvariActive[srv1]}
      />
    {/if}
  </div>
  <div class="seat seat-right" style="position:relative">
    {#if viewMode === 'single'}
      <div class="vplayer right {currentPlayer === srv2 ? 'current' : ''}">
        <div class="vinfo">
          <span class="vfeng">{['東','南','西'][$game.game.zifengZ(srv2) - 1] ?? ''}</span>
          <span class="vname">{onlineGameStarted ? seatName(srv2) + ' 下家' : 'P2 下家'}</span>
          {#if $game.game.shuvariActive[srv2]}<span class="vshuvari-badge">シュバ</span>{/if}
        </div>
        <div class="vhand vright-hand">
          {#each sideTiles2 as t}
            <span class="vtile rot-r back-{state.jushu % 2 === 0 ? 'blue' : 'orange'}">
              {#if t === 'back'}
                <Tile pai="m1" face="down" size="md" />
              {:else}
                <Tile pai={t} size="md" />
              {/if}
            </span>
          {/each}
          {#each fulou2 as m}
            <span class="vfulou-group">
              {#each m.tiles as t, ti}<span class="vtile rot-r" class:vclaimed={ti === m.rotateIdx}><Tile pai={t} size="md" /></span>{/each}
              {#if m.kakanTile}<span class="vtile rot-r vclaimed"><Tile pai={m.kakanTile} size="md" /></span>{/if}
            </span>
          {/each}
        </div>
      </div>
    {:else}
      <PlayerHandPanel
        player={srv2} label="player {srv2} [下家]"
        isCurrent={currentPlayer === srv2}
        shoupai={shoupai2} fulou={fulou2}
        huapai={$game.game.huapai[srv2]}
        nukidora={$game.game.nukidora[srv2]}
        nukidoraGold={$game.game.nukidoraGold[srv2] ?? 0}
        goldHandZ={$game.game.goldHand[srv2].z}
        he={he2}
        revealHand={selfPlayer === srv2 || (!onlineGameStarted && revealAll) || $game.game.openLizhi.has(srv2) || $game.game.isFeverConfirmed(srv2)}
        lastZimoIdx={lastZimoIndex($game.game.shoupai.get(srv2), shoupai2)}
        isLizhiCand={isLizhiCand}
      lizhiPending={$game.lizhiPending === currentPlayer}
        onTileClick={onTileClick}
        disabled={needsZimo}
        shuvariActive={$game.game.shuvariActive[srv2]}
      />
    {/if}
  </div>

  {#if viewMode !== 'single'}
    <FeverWaitsPanel feverWaits={feverWaits} />
  {/if}

  {#if state.finished && viewMode !== 'single'}
    <GameEndPanel
      ranking={$game.game.getRanking()}
      zifengZ={(p) => $game.game.zifengZ(p as any)}
      chipLedger={[0,1,2].map(p => $game.game.chipLedger[p as PlayerId] ?? 0)}
      finalScore={$game.game.getFinalScore()}
    />
  {/if}

  {#if $game.lastHuleResult && viewMode !== 'single'}
    <RoundEndPanel
      lastWinner={$game.lastWinner}
      huleResult={$game.lastHuleResult}
      baopai={[...$game.game.shan.baopai]}
      fubaopai={$game.game.shan.fubaopai ? [...$game.game.shan.fubaopai] : null}
      winnerLizhi={$game.lastWinner !== null && $game.game.lizhi.has($game.lastWinner as PlayerId)}
      agariType={$game.lastDapai && $game.lastWinner !== null && $game.lastDapai.player !== $game.lastWinner ? 'ron' : ($game.lastWinner !== null ? 'tsumo' : null)}
      agariPai={$game.lastDapai && $game.lastWinner !== null && $game.lastDapai.player !== $game.lastWinner
        ? $game.lastDapai.pai
        : ($game.lastWinner !== null ? ($game.game.shoupai.get($game.lastWinner as PlayerId)?._zimo ?? null) : null)}
      agariFrom={$game.lastDapai && $game.lastWinner !== null && $game.lastDapai.player !== $game.lastWinner ? $game.lastDapai.player : null}
    />
  {/if}

  {#if ($game.lastHuleResult || state.finished || $game.pendingPingju) && viewMode === 'single'}
    <div class="agari-unified-panel">
      <div class="agari-left">
        {#if state.finished}
          <GameEndPanel ranking={$game.game.getRanking()} zifengZ={(p) => $game.game.zifengZ(p as any)} chipLedger={[0,1,2].map(p => $game.game.chipLedger[p as PlayerId] ?? 0)} finalScore={$game.game.getFinalScore()} />
        {/if}
        {#if $game.pendingPingju && !$game.lastHuleResult}
          <div class="top-line" style="display:flex; gap:16px; align-items:baseline;">
            <h2 style="margin:0; font-size:26px;">流局</h2>
            <span style="font-size:18px;">{$game.message ?? '🌀 山切れ'}</span>
          </div>
          {#if $game.game.preHuleSnapshot}
            {@const pdelta = [0,1,2].map(p => state.defen[p as PlayerId] - (($game.game.preHuleSnapshot as any).defen[p] ?? 0))}
            <div class="payment-row" style="display:flex; gap:10px; align-items:center; margin-top:12px; flex-wrap:wrap;">
              <span style="font-weight:700; font-size:16px;">点数移動:</span>
              {#each pdelta as v, p}
                <span style="padding:5px 14px; border-radius:4px; font-weight:700; font-size:18px;
                  background: {v > 0 ? 'rgba(80,180,100,0.18)' : v < 0 ? 'rgba(220,80,80,0.18)' : 'rgba(0,0,0,0.08)'};
                  color: {v > 0 ? '#2c8040' : v < 0 ? '#c04040' : '#888'};">
                  P{p}: {v > 0 ? '+' : ''}{v.toLocaleString()} → {state.defen[p as PlayerId].toLocaleString()}
                </span>
              {/each}
            </div>
          {/if}
        {/if}
        {#if $game.lastHuleResult && !state.finished}
          <RoundEndPanel
            lastWinner={$game.lastWinner}
            huleResult={$game.lastHuleResult}
            baopai={[...$game.game.shan.baopai]}
            fubaopai={$game.game.shan.fubaopai ? [...$game.game.shan.fubaopai] : null}
            winnerLizhi={$game.lastWinner !== null && $game.game.lizhi.has($game.lastWinner as PlayerId)}
            defenDelta={latestHuleDefenDelta()}
            defenAfter={[state.defen[0], state.defen[1], state.defen[2]] as [number, number, number]}
            winnerShoupai={$game.lastWinner !== null ? handTiles($game.game.shoupai.get($game.lastWinner as PlayerId), $game.lastWinner) : []}
            winnerFulou={$game.lastWinner !== null ? fulouMianzi($game.game.shoupai.get($game.lastWinner as PlayerId), $game.lastWinner as PlayerId) : []}
            winnerHuapai={$game.lastWinner !== null ? ($game.game.huapai[$game.lastWinner as PlayerId] ?? []) : []}
            winnerNuki={$game.lastWinner !== null ? ($game.game.nukidora[$game.lastWinner as PlayerId] ?? 0) : 0}
            winnerNukiGold={$game.lastWinner !== null ? ($game.game.nukidoraGold[$game.lastWinner as PlayerId] ?? 0) : 0}
            hideFuyuResult={$game.pendingKinpei !== null}
            agariType={$game.lastDapai && $game.lastWinner !== null && $game.lastDapai.player !== $game.lastWinner ? 'ron' : ($game.lastWinner !== null ? 'tsumo' : null)}
            agariPai={$game.lastDapai && $game.lastWinner !== null && $game.lastDapai.player !== $game.lastWinner
              ? $game.lastDapai.pai
              : ($game.lastWinner !== null ? ($game.game.shoupai.get($game.lastWinner as PlayerId)?._zimo ?? null) : null)}
            agariFrom={$game.lastDapai && $game.lastWinner !== null && $game.lastDapai.player !== $game.lastWinner ? $game.lastDapai.player : null}
          >
            <div slot="chip">
              {#if $game.lastHuleResult?.chipBreakdown?.length > 0}
                <ChipBreakdown breakdown={$game.lastHuleResult.chipBreakdown} total={$game.lastHuleResult.chipTotal ?? 0} />
              {/if}
            </div>
          </RoundEndPanel>
        {/if}
      </div>
      <!-- 2026-05-14 codex review #3 fix: inline Kinpei は winner 限定 -->
      {#if $game.pendingKinpei && viewMode === 'single' && (!onlineGameStarted || ($game.pendingKinpei.decisionOwners ?? [$game.pendingKinpei.winner]).includes(selfPlayer))}
        {@const effectiveKinpeiHua = $game.pendingKinpei.availableHuapai ?? $game.game.effectiveHuapaiAtHule($game.pendingKinpei.winner as PlayerId)}
        <div class="kinpei-inline">
          <div class="kinpei-title">金北 強化対象 [P{$game.pendingKinpei.winner} 選択]</div>
          <div class="kinpei-btns">
            {#if effectiveKinpeiHua.includes('f1')}
              <button class="kinpei-btn haru" on:click={() => game.selectKinpei('haru')}>春</button>
            {/if}
            {#if effectiveKinpeiHua.includes('f2')}
              <button class="kinpei-btn natsu" on:click={() => game.selectKinpei('natsu')}>夏</button>
            {/if}
            {#if effectiveKinpeiHua.includes('f3')}
              <button class="kinpei-btn aki" on:click={() => game.selectKinpei('aki')}>秋</button>
            {/if}
            {#if effectiveKinpeiHua.includes('f4')}
              <button class="kinpei-btn fuyu" on:click={() => game.selectKinpei('fuyu')}>冬</button>
            {/if}
            {#if $game.game.feverActive[$game.pendingKinpei.winner as PlayerId]}
              <button class="kinpei-btn hold" on:click={() => game.selectKinpei(null)}>保留 [今局のみ]</button>
            {/if}
            <!-- 2026-05-14 fix [user 報告]: 華牌なし時 button が無くて止まる対策、 「強化なし」 を常時表示 -->
            {#if !(effectiveKinpeiHua.some((p: string) => p === 'f1' || p === 'f2' || p === 'f3' || p === 'f4'))}
              <button class="kinpei-btn hold" on:click={() => game.selectKinpei(null)}>強化対象なし [次へ]</button>
            {/if}
          </div>
        </div>
      {/if}
      {#if ($game.roundEnded || $game.pendingPingju || $game.pendingFeverContinue) && !$game.pendingKinpei}
        <div class="agari-actions">
          {#if $game.game.preHuleSnapshot && $game.lastWinner !== null}
            {@const chipDelta = [0,1,2].map(p => ($game.game.chipLedger[p as PlayerId] ?? 0) - (($game.game.preHuleSnapshot as any).chipLedger?.[p] ?? 0))}
            <div class="chip-transfer">
              {#each [0,1,2] as p}
                {#each [0,1,2] as q}
                  {#if chipDelta[p] < 0 && chipDelta[q] > 0}
                    <div class="ct-row">P{p}→P{q}: <strong>{Math.min(Math.abs(chipDelta[p]), Math.abs(chipDelta[q]))}枚</strong></div>
                  {/if}
                {/each}
              {/each}
            </div>
          {/if}
          <!-- 2026-05-14 codex review #3 fix: サイコロへ / フィーバー継続 も winner gate -->
          <!-- R14 P1 #2 fix: 入口 button を current chance owner で gate、 ダブロン 2 人目 chance で 2 人目 winner も開ける -->
          {#if $game.pendingSaiKoro && !saiKoroOpened && (!onlineGameStarted || ((($game.pendingSaiKoro.chances?.[$game.pendingSaiKoro.currentIdx] as any)?.winner ?? $game.pendingSaiKoro.winner) === selfPlayer))}
            <button on:click={() => { saiKoroOpened = true; }}>▶ サイコロへ</button>
          {:else if $game.pendingFeverContinue && (!onlineGameStarted || $game.pendingFeverContinue.winner === selfPlayer)}
            <button on:click={() => game.continueFever()}>▶ フィーバー継続</button>
          {:else if state.finished}
            <button on:click={exportPaifu} disabled={!canSavePaifu}>📂 牌譜保存</button>
            <label style="display:inline-flex; align-items:center; gap:4px; font-size:14px;">
              <input type="checkbox" bind:checked={resetChipOnNextMatch}>チップリセット
            </label>
            <!-- R15 P0 #4 fix: online は host のみ「次の試合へ」 表示。 ゲストが先押しで desync -->
            {#if !onlineGameStarted || onlineRoomMeta?.isHost}
              <button on:click={handleNextMatch}>▶ 次の試合へ</button>
            {:else}
              <span class="muted-hint">ホストの「次の試合へ」を待ってる</span>
            {/if}
          {:else}
            <!-- R21 P0 fix: nextRound は host or winner or 親 許容 [server gate]、
                 ゲスト人間和了で 詰みを 解消 -->
            {#if (!onlineGameStarted || onlineRoomMeta?.isHost || $game.lastWinner === selfPlayer || ($game.lastWinner !== null && $game.cpu[$game.lastWinner as 0|1|2])) && !$game.pendingSaiKoro}
              <button on:click={() => game.nextRound()}>▶ 次局へ</button>
              {#if $game.lastWinner !== null && $game.game.canAgariyame($game.lastWinner as PlayerId) && !$game.cpu[$game.lastWinner as 0|1|2] && (!onlineGameStarted || $game.lastWinner === selfPlayer)}
                <button on:click={() => game.agariyame()}>アガリ止め</button>
              {/if}
            {:else}
              <span class="muted-hint">p{$game.lastWinner} の「次局へ」を待ってる</span>
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if loadedPaifu}
    <PaifuLoadPanel
      loadedPaifu={loadedPaifu}
      loadedReplayIdx={loadedReplayIdx}
      replayLabel={replayLabel}
      onPrev={() => loadedReplayIdx = Math.max(0, loadedReplayIdx - 1)}
      onNext={() => loadedReplayIdx = Math.min((loadedPaifu?.events.length ?? 1) - 1, loadedReplayIdx + 1)}
      onClose={() => loadedPaifu = null}
    />
  {/if}

  <section class="debug-log">
    <TileChecker inventory={tileInventory} expected={tileExpected} />
    <WallPanel wall={(($game.game.shan as any)._pai ?? [])} baopai={[...$game.game.shan.baopai]} fubaopai={[...($game.game.shan.fubaopai ?? [])]} />
    <DebugLogPanel logs={debugLogs} onClear={() => { debugLogs = []; }} />
  </section>

  <section class="paifu">
    <ZimoHistory history={zimoHistory} />
    <h2>牌譜 [全 events]</h2>
    <ol>
      {#each events as e, i}
        <li>{eventLabel(e)}</li>
      {/each}
    </ol>
  </section>
</main>
{/if}

<!-- スタンプ pallet [global modal、 viewMode 問わず 開いてれば表示] -->
{#if stampPalletOpen}
  <StampPallet onSelect={onStampSelect} onClose={closeStampPallet} />
{/if}


<style>
  .stamp-open-btn {
    font-size: 18px;
    padding: 4px 10px;
    border: 1px solid #ff9800;
    border-radius: 6px;
    background: #fff8e1;
    cursor: pointer;
  }
  .stamp-open-btn:hover { background: #ffe082; }
  main {
    max-width: 900px;
    margin: 16px auto;
    padding: 16px;
    font-family: 'Noto Sans JP', sans-serif;
  }
  header {
    border-bottom: 1px solid #ccc;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .status, .defen { font-size: 12px; color: #555; margin: 4px 0; }
  .inline-tiles { display: inline-block; vertical-align: middle; }
  .defen { display: flex; flex-wrap: wrap; gap: 4px 8px; padding: 4px 0; border-top: 1px dashed #ddd; border-bottom: 1px dashed #ddd; }
  button {
    margin: 0;
    padding: 4px 10px;
    font-size: 12px;
    border: 1px solid #bbb;
    background: #f4f4f4;
    border-radius: 4px;
    cursor: pointer;
  }
  button:hover:not(:disabled) { background: #e8e8e8; }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
    filter: saturate(0.55);
  }
  button:focus-visible,
  input:focus-visible {
    outline: 3px solid #ffd060;
    outline-offset: 2px;
  }
  .action-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 4px 0;
    border-bottom: 1px dotted #eee;
  }
  .action-row.hot { background: #fff4e6; padding: 6px; border-radius: 4px; border: 1px solid #f0c080; }
  .action-row.sys { opacity: 0.85; }
  .action-row.debug { opacity: 0.7; font-size: 11px; }
  .row-label { font-size: 11px; color: #888; min-width: 56px; font-weight: bold; }
  .row-label.alert { color: #c04040; min-width: auto; }
  .lizhi-btn { background: #d4b070; color: #fff; border-color: #b08040; }
  .lizhi-btn.active { background: #e8e020; color: #333; box-shadow: 0 0 0 3px #ffd060 inset, 0 0 14px 4px rgba(255,208,96,0.7); outline: 3px solid #ffd060; font-weight: 800; transform: scale(1.1); }
  .lizhi-btn.shuvari { background: #a08020; }
  .lizhi-btn.fever { background: #a04020; }
  .fever-cond-hint { color: #ffb070; font-size: 11px; margin-left: 4px; align-self: center; }
  .lizhi-btn.shuvari-fever { background: #c01040; }
  .lizhi-btn.open { background: #aa6020; }
  .lizhi-btn.shuvari-open { background: #804010; }
  .next-btn.agariyame { background: #c8a020; }
  .hint { font-size: 11px; color: #888; margin-top: 4px; }
  .cpu-toggles {
    display: inline-block;
    font-size: 12px;
    margin-left: 16px;
    color: #555;
  }
  .cpu-toggles label { margin-right: 6px; cursor: pointer; }
  .cpu-toggles input { margin-right: 2px; vertical-align: middle; }
  .reveal-toggle, .self-select {
    display: inline-block;
    font-size: 12px;
    margin-left: 12px;
    color: #555;
  }
  .self-select label { margin-right: 6px; cursor: pointer; }
  .tsumo-btn, .ron-btn {
    background: #f0a000;
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    font-weight: bold;
    cursor: pointer;
    margin-left: 8px;
  }
  .ron-btn { background: #c00040; }
  .kan-btn {
    background: #6040c0;
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    font-weight: bold;
    cursor: pointer;
    margin-left: 4px;
  }
  .pon-btn {
    background: #00a050;
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    font-weight: bold;
    cursor: pointer;
    margin-left: 4px;
  }
  .next-btn {
    background: #2080d0;
    color: white;
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    font-weight: bold;
    cursor: pointer;
    margin-left: 8px;
  }
  .alert {
    display: inline-block;
    margin-left: 8px;
    padding: 4px 10px;
    background: #fffacd;
    border: 1px solid #f0a000;
    border-radius: 4px;
    font-size: 12px;
  }
  /* section.player / hule-panel / game-end-panel / yaku-chip 等は
     PlayerHandPanel / RoundEndPanel / GameEndPanel に集約済 */
  /* fever-info 系 style は FeverWaitsPanel に移行済 */
  .paifu-load-btn {
    display: inline-block;
    padding: 4px 10px;
    background: #f0f0f0;
    border: 1px solid #ccc;
    border-radius: 4px;
    cursor: pointer;
    margin: 4px 0 0 4px;
    font-size: 12px;
  }
  /* section.paifu-load / replay-* / section.debug-log は PaifuLoadPanel /
     DebugLogPanel に集約済 */
  section.debug-log {
    margin-top: 16px;
    padding: 8px 12px;
    background: #222;
    color: #9f9;
    border-radius: 6px;
    font-size: 11px;
  }
  section.debug-log :global(h2) { color: #afa; margin: 0 0 4px; font-size: 13px; }
  section.paifu {
    margin-top: 16px;
    padding: 8px 12px;
    background: #f0f0f0;
    border-radius: 6px;
    font-size: 11px;
  }
  section.paifu ol { margin: 4px 0; padding-left: 24px; }
  section.paifu li { font-family: monospace; }
  .tile-btn {
    border: none;
    background: transparent;
    padding: 0;
    margin: 0;
    cursor: pointer;
  }
  .tile-btn:disabled { cursor: default; opacity: 0.6; }
  .tile-btn:not(:disabled):hover { background: #ffe; border-radius: 4px; }
  .tile-btn.tsumo-tile {
    margin-left: 12px;
    border-bottom: 3px solid #f0a000;
  }
  .tile-btn.lizhi-cand {
    box-shadow: 0 0 0 2px #f04060 inset;
    border-radius: 4px;
  }
  .mode-toggle {
    margin-left: 12px;
    padding: 4px 10px;
    border: 1px solid #888;
    background: #2a2a2a;
    color: #fff;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    vertical-align: middle;
  }
  .mode-toggle:hover { background: #3a3a3a; }
  .cpu-speed-toggle {
    margin-left: 8px;
    font-size: 12px;
    color: #fff;
    vertical-align: middle;
  }
  .cpu-speed-toggle input { vertical-align: middle; }

  .orientation-notice {
    display: none;
  }

  /* 一人回しモード [single、 雀魂風 grid 全画面 layout] */
  main.mode-single .action-row.debug,
  main.mode-single .debug-log,
  main.mode-single .paifu,
  main.mode-single .events,
  main.mode-single .action-row.sys {
    display: none;
  }
  main.mode-single {
    position: fixed;
    inset: 0;
    background: #2a5040;
    color: #e8e8e8;
    width: 100vw;
    max-width: none;
    height: 100vh;
    margin: 0;
    padding: 4px;
    box-sizing: border-box;
    display: grid;
    z-index: 100;
    /* スマホ-first: vmin ベース、 縦長 [360×640] 比率想定。 PC では大画面で
     * 中央に scale が効く。 横画面では中央寄せ + 余白 */
    grid-template-columns: 15vmin 1fr 15vmin;
    grid-template-rows: auto auto auto 1fr auto;
    grid-template-areas:
      'left   top     right'
      'left   dora    right'
      'left   nuki    right'
      'left   center  right'
      'left   bottom  right';
    gap: 1vmin;
    width: 100vw;
    height: 100vh;
    /* 実機モバイルは URL バー分 100vh が下にはみ出て自家手牌が隠れる。
     * dvh 対応ブラウザでは動的ビューポート高を使う [2026-07-15 リョー実機報告] */
    height: 100dvh;
    overflow: hidden;
  }
  /* PC 全幅で使う [リョー指示 2026-05-12]: 横長でも余白なし、 viewport 一杯 */
  /* #app の 1126px cap を override [body.solo-mode 経由、 :has より bulletproof] */
  :global(body.solo-mode #app) {
    width: 100vw !important;
    max-width: none !important;
    border-inline: 0 !important;
  }
  :global(body.solo-mode) {
    margin: 0;
    overflow: hidden;
  }
  main.mode-single header {
    grid-area: top;
    padding: 0;
    background: transparent;
    border-radius: 0;
    min-height: 0;
    color: #e8e8e8;
  }
  /* solo mode: header 内 主要 element を非表示 [タイトル / dora / defen / action 群、 ボタンは toolbar-yellow/red に複製済] */
  main.mode-single header h1 { display: none; }
  main.mode-single header :global(.header-info) { display: none; }
  main.mode-single header :global(.defen) { display: none; }
  main.mode-single header .action-row { display: none; }
  main.mode-single header .hint { display: none; }
  main.mode-single :global(.header-info span),
  main.mode-single :global(.header-info div) { color: #e8e8e8 !important; }
  main.mode-single :global(.defen .player-status),
  main.mode-single :global(.defen .player-status *) { color: #e8e8e8 !important; }
  main.mode-single :global(.defen .player-status .defen) { color: #ffd060 !important; }
  main.mode-single .action-row { color: #e8e8e8; }
  main.mode-single .action-row * { color: inherit; }
  /* defen 行は solo mode で hide [score-box 内に移植済] */
  main.mode-single :global(.defen) { display: none !important; }

  /* 3 seat の grid 配置 */
  main.mode-single .seat-bottom {
    grid-area: bottom;
    background: transparent;
    padding: 0;
    overflow-y: visible;
  }
  /* P0 手牌は full width で span、 中央寄せ */
  main.mode-single .seat-bottom :global(section.player) {
    width: 100%;
    box-sizing: border-box;
  }
  main.mode-single .seat-bottom :global(.hand) {
    justify-content: center;
    flex-wrap: nowrap;
    gap: 2px;
  }
  main.mode-single .seat-left {
    grid-area: left;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 6px;
    padding: 6px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  main.mode-single .seat-right {
    grid-area: right;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 6px;
    padding: 6px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  /* 左右の section.player [PlayerHandPanel root] を 縦書き風に [transform は壊れやすいので、 layout は普通の縦並び] */
  main.mode-single .seat-left :global(section.player),
  main.mode-single .seat-right :global(section.player) {
    font-size: 11px;
  }
  main.mode-single .seat-left :global(section.player .hand),
  main.mode-single .seat-left :global(section.player .he),
  main.mode-single .seat-right :global(section.player .hand),
  main.mode-single .seat-right :global(section.player .he) {
    flex-wrap: wrap;
  }
  /* center area: 卓 / 山残 / ドラ表 大きく */
  main.mode-single .center-area {
    grid-area: center;
    background: radial-gradient(ellipse at center, #3a6050 0%, #1a3a2a 80%);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    padding: 12px;
    overflow: hidden;
  }
  /* header 内の要素は header 内で自然 flow [すでに header に defen / action-row 含む] */
  /* header 外の panel [RoundEnd / ChipBreakdown / FeverWaits / GameEnd / DebugLog] は center に overlay */
  main.mode-single :global(section.hule-panel),
  main.mode-single :global(.chip-breakdown),
  main.mode-single :global(.game-end-panel) {
    grid-area: center;
    align-self: center;
    justify-self: center;
    max-width: 60%;
    max-height: 80%;
    overflow: auto;
    z-index: 5;
  }
  main.mode-single :global(.debug-log) { display: none; }
  /* フィーバー待ち表示は dora-row 隣接の top に [リョー指示 2026-05-12] */
  main.mode-single :global(section.fever-info) {
    position: fixed;
    top: 4.5vh;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(245, 240, 220, 0.98) !important;
    color: #1a1820 !important;
    border: 2px solid #c0a040 !important;
    padding: 6px 14px !important;
    border-radius: 6px;
    z-index: 60;
    font-size: 16px !important;
  }
  main.mode-single :global(section.fever-info *) {
    color: #1a1820 !important;
    font-size: 16px !important;
  }
  main.mode-single :global(section.fever-info h2) {
    font-size: 18px !important;
    font-weight: 700;
    margin: 0 0 4px;
  }
  main.mode-single :global(section.fever-info .wait-chip) {
    background: #fff !important;
    border-color: #c0a040 !important;
    padding: 3px 8px !important;
    font-size: 15px !important;
  }

  /* 中央 卓 / 河ゾーン / 得点ボックス [雀魂風]
     center-board ごと translateY で上にシフト [score-box / 河 tile 同期] */
  main.mode-single .center-board {
    grid-area: center;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
    /* score-box と 河 を P0 抜きハイ直下まで上げる [リョー指示 2026-05-12] */
    transform: translateY(-12vh);
  }
  /* ロン choice panel: 白bg 上半分ロン / 下半分スキップ [リョー指示 2026-05-12] */
  main.mode-single .center-board .ron-choice-panel {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 250;
    width: 36vmin;
    height: 36vmin;
    min-width: 200px;
    min-height: 200px;
    background: #ffffff;
    border: 2px solid #c0a040;
    border-radius: 8px;
    display: grid;
    grid-template-rows: 1fr 1fr;
    gap: 6px;
    padding: 6px;
  }
  main.mode-single .center-board .ron-choice-panel button {
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 700;
    letter-spacing: 1px;
  }
  main.mode-single .center-board .ron-choice-panel .ron-half {
    background: #ffd060;
    color: #1a1820;
    font-size: 28px;
  }
  main.mode-single .center-board .ron-choice-panel .ron-half:hover {
    background: #ffe080;
  }
  main.mode-single .center-board .ron-choice-panel .skip-half {
    background: #c8c0a8;
    color: #1a1820;
    font-size: 20px;
  }
  main.mode-single .center-board .ron-choice-panel .skip-half:hover {
    background: #d8d0b8;
  }

  /* ツモ button [score-box の真上に被せる、 center-board 子] */
  main.mode-single .center-board .agari-center-btn {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 200;
    padding: 22px 56px;
    font-size: 36px;
    font-weight: 700;
    background: #d04040;
    color: #fff;
    border: 3px solid #ffd060;
    border-radius: 12px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6);
    cursor: pointer;
    letter-spacing: 2px;
  }
  main.mode-single .center-board .agari-center-btn:hover {
    background: #e05050;
  }
  main.mode-single .center-board .agari-center-btn.tsumo-center {
    background: #d4af37;
    color: #1a1820;
  }
  main.mode-single .center-board .agari-center-btn.tsumo-center:hover {
    background: #ffd060;
  }
  main.mode-single .score-box {
    width: 36vmin;
    height: 36vmin;
    min-width: 200px;
    min-height: 200px;
    overflow: hidden;
    display: grid;
    grid-template-columns: 90px 1fr 90px;
    grid-template-rows: 40px 1fr 110px;
    grid-template-areas:
      'top    top    top'
      'left   center right'
      'bottom bottom bottom';
    background: rgba(0, 0, 0, 0.55);
    border: 2px solid #d4af37;
    border-radius: 8px;
    color: #fff;
    z-index: 3;
  }
  main.mode-single .score-box .score-side.score-top { grid-area: top; text-align: center; font-size: 17px; padding: 8px 0; color: #ffd060; font-weight: bold; }
  main.mode-single .score-box .score-side.score-left { grid-area: left; text-align: center; align-self: center; padding: 4px; }
  main.mode-single .score-box .score-side.score-right { grid-area: right; text-align: center; align-self: center; padding: 4px; }
  main.mode-single .score-box .score-side.score-bottom { grid-area: bottom; text-align: center; padding: 0 4px; border-top: 0; align-self: start; line-height: 1.15; }
  main.mode-single .score-box .sname { font-size: 16px; color: #f0f0f0; font-weight: 700; letter-spacing: 0.5px; }
  main.mode-single .score-box .sval { font-size: 22px; font-weight: 700; color: #ffe080; letter-spacing: 0.5px; }
  main.mode-single .score-box .ssub { font-size: 13px; color: #d8e4f0; margin-top: 2px; line-height: 1.2; font-weight: 500; }
  /* 親プレイヤー: score-box の該当辺だけ赤太線 [枠と完全一致、 リョー指示 2026-05-12] */
  main.mode-single .score-box.oya-bottom { border-bottom: 5px solid #ff8060 !important; }
  main.mode-single .score-box.oya-left { border-left: 5px solid #ff8060 !important; }
  main.mode-single .score-box.oya-right { border-right: 5px solid #ff8060 !important; }
  main.mode-single .score-box .score-side.is-oya .sname::before {
    content: '【親番】';
    display: block;
    line-height: 1.1;
    font-size: 16px;
    font-weight: 700;
    color: #ff8060;
    margin-bottom: 2px;
  }
  main.mode-single .score-box .score-center {
    grid-area: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  main.mode-single .score-box .benbang { font-size: 18px; color: #ffd060; font-weight: bold; }
  main.mode-single .score-box .paishu { font-size: 22px; color: #e8e8e8; font-weight: 700; letter-spacing: 0.5px; }
  /* リーチ / シュバ / フィバの side 色付け */
  main.mode-single .score-box .score-side.lizhi-true { background: rgba(80, 160, 255, 0.25); border-radius: 4px; }
  main.mode-single .score-box .score-side.shuvari { background: rgba(255, 80, 80, 0.25); }
  main.mode-single .score-box .score-side.fever { background: rgba(255, 160, 60, 0.3); }
  /* 河ゾーン: 中央 score-box の周囲に 4 方向の捨て牌 */
  /* 4 方向河ゾーン [雀魂風]: 6 tiles per row、 player の向きに合わせて回転、 外側が下 [tile bottom edge は外向き] */
  main.mode-single .hez {
    position: absolute;
    display: grid;
    gap: 2px;
  }
  /* 河ゾーン共通: 小さめで score-box 外側に配置、 vmin で scale [リョー指示 2026-05-12] */
  main.mode-single .hez {
    position: absolute;
  }
  main.mode-single .hez .hez-tile {
    position: absolute;
    width: 4vmin;
    height: 5.5vmin;
    display: block;
  }
  /* hez 内の Tile を wrapper 中央に絶対配置 [lizhi 回転時の center 揃え] */
  main.mode-single .hez .hez-tile :global(.tile.size-md) {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 4vmin !important;
    height: 5.5vmin !important;
  }
  /* P0 自家 [下]: score-box 真下 [14vmin + 1vmin gap]、 face up
     幅は score-box [28vmin] に揃え + 6 牌で 5vmin spacing、 lizhi 横倒し時 被らないように */
  main.mode-single .hez-bottom {
    top: calc(50% + 19vmin);
    left: 50%;
    transform: translateX(-50%);
    width: 30vmin;
    height: 20vmin;
  }
  main.mode-single .hez-bottom .hez-tile.lizhi-tile {
    transform: rotate(90deg);
  }
  /* P1 上家 [左]: score-box 左 */
  main.mode-single .hez-left {
    top: 50%;
    right: calc(50% + 19vmin);
    transform: translateY(-50%);
    width: 20vmin;
    height: 30vmin;
  }
  main.mode-single .hez-left .hez-tile {
    transform: rotate(90deg);
  }
  main.mode-single .hez-left .hez-tile.lizhi-tile {
    transform: rotate(180deg);
  }
  /* P2 下家 [右]: score-box 右 */
  main.mode-single .hez-right {
    top: 50%;
    left: calc(50% + 19vmin);
    transform: translateY(-50%);
    width: 20vmin;
    height: 30vmin;
  }
  main.mode-single .hez-right .hez-tile {
    transform: rotate(-90deg);
  }
  main.mode-single .hez-right .hez-tile.lizhi-tile {
    transform: rotate(0deg);
  }
  /* [2026-05-21] 鳴かれた牌 (naki) は薄く gray out、 ツモ切り (tsumogiri) は軽い透過 */
  main.mode-single .hez .hez-tile.naki-tile {
    opacity: 0.4;
    filter: grayscale(0.6);
  }
  main.mode-single .hez .hez-tile.tsumogiri-tile {
    opacity: 0.75;
  }

  /* P0 [自家] 河は score-box の周りに出してるので、 seat-bottom 内の he は hide */
  main.mode-single .seat-bottom :global(section.player .he),
  main.mode-single .seat-bottom :global(.he) { display: none !important; }

  /* dora 表示 row [nuki row の上] */
  main.mode-single .dora-row {
    grid-area: dora;
    display: grid;
    grid-template-columns: minmax(150px, 1fr) auto minmax(150px, 1fr);
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 4px;
    color: #f0f0f0;
    font-size: 13px;
    font-weight: 500;
    position: relative;
  }
  main.mode-single .turn-status {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 4px 9px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.28);
    color: #e8e8e8;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
  }
  main.mode-single .turn-status .status-dot {
    width: 8px;
    height: 8px;
    flex: 0 0 8px;
    border-radius: 50%;
    background: #aab7b0;
  }
  main.mode-single .turn-status.status-action {
    color: #1a1820;
    background: #ffd060;
    border-color: #ffe89b;
    box-shadow: 0 0 0 2px rgba(255, 208, 96, 0.18);
  }
  main.mode-single .turn-status.status-action .status-dot { background: #c04040; }
  main.mode-single .turn-status.status-complete .status-dot { background: #5dbbff; }
  main.mode-single .dora-main {
    justify-self: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
  }
  main.mode-single .dora-row .dora-label { color: #ffe080; font-weight: 700; }
  main.mode-single .dora-row .fever-inline-label { color: #ff80c0; font-weight: 700; }
  main.mode-single .dora-row .fever-inline-player { color: #ffd0e8; font-weight: 600; margin-left: 4px; }
  main.mode-single .dora-row .fever-inline-wait { display: inline-flex; align-items: center; gap: 2px; }
  main.mode-single .dora-row .fever-inline-remain { color: #ffd0e8; font-size: 11px; }
  main.mode-single .dora-row .dora-divider { color: #888; margin: 0 8px; }
  main.mode-single .fever-waits-sidebar {
    position: fixed !important;
    top: 60px !important;
    left: 16vmin !important;
    width: 240px !important;
    max-height: 30vh;
    overflow-y: auto;
    z-index: 200;
  }
  main.mode-single .fever-waits-sidebar :global(section.fever-info) {
    margin: 0;
    padding: 5px 8px;
  }
  main.mode-single .fever-waits-sidebar :global(section.fever-info h2) {
    font-size: 11px;
    margin: 0 0 4px;
  }
  main.mode-single .fever-waits-sidebar :global(.fever-row) {
    flex-direction: column;
    align-items: flex-start;
    font-size: 11px;
  }
  main.mode-single .fever-waits-sidebar :global(.wait-chip) {
    width: 100%;
    box-sizing: border-box;
    margin: 2px 0;
  }
  main.mode-single .dora-row .settings-group {
    position: static;
    justify-self: end;
    display: flex;
    flex-direction: row;
    gap: 10px;
    align-items: center;
    color: #f0f0f0;
    font-size: 13px;
    font-weight: 500;
  }
  main.mode-single .dora-row .settings-group label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    white-space: nowrap;
  }
  main.mode-single .dora-row .settings-group input[type="checkbox"] {
    width: 14px;
    height: 14px;
    accent-color: #d4af37;
  }
  main.mode-single .table-setting-btn {
    min-height: 32px;
    padding: 5px 10px;
    border: 0;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }
  main.mode-single .table-setting-btn.online { background: #5865f2; }
  main.mode-single .table-setting-btn.save { background: #4060a0; }
  main.mode-single .table-setting-btn.leave { background: #aa4040; }
  main.mode-single .table-setting-btn:hover:not(:disabled) { filter: brightness(1.15); }

  /* seat-bottom: toolbars row 上 / P0 hand 下 の 縦 stack [リョー指示 2026-05-12] */
  main.mode-single .seat-bottom {
    display: flex !important;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  main.mode-single .toolbars-row {
    display: flex;
    flex-direction: row;
    gap: 12px;
    align-items: stretch;
    justify-content: space-between;
  }
  main.mode-single .toolbar {
    flex: 0 1 240px;
    min-width: 0;
    max-width: 240px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 4px;
    color: #f4f4f4;
    font-size: 13px;
    font-weight: 500;
  }
  main.mode-single .toolbar-yellow {
    background: rgba(0, 0, 0, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.15);
  }
  /* toolbar-red は overlay 化、 黄色 button + 黒文字 [bg layer なし、 ボタンだけ] */
  main.mode-single .toolbar-red {
    position: fixed;
    right: calc(15vmin + 24px);
    bottom: calc(18vh + 20px);
    z-index: 50;
    background: transparent !important;
    border: 0 !important;
    flex: 0 0 auto;
    width: auto;
    max-width: none;
    gap: 10px;
    align-items: flex-end;
  }
  main.mode-single .toolbar-red .tb-row {
    background: transparent;
    padding: 0;
    border-radius: 0;
    gap: 8px;
  }
  main.mode-single .toolbar-red .tb-row span,
  main.mode-single .toolbar-red .tb-row .alert {
    display: none;
  }
  main.mode-single .toolbar-red .tb-row button {
    background: #ffd060 !important;
    color: #1a1820 !important;
    border: 0 !important;
    font-weight: 700;
    font-size: 16px !important;
    padding: 12px 22px !important;
    border-radius: 6px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    cursor: pointer;
  }
  main.mode-single .toolbar-red .tb-row button:hover {
    background: #ffe080 !important;
  }
  main.mode-single .toolbar .tb-row {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  /* toolbar-red の hot は bg なし [floating button のみ、 リョー指示] */
  main.mode-single .toolbar-red .tb-row.hot { background: transparent !important; padding: 0 !important; }
  main.mode-single .toolbar .tb-row button {
    font-size: 11px;
    padding: 4px 6px;
    cursor: pointer;
  }
  main.mode-single .toolbar .alert { color: #ff8060; font-weight: bold; }
  /* P0 hand: 手牌領域に スリムな dark layer [手牌の高さだけ、 上に拡張しない] */
  main.mode-single .seat-bottom > :global(section.player) {
    flex: 1 1 auto;
    min-width: 0;
    background: rgba(0, 0, 0, 0.35) !important;
    border: 0 !important;
    margin: 0 !important;
    padding: 6px 8px !important;
    border-radius: 4px;
  }
  main.mode-single .seat-bottom > :global(section.player.active) {
    background: rgba(0, 0, 0, 0.4) !important;
    /* R11 user 報告: bottom 自家 もツモ番 indicator として オレンジ border */
    border: 2px solid #ff8c1e !important;
    box-shadow: 0 0 8px rgba(255, 140, 30, 0.5);
  }
  main.mode-single .seat-bottom > :global(section.player h2) {
    display: none;
  }

  /* 抜き牌 row: 専用 grid row、 ボタン列の下 / 卓上 */
  main.mode-single .nuki-row {
    grid-area: nuki;
    display: flex;
    flex-direction: row;
    justify-content: space-around;
    gap: 1vmin;
    padding: 0 1vmin;
    z-index: 2;
  }
  main.mode-single .nuki {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 2px;
    background: rgba(255, 220, 80, 0.1);
    border: 1px solid rgba(255, 220, 80, 0.5);
    border-radius: 4px;
    padding: 3px;
    align-items: center;
    min-width: 22vmin;
    min-height: 10vmin;
    flex: 1 1 0;
  }
  main.mode-single .nuki-label {
    font-size: 14px;
    color: #ffd060;
    text-align: center;
    font-weight: 700;
    width: 100%;
    position: absolute;
    top: 4px;
    left: 0;
  }
  main.mode-single .nuki {
    position: relative;
    padding-top: 22px;
  }

  /* 左右の vertical 縦並び タイル [雀魂風] */
  main.mode-single .vplayer {
    display: flex;
    flex-direction: column;
    height: 100%;
    color: #f4f4f4;
    font-weight: 500;
    gap: 4px;
  }
  /* R11 user 報告: ツモ番 オレンジ線 を ツモ番 player に追従する 明示的 border に強化 */
  main.mode-single .vplayer { border: 2px solid transparent; border-radius: 6px; padding: 2px; transition: border-color 0.15s; }
  main.mode-single .vplayer.current { background: rgba(255, 140, 30, 0.12); border-color: #ff8c1e; box-shadow: 0 0 8px rgba(255, 140, 30, 0.5); }
  main.mode-single .vinfo {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  main.mode-single .vfeng { font-size: 24px; font-weight: 700; color: #a0d0ff; letter-spacing: 1px; }
  main.mode-single .vname { font-size: 12px; color: #e0e0e0; font-weight: 500; }
  main.mode-single .vshuvari-badge {
    display: inline-block;
    margin-left: 4px;
    padding: 1px 5px;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    background: #ff8c1e;
    border-radius: 3px;
    vertical-align: middle;
  }
  main.mode-single .vhand {
    display: flex;
    flex-direction: column;
    gap: 1px;
    align-items: center;
    overflow: hidden;
    flex: 1;
  }
  /* 左右の vplayer 縦タイル: md サイズ [32x44] を 横倒し [44x32] にして 13 枚詰める */
  main.mode-single .vhand { gap: 0; }
  main.mode-single .vtile {
    display: inline-block;
    width: 8vmin;
    height: 6vmin;
    position: relative;
    flex: 0 0 6vmin;
  }
  main.mode-single .vtile :global(.tile) {
    position: absolute;
    top: 50%;
    left: 50%;
  }
  main.mode-single .vtile.rot-l :global(.tile) {
    transform: translate(-50%, -50%) rotate(90deg);
  }
  main.mode-single .vtile.rot-r :global(.tile) {
    transform: translate(-50%, -50%) rotate(-90deg);
  }
  /* 鳴いた牌 [どこから取ったか] は横の家でも直立させて区別する [2026-07-16 リョー指示] */
  main.mode-single .vtile.rot-l.vclaimed :global(.tile),
  main.mode-single .vtile.rot-r.vclaimed :global(.tile) {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  /* solo: CPU 和了サイコロの人間確認ボタン [2026-07-16 リョー指示] */
  .cpu-sai-ack {
    position: fixed;
    left: 50%;
    bottom: 18vh;
    transform: translateX(-50%);
    z-index: 1200;
  }
  .cpu-sai-ack-btn {
    padding: 12px 22px;
    border: 2px solid #ffe89b;
    border-radius: 999px;
    background: #d4af37;
    color: #1a1820;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  }
  .cpu-sai-ack-btn:hover { background: #f0c850; }
  /* スタンプ slot bar [画面下、 手牌のすぐ上、 左から P1 / P0 / P2 固定 3 slot] */
  .stamp-slot-bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 110px;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    pointer-events: none;
    z-index: 400;
  }
  .stamp-slot {
    position: relative;
    height: 140px;
  }
  /* CPU フーロは 縦 vhand 内で 手牌の後ろに 表示、 仕切り線で 区別 */
  main.mode-single .vfulou-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 6px;
    padding-top: 4px;
    border-top: 1px dashed #888;
    gap: 0;
  }
  /* P1/P2 back tile 色: jushu 偶数=blue / 奇数=orange [リョー指示 2026-05-12] */
  main.mode-single .vtile.back-blue :global(.tile.down) {
    filter: hue-rotate(220deg) saturate(1.1);
  }
  main.mode-single .vtile.back-orange :global(.tile.down) {
    /* オレンジ寄りの黄色 [リョー指示] */
    filter: hue-rotate(60deg) saturate(1.3) brightness(1.1);
  }

  /* 左右の vertical side player [雀魂風 compact view] */
  .single-side-player {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: #e8e8e8;
    font-size: 12px;
    align-items: stretch;
    width: 100%;
  }
  .single-side-player.current {
    background: rgba(212, 175, 55, 0.18);
    border-left: 3px solid #d4af37;
    padding-left: 4px;
  }

  /* PlayerHandPanel / PlayerStatus 内部の色を 単色テーマに override */
  main.mode-single :global(.player-hand) {
    background: #143025 !important;
    border: 1px solid #2a5040 !important;
    color: #e8e8e8 !important;
    border-radius: 6px;
    padding: 6px;
    margin: 6px 0;
  }
  main.mode-single :global(.player-hand .label),
  main.mode-single :global(.player-hand .title) { color: #d4af37 !important; }
  main.mode-single :global(.player-hand .he-row),
  main.mode-single :global(.player-hand .he) {
    background: rgba(0, 0, 0, 0.3) !important;
    border-color: rgba(212, 175, 55, 0.3) !important;
  }
  /* defen 行: 暗い背景で読みやすく */
  main.mode-single :global(.defen) { background: rgba(0, 0, 0, 0.3); padding: 6px; border-radius: 6px; margin: 6px 0; }
  main.mode-single :global(.player-status) {
    background: transparent !important;
    color: #e8e8e8 !important;
  }
  main.mode-single :global(.player-status.current) {
    background: rgba(212, 175, 55, 0.18) !important;
    border-left: 3px solid #d4af37 !important;
  }
  /* action-row: 暗背景に */
  main.mode-single .action-row {
    background: rgba(0, 0, 0, 0.3);
    color: #e8e8e8;
    padding: 6px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    margin: 4px 0;
  }
  main.mode-single .action-row.hot {
    background: rgba(240, 192, 128, 0.2);
    border-color: #f0c080;
  }
  main.mode-single .action-row button {
    background: #2a5040;
    color: #fff;
    border: 1px solid #4a8068;
  }
  main.mode-single .action-row button:hover:not(:disabled) { background: #3a6050; }
  /* message panel */
  main.mode-single :global(.message),
  main.mode-single :global(.cpu-message),
  main.mode-single :global(.msg) {
    background: rgba(212, 175, 55, 0.1) !important;
    border: 1px solid rgba(212, 175, 55, 0.4) !important;
    color: #e8e8e8 !important;
  }
  /* dev モード時は seat ラッパは透明 [そのまま縦並び] */
  main:not(.mode-single) .seat { display: contents; }

  /* 手牌 tile size レスポンシブ [スマホ-first、 リョー指示 2026-05-12]
     P0 自家手牌は 14 枚で viewport 幅一杯利用するために計算式で size override */
  main.mode-single :global(.tile.size-md) {
    width: min(6vmin, calc(100vw / 22));
    height: calc(min(6vmin, calc(100vw / 22)) * 1.375);
    min-width: 16px;
    min-height: 22px;
  }
  main.mode-single :global(.tile.size-sm) {
    width: min(4.5vmin, calc(100vw / 28));
    height: calc(min(4.5vmin, calc(100vw / 28)) * 1.4);
    min-width: 18px;
    min-height: 26px;
  }
  main.mode-single :global(.tile.size-md .tile-img),
  main.mode-single :global(.tile.size-sm .tile-img) {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  main.mode-single .hez .hez-tile {
    width: 5.5vmin;
    height: 7.5vmin;
    min-width: 24px;
    min-height: 34px;
  }

  /* solo mode 統合アガリ panel [打点 + 祝儀 を 1 wrapper、 左右並び] */
  /* agari panel: 上段 局結果 全幅、 下段 祝儀 + 次局へ button 横並び [リョー指示 2026-05-12] */
  main.mode-single .agari-unified-panel {
    position: fixed;
    top: 11vh;
    bottom: 16vh;
    left: calc(15vmin + 16px);
    right: calc(15vmin + 16px);
    z-index: 1000;
    display: grid;
    grid-template-rows: 1fr auto;
    grid-template-columns: 1fr auto;
    gap: 16px;
    overflow: auto;
    background: rgba(245, 240, 220, 0.97);
    border: 2px solid #c0a040;
    border-radius: 10px;
    padding: 22px;
    color: #1a1820;
  }
  main.mode-single .agari-unified-panel .agari-left {
    grid-row: 1;
    grid-column: 1 / -1;
    overflow: auto;
  }
  /* SaiKoroModal を agari panel と同じ領域に [リョー指示 2026-05-12] */
  main.mode-single :global(.modal.sai) {
    position: fixed !important;
    top: 11vh !important;
    bottom: 16vh !important;
    left: calc(15vmin + 16px) !important;
    right: calc(15vmin + 16px) !important;
    transform: none !important;
    width: auto !important;
    height: auto !important;
    max-width: none !important;
    max-height: none !important;
    z-index: 1001 !important;
    background: rgba(245, 240, 220, 0.97) !important;
    color: #1a1820 !important;
    border: 2px solid #c0a040 !important;
    border-radius: 10px !important;
    padding: 20px !important;
    overflow: auto;
  }
  main.mode-single :global(.modal.sai *) {
    color: #1a1820 !important;
  }
  main.mode-single :global(.modal.sai .title) {
    font-size: 24px !important;
    font-weight: 700;
  }
  main.mode-single :global(.modal.sai .info) {
    font-size: 18px !important;
    opacity: 1 !important;
  }
  main.mode-single :global(.modal.sai .step) {
    font-size: 20px !important;
    font-weight: 700;
  }
  main.mode-single :global(.modal.sai .combos button),
  main.mode-single :global(.modal.sai .roll-btn) {
    background: #d4af37 !important;
    color: #1a1820 !important;
    font-weight: 700;
    padding: 12px 24px !important;
    font-size: 20px !important;
    border-radius: 6px;
    border: 0;
    cursor: pointer;
  }
  main.mode-single :global(.modal.sai .rolls) {
    font-size: 22px !important;
  }
  main.mode-single :global(.modal.sai .roll) {
    background: transparent !important;
    padding: 4px 8px !important;
    font-weight: 700;
  }
  main.mode-single :global(.modal.sai .roll.hit) { color: #2c8040 !important; }
  main.mode-single :global(.modal.sai .roll.miss) { color: #c04040 !important; }
  main.mode-single :global(.modal.sai .roll.zoro) { color: #a06010 !important; }
  main.mode-single :global(.modal.sai .result) {
    background: rgba(212, 175, 55, 0.15) !important;
    border: 1px solid #c0a040 !important;
    padding: 12px 16px !important;
  }
  main.mode-single :global(.modal.sai .result-row) {
    font-size: 20px !important;
    margin: 4px 0;
  }
  /* kinpei inline 選択 [agari panel 下部に embed、 リョー指示 2026-05-12] */
  main.mode-single .agari-unified-panel .kinpei-inline {
    grid-row: 2;
    grid-column: 1 / -1;
    background: rgba(212, 175, 55, 0.25);
    border: 2px dashed #c0a040;
    border-radius: 8px;
    padding: 14px;
    text-align: center;
  }
  main.mode-single .agari-unified-panel .kinpei-title {
    font-size: 18px;
    font-weight: 700;
    color: #806000;
    margin-bottom: 10px;
  }
  main.mode-single .agari-unified-panel .kinpei-btns {
    display: flex;
    justify-content: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  main.mode-single .agari-unified-panel .kinpei-btn {
    padding: 10px 24px;
    font-size: 18px;
    font-weight: 700;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    color: #fff;
  }
  main.mode-single .agari-unified-panel .kinpei-btn.haru { background: #c0a060; }
  main.mode-single .agari-unified-panel .kinpei-btn.natsu { background: #40a040; }
  main.mode-single .agari-unified-panel .kinpei-btn.aki { background: #c06040; }
  main.mode-single .agari-unified-panel .kinpei-btn.fuyu { background: #4080c0; }
  main.mode-single .agari-unified-panel .kinpei-btn.hold { background: #888; }

  main.mode-single .agari-unified-panel .chip-transfer {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-right: 16px;
    font-size: 16px;
    color: #1a1820;
  }
  main.mode-single .agari-unified-panel .ct-row {
    background: rgba(212, 175, 55, 0.2);
    padding: 4px 12px;
    border-radius: 4px;
    font-weight: 700;
  }
  main.mode-single .agari-unified-panel .agari-actions {
    grid-row: 2;
    grid-column: 1 / -1;
    flex: 0 0 auto;
    padding: 0;
    border: 0;
    justify-self: end;
    align-self: end;
    display: flex;
    flex-direction: row;
    gap: 8px;
    align-items: center;
  }
  main.mode-single .agari-unified-panel .agari-actions button {
    padding: 8px 20px !important;
    font-size: 14px !important;
    font-weight: 700;
    width: auto !important;
    height: auto !important;
    min-width: 0 !important;
  }
  main.mode-single .agari-unified-panel .agari-actions {
    flex: 1 1 100%;
    display: flex;
    justify-content: center;
    gap: 12px;
    padding-top: 8px;
    border-top: 1px solid rgba(212, 175, 55, 0.4);
  }
  main.mode-single .agari-unified-panel .agari-actions button {
    padding: 8px 24px;
    font-size: 14px;
    font-weight: bold;
    border-radius: 6px;
    cursor: pointer;
    background: #d4af37;
    color: #1a3a2a;
    border: 0;
  }
  main.mode-single .agari-unified-panel .agari-left {
    flex: 1.5 1 0;
    min-width: 400px;
  }
  /* unified panel 内の section / chip-breakdown は ボーダー / 背景 撤去 で
     入れ子 window 感を解消 [リョー指示 2026-05-12]、 内部 text 大きく */
  main.mode-single .agari-unified-panel :global(section),
  main.mode-single .agari-unified-panel :global(.chip-breakdown) {
    position: static !important;
    z-index: auto !important;
    background: transparent !important;
    border: 0 !important;
    box-shadow: none !important;
    padding: 0 !important;
    margin: 0 !important;
    max-width: none !important;
    max-height: none !important;
    color: #f8f8f8 !important;
  }
  /* 局結果 / 祝儀 [リョー指示 2026-05-12: 全 text 黒で統一] */
  main.mode-single .agari-unified-panel,
  main.mode-single .agari-unified-panel :global(*) {
    color: #1a1820 !important;
  }
  main.mode-single .agari-unified-panel :global(h2) {
    font-size: 26px !important;
    margin: 0 !important;
  }
  main.mode-single .agari-unified-panel :global(.winner) {
    font-size: 26px !important;
    font-weight: 700;
  }
  main.mode-single .agari-unified-panel :global(.defen) {
    font-size: 24px !important;
    font-weight: 700;
  }
  main.mode-single .agari-unified-panel :global(.score) {
    font-size: 20px !important;
  }
  main.mode-single .agari-unified-panel :global(.yaku-list) {
    margin: 10px 0 !important;
    gap: 6px !important;
  }
  main.mode-single .agari-unified-panel :global(.yaku-chip) {
    color: #503000 !important;
    background: rgba(212, 175, 55, 0.2) !important;
    border-color: rgba(180, 130, 30, 0.7) !important;
    font-size: 17px !important;
    padding: 5px 12px !important;
  }
  main.mode-single .agari-unified-panel :global(.dora-row),
  main.mode-single .agari-unified-panel :global(.fuyu-row),
  main.mode-single .agari-unified-panel :global(.payment-row) {
    margin-top: 10px !important;
  }
  main.mode-single .agari-unified-panel :global(.dora-label),
  main.mode-single .agari-unified-panel :global(.fuyu-label),
  main.mode-single .agari-unified-panel :global(.payment-label) {
    color: #444 !important;
    font-size: 16px !important;
    font-weight: 700;
  }
  main.mode-single .agari-unified-panel :global(.payment-cell) {
    font-size: 18px !important;
    padding: 5px 14px !important;
    font-weight: 700;
  }
  main.mode-single .agari-unified-panel :global(.fuyu-sum) {
    font-size: 16px !important;
    font-weight: 700;
    color: #2050a0 !important;
  }
  main.mode-single .agari-unified-panel :global(.fuyu-tile) {
    font-size: 14px;
  }
  /* 祝儀 [chip-breakdown] 拡大 + 2 列 [リョー指示 2026-05-12] */
  main.mode-single .agari-unified-panel :global(.chip-breakdown) {
    font-size: 19px !important;
    line-height: 1.8;
    color: #1a1820 !important;
    column-count: 2;
    column-gap: 32px;
    margin-top: 12px;
  }
  main.mode-single .agari-unified-panel :global(.chip-breakdown *) {
    font-size: inherit !important;
    color: #1a1820 !important;
  }
  main.mode-single .agari-unified-panel :global(.chip-breakdown .row) {
    break-inside: avoid;
    padding: 2px 0;
  }
  /* 次局へ button 拡大 [リョー指示] */
  main.mode-single .agari-unified-panel .agari-actions button {
    padding: 14px 36px !important;
    font-size: 18px !important;
    font-weight: 700;
    width: auto !important;
    height: auto !important;
    min-width: 0 !important;
  }

  /* hule-panel / chip-breakdown は agari-unified-panel 内では transparent
     [agari-unified-panel 自体の cream bg を活かす、 リョー指示 2026-05-12] */

  /* 全般 text contrast 強化 [リョー指示 2026-05-12] */
  main.mode-single :global(*) { color: inherit; }
  main.mode-single { color: #e8e8e8 !important; }
  main.mode-single :global(header) { color: #e8e8e8 !important; }
  main.mode-single :global(header *) { color: inherit; }
  main.mode-single :global(header h1) { color: #ffd060 !important; }
  /* HeaderInfo の場/局/本場/供託/山残/ドラ表/現家/直ツモ */
  main.mode-single :global(.header-info),
  main.mode-single :global(.header-info *) { color: #e8e8e8 !important; }
  main.mode-single :global(.header-info .label) { color: #b0b0b0 !important; }
  main.mode-single :global(.header-info .changbang),
  main.mode-single :global(.header-info .jushu) { color: #ffd060 !important; }
  /* 河 label / 段位や向聴 等の小 label */
  main.mode-single :global(.label) { color: #b0b0b0 !important; }
  /* defen 行 + PlayerStatus */
  main.mode-single :global(.player-status .defen),
  main.mode-single :global(.player-status .score-val) { color: #ffd060 !important; }
  main.mode-single :global(.player-status .feng) { color: #80c0ff !important; }
  /* action-row label */
  main.mode-single :global(.row-label) { color: #b0b0b0 !important; }
  main.mode-single :global(.row-label.alert) { color: #ff8060 !important; }
  /* hint */
  main.mode-single :global(.hint) { color: #888 !important; }
  /* CPU checkbox label */
  main.mode-single :global(.cpu-toggles),
  main.mode-single :global(.cpu-toggles label) { color: #e8e8e8 !important; }
  /* 場/局/本場/供託/山残 直 リテラル text in HeaderInfo */
  main.mode-single :global(.changbang-label),
  main.mode-single :global(.benbang-label),
  main.mode-single :global(.lizhibang-label),
  main.mode-single :global(.paishu-label) { color: #b0b0b0 !important; }

  /* 狭い横画面では操作欄をアイコン中心にし、ドラ表示との重なりを防ぐ。 */
  @media (max-width: 900px) and (orientation: landscape) {
    main.mode-single {
      grid-template-columns: 15vmin minmax(0, 1fr) 15vmin;
      gap: 4px;
    }
    main.mode-single .dora-row {
      grid-template-columns: auto minmax(56px, 1fr) auto;
      gap: 5px;
      padding: 2px 4px;
    }
    main.mode-single .turn-status {
      max-width: 150px;
      padding: 3px 7px;
      gap: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 11px;
    }
    main.mode-single .dora-main { gap: 3px; }
    main.mode-single .dora-label { font-size: 11px; }
    main.mode-single .dora-row .settings-group {
      gap: 6px;
      font-size: 11px;
    }
    main.mode-single .dora-row .settings-group label { gap: 2px; }
    main.mode-single .dora-row .settings-group input[type="checkbox"] {
      width: 16px;
      height: 16px;
    }
    main.mode-single .table-setting-btn {
      min-width: 34px;
      min-height: 32px;
      padding: 4px 8px;
    }
    main.mode-single .settings-label { display: none; }
  }

  /* 高さの低いスマホ横画面でも、中央得点と自家手牌を画面内へ収める。 */
  @media (max-height: 500px) and (orientation: landscape) {
    /* 手牌最優先 [2026-07-15 Galaxy S24 実機報告]: 実効高 ~340px では
     * score-box の min 200px が場を食い潰し、自家手牌の行が viewport 外へ
     * 押し出されて全く見えなくなる。中央行を minmax(0,1fr) で圧縮可能にし、
     * 中央スコアの正方形は 34vmin まで縮める。 */
    main.mode-single {
      grid-template-rows: auto auto auto minmax(0, 1fr) auto;
    }
    main.mode-single .center-board { min-height: 0; }
    main.mode-single .nuki-row { padding: 1px 4px; gap: 2px; }
    main.mode-single .seat-bottom { min-height: 42px; }
    /* 和了パネル: 低背だと 11vh/16vh 挟みで窓が~200pxになり、役・祝儀の
     * 計算式がスクロール下に沈んで「出ない」ように見える。ほぼ全画面化する */
    main.mode-single .agari-unified-panel,
    main.mode-single :global(.modal.sai) {
      top: 8px !important;
      bottom: 8px !important;
      left: 8px !important;
      right: 8px !important;
      padding: 10px 12px !important;
      gap: 8px !important;
    }
    main.mode-single .score-box {
      grid-template-columns: minmax(62px, 1fr) minmax(66px, 0.9fr) minmax(62px, 1fr);
      grid-template-rows: 28px minmax(0, 1fr) minmax(68px, 0.9fr);
      width: max(34vmin, 118px);
      height: max(34vmin, 118px);
      min-width: 0;
      min-height: 0;
    }
    main.mode-single .score-box .score-side.score-top {
      padding: 3px 0;
      font-size: 14px;
    }
    main.mode-single .score-box .score-side.score-left,
    main.mode-single .score-box .score-side.score-right { padding: 2px; }
    main.mode-single .score-box .score-side.score-bottom {
      align-self: stretch;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 1px 3px;
    }
    main.mode-single .score-box .sname { font-size: 13px; letter-spacing: 0; }
    main.mode-single .score-box .sval { font-size: 18px; letter-spacing: 0; }
    main.mode-single .score-box .ssub { margin-top: 1px; font-size: 10px; line-height: 1.05; }
    main.mode-single .score-box .score-side.is-oya .sname::before {
      margin-bottom: 0;
      font-size: 12px;
    }
    main.mode-single .score-box .benbang { font-size: 14px; }
    main.mode-single .score-box .paishu { font-size: 17px; }
    main.mode-single .seat-bottom { gap: 2px; }
    main.mode-single .seat-bottom > :global(section.player) { padding: 2px 4px !important; }
  }

  /* スマホ縦向きでは卓が欠けるため、誤操作できる半端な盤面を見せず案内する。 */
  @media (max-width: 700px) and (orientation: portrait) {
    main.mode-single .orientation-notice {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 32px;
      box-sizing: border-box;
      background: radial-gradient(circle at center, #2f604b 0%, #143025 75%);
      color: #fff;
      text-align: center;
    }
    main.mode-single .orientation-notice::before {
      content: '↻';
      color: #ffd060;
      font-size: 64px;
      line-height: 1;
    }
    main.mode-single .orientation-notice strong {
      color: #ffd060;
      font-size: 22px;
    }
    main.mode-single .orientation-notice span {
      color: #d8e4df;
      font-size: 14px;
    }
  }

  .debug-btn {
    background: #ddd;
    color: #555;
    border: 1px dashed #888;
    border-radius: 3px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
    margin-left: 4px;
  }

  .pochi-choice-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9400;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgba(5, 17, 12, 0.72);
  }
  .pochi-choice-modal {
    width: min(720px, calc(100vw - 32px));
    max-height: min(82vh, 760px);
    overflow: auto;
    box-sizing: border-box;
    padding: 18px;
    border: 2px solid #e9c95c;
    border-radius: 14px;
    background: #f8f4e7;
    color: #173126;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.45);
    text-align: center;
  }
  .pochi-choice-modal h2,
  .pochi-choice-modal p {
    margin: 0 0 10px;
  }
  .pochi-choice-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(62px, 1fr));
    gap: 8px;
  }
  .pochi-choice-tile {
    min-height: 74px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 5px;
    border: 1px solid #a88b32;
    border-radius: 8px;
    background: #fffdf5;
    cursor: pointer;
  }
  .pochi-choice-tile:hover,
  .pochi-choice-tile:focus-visible {
    outline: 3px solid #e0b928;
    background: #fff5c6;
  }
  .pochi-choice-tile small {
    color: #584b20;
    font-size: 10px;
  }
</style>
