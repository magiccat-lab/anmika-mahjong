
// CPU 自動進行 action [cpuStep / autoAdvance] を store.ts から抜出 [2026-05-12]
// pure function: state → state、 store.ts 側は update(s => cpuStepImpl(s)) で呼ぶ
// closure を切るため innerDiscard / formatHuleResult を store.ts から import

import type { StoreState } from '../store';
import {
  innerDiscard,
  formatHuleResult,
  triggerSaiKoroIfAny,
  applyPingjuTransition,
  enqueueCutinState,
  beginNukiBei,
  confirmPendingFeverBeforeDraw,
  enterFuyuKamiPochiStage,
  resolvePreSettlementPochiChoices,
} from '../store';
import { toCorePai } from '../helpers';
import { enterFeverContinueStage } from './winPipeline';
import { decideCpuShuvari } from './cpuShuvari';
import { pickLizhiDapai } from './cpuLizhi';

function hasBlockingDecision(s: StoreState): boolean {
  return s.roundEnded
    || s.pendingPingju
    || s.awaitingRonDecision
    || s.awaitingFulou
    || s.pendingQianggang !== null
    || s.pendingFuyu !== null
    || s.pendingKamiPochi !== null
    || s.pendingPochiSwap !== null
    || s.pendingKinpei !== null
    || s.pendingSaiKoro !== null
    || s.pendingFeverContinue !== null
    || s.pendingNukiBei != null
    || s.lizhiPending !== null;
}

