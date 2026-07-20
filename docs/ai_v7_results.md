> **注意 [2026-07-20]**: このファイルは v7 / v8 時点の記録で止まっている。
> 実装は既に v11 / v12 相当まで進んでおり、末尾の「v9 改善案」の多くは対応済み。
> 現行の報酬設計は必ず `src/ai/env.ts` の `computeReward()` を直接読むこと
> [このファイルだけ見て「lizhi reward が未実装」と誤読した事例あり]。

# AI v7 結果まとめ [2026-05-13、 シャンテン reward shaping]

## v6 → v7 変更点
- **reward shaping 追加**: シャンテン低下 1 段で +0.05 の reward 加算
- env.ts `computeReward()` に prev_xiangting tracking 追加
- max_rounds default は train script 側で 4→8 に拡大

## 学習 dynamics [50 ep / 1024 step / max_rounds=8]
- 初期 ep: mean_rew 0 → ep 5+ で +0.005 → ep 30+ で +0.010 安定
- entropy: 2.25 → 1.7-1.8 [適度な探索維持]
- value_loss: 0.000 → 0.003 [valid signal 検出]
- policy_loss: -0.00X 範囲、 stable

## eval [v6_ep200 vs v7_ep50、 30 ep / max_rounds=8]
| metric | random | v6 (200ep) | v7 (50ep + shaping) |
|--------|--------|-----------|---------|
| mean_reward | 0.0 | 0.0 | **+0.215** |
| std_reward | 0.0 | 0.0 | 0.085 |
| illegal_pct | 0.0% | 0.0% [fix後] | 0.0% |
| dapai | 568 | 564 | 559 |
| nuki_bei | 11 | 23 | **33** |
| pass | 30 | 30 | 30 |
| lizhi/tsumo/ron/fulou | 0 | 0 | 0 |

## 解釈
- **v7 が random を 0.215/0 で大幅 outperform** = reward shaping で 学習が正方向に進んでる証拠
- nuki_bei [z4 北抜き] 選好は v6/v7 共通、 mahjong logic 妥当 [字牌捨ても兼ねて打点改善]
- lizhi/tsumo/ron が依然 0: テンパイ到達まで 8 round + シャンテン shaping でも reach 不足、 longer training 必要

## 次の改善案
1. **v8 longer training**: 200 ep × 1024 step を 8 round で回す [estimated ~5 min CPU]
2. **v9 obs 改善**: 河の最近 30 牌 → 全 N 牌に拡張、 残 paishu / 親 seat 強化
3. **v10 self-play**: 現状は random 他家 vs trained P0、 全員 trained で multi-agent learning
4. **reward 改善**: テンパイ到達 +0.5、 役確定見込で更に boost

---

# v8 結果 [2026-05-13、 tenpai bonus reward]

## v8 変更点
- env.ts computeReward(): tenpai (xt=0) 初到達 +0.5、 維持中 +0.02/step
- v7 の シャンテン低下 reward [+0.05/step] 維持

## eval [50 ep / max_rounds=8]
| metric | random | v7_ep200 | **v8_ep100** | v8_ep200 |
|--------|--------|---------|---------|---------|
| mean_reward | 0.0 | +0.212 | **+0.677** | +0.497 |
| std_reward | 0.0 | 0.069 | 0.539 | 0.505 |
| value_loss | - | 0.003 | **0.10** | 0.10 |
| entropy | - | 1.59 | 0.55 | 0.53 |
| nuki_bei | 11 | 6 | **68** | 62 |
| illegal_pct | 0% | 0% | 0% | 0% |

## 解釈
- **v8_ep100 が best**: mean_reward +0.677 [random 比 大幅改善]、 v7 の 3.2x
- v8_ep200 で +0.497 にやや退行 → overfit / lr 高い、 ep100 を best checkpoint として採用
- value_loss 0.10 / entropy 0.5 = policy 確信度 up、 「シャンテン下げて tenpai 維持」 path を learn
- nuki_bei 68 [random 11 比 6.2x] = z4 抜きで局回転加速 戦略 が学習で hard-wired

## v9 改善案
1. **lr scheduling**: 3e-4 → 1e-4 で安定化
2. **early stopping**: ep100 で best weights 保存
3. **obs 拡張**: テンパイ tile 候補 [何待ちか] を encode
4. **self-play [v10]**: 全 player を同 model で動かして multi-agent 学習
5. **lizhi reward**: リーチ宣言で +1.0 [いまは 0、 学習で出てこない]
