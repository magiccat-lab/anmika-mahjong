
// CPU 自動進行 action [cpuStep / autoAdvance] を store.ts から抜出 [2026-05-12]
// pure function: state → state、 store.ts 側は update(s => cpuStepImpl(s)) で呼ぶ
// closure を切るため innerDiscard / formatHuleResult を store.ts から import

import type { StoreState } from '../store';
import { innerDiscard, formatHuleResult, triggerSaiKoroIfAny, applyPingjuTransition, enqueueCutinState } from '../store';
import { toCorePai } from '../helpers';
import { enterFeverContinueStage } from './winPipeline';

function hasBlockingDecision(s: StoreState): boolean {
  return s.roundEnded
    || s.pendingPingju
    || s.awaitingRonDecision
    || s.awaitingFulou
    || s.pendingQianggang !== null
    || s.pendingFuyu !== null
    || s.pendingKinpei !== null
    || s.pendingSaiKoro !== null
    || s.pendingFeverContinue !== null
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
        result = s.game.hule(cur);
      }
      // R8 P1 #9 fix: hule() が null [canTsumo の false positive] なら和了確定させない、
      // 通常進行へ fallback。 旧 code は null result で lastWinner / roundEnded を進めて局破壊
      if (!result) {
        s.message = `[CPU] player ${cur} ツモ和了 失敗 [hule null]、 通常打牌 へ`;
        s.game.restoreSnapshot();
        // 続行 = ループ脱出せず 通常 cpuStep へ進む [break しない]
      } else {
        s.game.applyHule(result, cur, null);
        s.message = `🎉 [CPU] player ${cur} ツモ和了！ ${formatHuleResult(result)}`;
        s.lastHuleResult = result;
        s.lastWinner = cur;
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
        }
        break;
      }
    }
    if (s.lastZimo && toCorePai(s.lastZimo) === 'z4' && s.game.canNukiBei(cur)) {
      const replacement = s.game.declareNukiBei(cur);
      s.lastZimo = replacement ?? null;
      if (replacement == null) {
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
    if (s.game.canLizhi(cur)) {
      // CPU リーチ 戦略性 [リョー指示 2026-05-14 CPU 打牌精度向上]:
      //   - 待ち牌が 山 + 他家手 で 0 枚 [枯渇] なら 見送り [リーチ供託の無駄打ち回避]
      //   - 待ち 1 枚以上 残ってる時のみ宣言
      const ting = s.game.getTingpaiList(cur);
      let totalRemaining = 0;
      for (const t of ting) {
        // 単純化: 山 paishu の中に対象牌が含まれる可能性、 厳密 count は重いので
        // 全 player 手牌 + 河 で見えた枚数を差し引いて推定
        const base = t.replace(/[\+=\-_*]/g, '').slice(0, 2);
        const s_ = base[0]; const n_ = base[1] === '0' ? 5 : parseInt(base[1]);
        if (!s_ || !Number.isFinite(n_)) continue;
        let visible = 0;
        for (const p of [0, 1, 2] as const) {
          const sp = s.game.shoupai.get(p);
          if (!sp) continue;
          visible += (sp._bingpai?.[s_]?.[n_] ?? 0);
          const he = s.game.he.get(p);
          for (const d of (he?._pai ?? [])) {
            const dStripped = (d as string).replace(/[\+=\-_*]/g, '').slice(0, 2);
            if (dStripped === base) visible++;
          }
        }
        // 各牌 4 枚 [z5 は 4 色合計 4 枚]、 max は常に 4 で同じ
        totalRemaining += Math.max(0, 4 - visible);
      }
      // ダマ判断 [2026-05-21 ゆーま 自走 CPU 教育]:
      //   - 自家 pochiMultiplier abs >= 4 [既に高倍率]: ダマで リーチ棒 1000 損失避ける
      //   - 残山 <=4 [終盤]: 流局リスク高、 リーチ棒投入 negative EV
      const selfPochiAbs = Math.abs(s.game.pochiMultiplier?.[cur]?.chip ?? 1);
      const remainingWall = s.game.shan?.paishu ?? 0;
      const damaPreferred = selfPochiAbs >= 4 || remainingWall <= 4;
      if (totalRemaining > 0 && !damaPreferred) {
        // [2026-07-16 リョー指示] CPU にもフィーバーリーチの選択肢を持たせる。
        // 7 の暗刻/暗槓 [フィーバー種] が成立していれば fever 宣言を優先し、
        // 宣言が通らなければ通常リーチに fallback [declareLizhi 内の validation に委ねる]
        const feverCheck = s.game.canFeverLizhi(cur);
        let declared = false;
        if (feverCheck.ok) {
          declared = s.game.declareLizhi({ fever: true, feverCheck });
        }
        if (!declared) declared = s.game.declareLizhi({});
        if (declared) {
          s = enqueueCutinState(s, 'reach', cur as 0 | 1 | 2);
        }
      }
    }
    const curSp = s.game.shoupai.get(cur);
    if (curSp?._zimo == null) {
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
    if (s.game.canNukiBei(cur)) {
      const replacement = s.game.declareNukiBei(cur);
      if (replacement == null) {
        s = applyPingjuTransition(s, `🌀 流局 [CPU 北抜きで王牌枯渇]`);
        break;
      }
      s.lastZimo = replacement;
      s.message = `[CPU 北抜き] player ${cur}、 代替ツモ`;
      safety++;
      continue;
    }
    // CPU 暗槓 / 加槓 [ゆーま 2026-05-14 自走]:
    //   - 三元牌 [z5-z7] の 4 枚揃いのみ auto-ankan、 yakuhai 1 役 + 新ドラ確定で正収益
    //   - 風牌 / 数牌 はスルー [新ドラ で他家への 与ドラ リスクを許容しない 保守設計]
    //   - majiang-core 側で 形崩れ filter は通る前提 [getKanCandidates の get_gang_mianzi]
    //   - 副露直後 [_zimo が mianzi 文字列、 length>2] は kan 不可 [実 tile 無いため skip]
    let didKan = false;
    const _zimoLen = typeof curSp?._zimo === 'string' ? curSp._zimo.length : 0;
    if (_zimoLen > 0 && _zimoLen <= 2) {
      try {
        const kanMianzis = s.game.getKanCandidates(cur);
        for (const m of kanMianzis) {
          const head = m.slice(0, 2);
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
    const best = s.game.pickBestDiscard(cur);
    let dapai: string | null = null;
    if (best) dapai = best;
    else if (typeof curSp._zimo === 'string' && curSp._zimo.length <= 2 && curSp._zimo !== 'z4') {
      dapai = curSp._zimo;
    } else {
      try {
        const cands: string[] = (curSp as any).get_dapai?.(false) ?? [];
        const legal = cands.find((c: string) => !c.startsWith('z4'));
        if (legal) dapai = legal.replace(/_$/, '');
      } catch { /* ignore */ }
    }
    if (!dapai) break;
    const pure = dapai.replace(/_$/, '');
    s = innerDiscard(s, pure);
    if ((s as any)._lastDapaiFailed) break;
    safety++;
  }
  return { ...s };
}

/** 自動進行: ツモ切り loop で局終了 or 何かイベント発生まで進める */
export function autoAdvanceImpl(initial: StoreState): StoreState {
  let s = initial;
  let safetyCount = 0;
  while (
    !hasBlockingDecision(s) &&
    s.lastZimo &&
    safetyCount < 100
  ) {
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    if (s.game.canTsumo(cur)) break;
    const someoneFever = ([0, 1, 2] as const).some((p) => s.game.feverActive[p]);
    if ((someoneFever || s.game.lizhi.has(cur)) && s.lastZimo && toCorePai(s.lastZimo) === 'z4' && s.game.canNukiBei(cur)) {
      const replacement = s.game.declareNukiBei(cur);
      s.lastZimo = replacement ?? null;
      if (replacement == null) {
        // R5 P1 #5 fix: applyPingjuTransition で 通常流局と揃える
        s = applyPingjuTransition(s, `🌀 流局 [自動進行で王牌枯渇]`);
        break;
      }
      safetyCount++;
      continue;
    }
    s = innerDiscard(s, s.lastZimo);
    if ((s as any)._lastDapaiFailed) break;
    safetyCount++;
  }
  return { ...s };
}