/** CPU 自動進行: 現家が CPU なら ツモ切り、 ループ */
export function cpuStepImpl(initial: StoreState): StoreState {
  let s = initial;
  let safety = 0;
  while (safety < 100) {
    if (hasBlockingDecision(s)) break;
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    if (!s.cpu[cur as 0 | 1 | 2]) break;
    if (s.game.canTsumo(cur)) {
      // R4 P1 #12 fix: saveSnapshot は hule() より 先
      s.game.saveSnapshot();
      let result = s.game.hule(cur);
      // 秋で今回初めて表示された華も、CPU の金北自動選択候補に含める。
      const resolvedHuapai = s.game.effectiveHuapaiAtHule(cur);
      if (result
        && (s.game.goldHand[cur].z > 0 || (s.game.nukidoraGold[cur] ?? 0) > 0)
        && s.game.kinpeiTarget[cur] === null
        && resolvedHuapai.length > 0) {
        s.game.restoreSnapshot();
        s.game.autoResolveKinpei(cur as any, resolvedHuapai);
        // Subsequent pochi-choice rewinds must retain the chosen Kinpei target.
        s.game.saveSnapshot();
        result = s.game.hule(cur);
      }
      // R8 P1 #9 fix: hule() が null [canTsumo の false positive] なら和了確定させない、
      // 通常進行へ fallback。 旧 code は null result で lastWinner / roundEnded を進めて局破壊
      if (!result) {
        s.message = `[CPU] player ${cur} ツモ和了 失敗 [hule null]、 通常打牌 へ`;
        s.game.restoreSnapshot();
        // 続行 = ループ脱出せず 通常 cpuStep へ進む [break しない]
      } else {
        const choice = resolvePreSettlementPochiChoices(
          s,
          result,
          { winner: cur, isRon: false, ronfrom: null },
          () => s.game.hule(cur),
        );
        if (choice.pending) break;
        result = choice.result;
        if (!result) {
          s.message = `[CPU] player ${cur} 神ぽっち選択後の再計算失敗`;
          break;
        }
        s.game.applyHule(result, cur, null);
        s.message = `🎉 [CPU] player ${cur} ツモ和了！ ${formatHuleResult(result)}`;
        s.lastHuleResult = result;
        s.lastWinner = cur;
        s.ronResults = [];
        if (enterFuyuKamiPochiStage(s, { winner: cur, isRon: false, ronfrom: null })) break;
        s = enqueueCutinState(s, 'tsumo', cur as 0 | 1 | 2);
        s = triggerSaiKoroIfAny(s, result, cur);
        // [2026-07-16 リョー指示] CPU 和了のサイコロは人間の確認 [ackCpuWin] まで自動進行しない
        if (s.pendingSaiKoro) s.cpuWinAck = false;
        const isFever = s.game.feverActive[cur];
        if (isFever) {
          s.game.feverWinCount[cur] += 1;
          s.roundEnded = false;
          if (!s.pendingFeverContinue) {
            enterFeverContinueStage(s, { winner: cur, isRon: false });
          }
        } else {
          s.roundEnded = true;
          // [2026-07-17 リョー指摘: リーチ白ツモで勝手に上がって次へ行った]
          // サイコロ無しの素の和了も 3 秒 auto-advance で判定表示ごと飛んでいた。
          // 局終了時は必ず人間の確認 [次局へ or ackCpuWin] まで止める。
          // fever 続行 [roundEnded=false] は手が続くためここで ack を要求しない
          s.cpuWinAck = false;
        }
        break;
      }
    }
    if (s.lastZimo && toCorePai(s.lastZimo) === 'z4' && s.game.canNukiBei(cur)) {
      const drawnNorth = s.lastZimo;
      s = beginNukiBei(s, cur, {
        gold: drawnNorth === 'gN' || s.game.shan.lastZimoGold,
      });
      if (s.awaitingRonDecision) break;
      if (s.roundEnded) break;
      if (s.lastZimo == null) {
        // R5 P1 #5 fix: applyPingjuTransition で 罰符 / 流し役満 / snapshot を 通常流局と揃える
        s = applyPingjuTransition(s, `🌀 流局 [CPU 北抜きで王牌枯渇]`);
        break;
      }
      safety++;
      continue;
    }
    const forcedLizhiKan = s.game.getForcedLizhiKanCandidates(cur);
    if (forcedLizhiKan.length > 0) {
      const replacement = s.game.declareKan(cur, forcedLizhiKan[0]);
      if (!replacement) {
        s.message = `[CPU] player ${cur} 強制カン失敗 [${forcedLizhiKan[0]}]`;
        break;
      }
      s.lastZimo = replacement;
      s.message = `[CPU 強制カン] player ${cur} 暗槓 [${forcedLizhiKan[0]}]、 嶺上 ${replacement}`;
      safety++;
      continue;
    }
    let declaredLizhiDapai: string | null = null;
    if (s.game.canLizhi(cur)) {
      // この卓では通常の面前ダマ和了は禁止。残り山やぽっち倍率を理由に
      // リーチを見送ると、CPUだけが自ら和了不能な状態を選んでしまう。
      // また、他家の伏せ牌を数えて待ち残数を判断するのはオンラインの
      // 公平性にも反するため、リーチ可能なら公開情報に依存せず宣言する。
      const spForFever = s.game.shoupai.get(cur);
      // _zimo is a majiang-core face.  The expanded draw is retained in
      // _anmikaZimo and must win here, otherwise np3 is looked up as p3 and a
      // Rainbow-FEVER-breaking discard can be declared.
      const rawZimo = typeof spForFever?._anmikaZimo === 'string'
        ? spForFever._anmikaZimo.replace(/_$/, '')
        : typeof spForFever?._zimo === 'string'
          ? spForFever._zimo.replace(/_$/, '')
          : null;
      const zimoPai = rawZimo && rawZimo.length <= 3 ? rawZimo : null;
      const lizhiCandidates = s.game.getLizhiCandidates(cur);
      const lizhiCandidateSet = new Set(lizhiCandidates.map((pai) => pai.replace(/[_*]$/, '')));
      let declared = false;
      let declaredFever = false;
      const feverMap = s.game.feverCandidatesByDapai(cur);
      const legalFeverCandidates = [...feverMap.keys()]
        .filter((pai) => lizhiCandidateSet.has(pai.replace(/[_*]$/, '')));
      const feverDapai = zimoPai && legalFeverCandidates.includes(zimoPai)
        ? zimoPai
        : (legalFeverCandidates[0] ?? null);
      // [2026-07-20 リョー指示] 高い手はシュバる。シュバは半荘 1 回の切り札なので、
      // 見込み祝儀が基準を超えた時だけ切る [decideCpuShuvari]
      let shuvariNote: string | null = null;
      if (feverDapai) {
        const fc = feverMap.get(feverDapai);
        if (fc) {
          const sd = decideCpuShuvari(s.game, cur, { discardPai: feverDapai, feverTier: fc.tier });
          declared = s.game.declareLizhi({ fever: true, feverCheck: fc, feverDapai, shuvari: sd.shuvari });
          declaredFever = declared;
          if (declared) {
            declaredLizhiDapai = feverDapai;
            if (sd.shuvari) shuvariNote = `シュバ [見込み ${sd.score} 枚]`;
          }
        }
      }
      if (!declared) {
        // [2026-07-20] 宣言牌は待ちの広い方を選ぶ。旧実装は候補の先頭固定だった
        const picked = pickLizhiDapai(s.game, cur, lizhiCandidates);
        const plainDapai = picked.pai;
        const sd = decideCpuShuvari(s.game, cur, { discardPai: plainDapai });
        declared = s.game.declareLizhi({ shuvari: sd.shuvari });
        if (declared) {
          declaredLizhiDapai = plainDapai;
          if (sd.shuvari) shuvariNote = `シュバ [見込み ${sd.score} 枚]`;
        }
      }
      if (declared && shuvariNote) {
        s.message = `[CPU リーチ] player ${cur} ${shuvariNote}`;
      }
      if (declared) {
        s = enqueueCutinState(s, declaredFever ? 'fever' : 'reach', cur as 0 | 1 | 2);
      }
    }
    const curSp = s.game.shoupai.get(cur);
    if (curSp?._zimo == null) {
      s = confirmPendingFeverBeforeDraw(s);
      if (s.pendingPingju || s.roundEnded) break;
      if (s.game.shan.paishu > 0) {
        try {
          const z = s.game.zimo();
          if (z != null) {
            s.lastZimo = z;
            safety++;
            continue;
          }
        } catch { /* zimo throw、 流局へ */ }
      }
      // R10 P0 #8 fix: applyPingjuTransition 経由で 罰符 / 流し役満 / snapshot を 適用、
      // 他の流局 path と統一
      s = applyPingjuTransition(s, '🌀 流局 [zimo 不可、 強制終了]:');
      break;
    }
    // [2026-07-16 リョー指示] 配牌由来で手牌に滞留した北 [z4] も抜く。
    // ツモ直後の北は loop 先頭の lastZimo 分岐が処理する。フィーバー中の
    // 「ツモ牌のみ可」等の制限は canNukiBei が内部で見る
    // A declaration is already charged and bound to one exact physical
    // discard.  Do not alter the hand with a held-North extraction before
    // committing that tile; the replacement draw can invalidate the chosen
    // declaration shape and leave lizhiDeclareDapai stuck.
    if (declaredLizhiDapai === null && s.game.canNukiBei(cur)) {
      s = beginNukiBei(s, cur);
      if (s.awaitingRonDecision) break;
      if (s.roundEnded) break;
      if (s.lastZimo == null) {
        s = applyPingjuTransition(s, `🌀 流局 [CPU 北抜きで王牌枯渇]`);
        break;
      }
      s.message = `[CPU 北抜き] player ${cur}、 代替ツモ`;
      safety++;
      continue;
    }
    // CPU 暗槓 / 加槓 [ゆーま 2026-05-14 自走]:
    //   - 三元牌 [z5-z7] の 4 枚揃いのみ auto-ankan、 yakuhai 1 役 + 新ドラ確定で正収益
    //   - 風牌 / 数牌 はスルー [新ドラ で他家への 与ドラ リスクを許容しない 保守設計]
    //   - majiang-core 側で 形崩れ filter は通る前提 [getKanCandidates の get_gang_mianzi]
    //   - 副露直後 [_zimo が mianzi 文字列、 length>3] は kan 不可 [実 tile 無いため skip]
    let didKan = false;
    const _zimoLen = typeof curSp?._zimo === 'string' ? curSp._zimo.length : 0;
    if (declaredLizhiDapai === null && _zimoLen > 0 && _zimoLen <= 3) {
      try {
        const kanMianzis = s.game.getKanCandidates(cur);
        for (const m of kanMianzis) {
          // m is a core mianzi string, not an expanded physical tile name.
          const head = `${m[0]}${m[1]}`;
          if (head === 'z5' || head === 'z6' || head === 'z7') {
            const repl = s.game.declareKan(cur, m);
            if (repl) {
              s.lastZimo = repl;
              s.message = `[CPU 自動カン] player ${cur} 暗槓 [${m}]、 嶺上 ${repl}`;
              didKan = true;
              break;
            }
          }
        }
      } catch { /* skip kan, fall through to discard */ }
    }
    if (didKan) { safety++; continue; }
    // Once riichi has been charged, the same step must commit one of the
    // declaration candidates.  A general efficiency pick may break tenpai;
    // FEVER additionally requires the exact physical candidate evaluated
    // above, not merely a core-equal tile.
    const best = declaredLizhiDapai ?? s.game.pickBestDiscard(cur);
    let dapai: string | null = null;
    if (best) dapai = best;
    else if (typeof curSp._zimo === 'string' && curSp._zimo.length <= 3 && toCorePai(curSp._zimo) !== 'z4') {
      dapai = curSp._zimo;
    } else {
      try {
        const cands: string[] = (curSp as any).get_dapai?.(false) ?? [];
        const legal = cands.find((c: string) => toCorePai(c.replace(/_$/, '')) !== 'z4');
        if (legal) dapai = legal.replace(/_$/, '');
      } catch { /* ignore */ }
    }
    if (!dapai) break;
    const pure = dapai.replace(/_$/, '');
    s = innerDiscard(s, pure);
    if ((s as any)._lastDapaiFailed) break;
    safety++;
    // [2026-07-16 リョー指示: 演出同期] このループ中に cutin [リーチ/フィーバー等] が
    // 積まれたら手番を進めず一旦止める。演出が終わると App 側 driver [cutin gate 付き]
    // が再スケジュールするので、演出と局面が同期して見える
    if (s.cutin || (s.cutinQueue?.length ?? 0) > 0) break;
    // フィーバー中は1ターンずつ止めて UI に見せる
    const anyFever = ([0, 1, 2] as const).some((p) => s.game.feverActive[p]);
    if (anyFever) break;
  }
  return { ...s };
}

/** 自動進行: ツモ切り loop で局終了 or 何かイベント発生まで進める */
export function autoAdvanceImpl(initial: StoreState): StoreState {
  let s = initial;
  let safetyCount = 0;
  while (
    !hasBlockingDecision(s) &&
    // [2026-07-16 演出同期] cutin 再生中は自動進行しない
    !s.cutin && (s.cutinQueue?.length ?? 0) === 0 &&
    s.lastZimo &&
    safetyCount < 100
  ) {
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    if (s.game.canTsumo(cur)) break;
    const someoneFever = ([0, 1, 2] as const).some((p) => s.game.feverActive[p]);
    if ((someoneFever || s.game.lizhi.has(cur)) && s.lastZimo && toCorePai(s.lastZimo) === 'z4' && s.game.canNukiBei(cur)) {
      const drawnNorth = s.lastZimo;
      s = beginNukiBei(s, cur, {
        gold: drawnNorth === 'gN' || s.game.shan.lastZimoGold,
      });
      if (s.awaitingRonDecision) break;
      if (s.roundEnded) break;
      if (s.lastZimo == null) {
        // R5 P1 #5 fix: applyPingjuTransition で 通常流局と揃える
        s = applyPingjuTransition(s, `🌀 流局 [自動進行で王牌枯渇]`);
        break;
      }
      safetyCount++;
      continue;
    }
    s = innerDiscard(s, s.lastZimo);
    if ((s as any)._lastDapaiFailed) break;
    // フィーバー中は1ターンずつ止める
    if (someoneFever) break;
    safetyCount++;
  }
  return { ...s };
}
