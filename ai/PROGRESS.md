# anmika AI 開発進捗

## 2026-05-13 01:10 JST [初版 scaffold]

### 完了
- `AI_DESIGN.md`: 学習設計 doc 書き起こし、 state/action/reward 定義
- `env_server.ts`: JSON-RPC stdin/stdout サーバ scaffold
- `env_helpers.ts`: Game3 gym-style wrapper [reset/step/observe]
- `agent.py`: Python random baseline + EnvClient subprocess wrap

### 制約 / 既知の課題
- TS の `Game3` import path が src/lib 相対なので、 ts-node か tsx 経由で実行する必要あり
- Shoupai 内部 `_bingpai` 直 access、 副露 / 抜き北 対応未
- CPU [P1/P2] が完全 random、 副露しないので 局進行率 悪い
- action 14-17 [北抜き / ツモ / pass / ロン] 未実装
- observation が 37 + 6 + 3 = 46 dim と過小、 拡張要

### 動作確認 [01:13-01:18 JST]
- `npx tsx ai/env_server.ts` 起動 OK、 reset RPC で 46 dim obs + legalActions[0..11] 取得
- console.log → stderr redirect 入れて Game3 dlog が JSON response 混入しなくなった
- `python3 agent.py --mode random --episodes 3` 完走、 ただし reward 全 0
  → 半荘終了まで到達してない、 step cap 500 で打ち切られてる
  → CPU random だと 河だけ伸びて hule しない、 ロン / ツモの自動宣言が欠けてる
- 次の修正: env_helpers の step / cpuStep で
  - canTsumo 即 hule、 canRon 候補は 50% 確率で取る等
  - 待ち枯渇で 流局として done=true 返す

### 次の milestone
1. `npx tsx ai/env_server.ts` 単体起動できるか確認
2. `python ai/agent.py --mode random --episodes 10` で baseline rollout 取れるか
3. 取れたら episode 報酬の分布 [現状 random vs random] 記録
4. PyTorch policy net 雛形 → REINFORCE 着手
5. checkpoint 保存 path 整備、 WebUI から load する仕組み

## 2026-05-13 07:55 JST [v1 REINFORCE 雛形 + 500 ep 学習]

### 完了
- `agent.py` に PyTorch policy net 追加 [obs46 → hidden64×2 → action14、 ReLU + Categorical]
  - `train` mode: REINFORCE [discount=0.99、 baseline=mean、 std 正規化]
  - `eval` mode: ckpt load + deterministic rollout
  - `random` mode: 旧 baseline
- `env_helpers.stepReward`: defen delta [1000 点/単位] + chip delta ×5 + tingpai size delta ×0.05
- 500 ep 学習走り切った [mean 45.65、 ckpt 36KB]
- train 後 eval 50 ep mean 45.63 vs random 50 ep mean 45.58 → **学習効果ほぼナシ**

### 学習効果が出なかった原因 [v2 課題]
- random CPU 相手だと hule 発生率 ~0、 defen が常に 35000 で動かない
- final reward が tie-break uma [45 固定] に支配される
- tingpai shaping は ±1 程度の noise しか足さない
- policy net が学習する gradient が ノイズに埋もれる

### v2 milestone [次セッション]
1. **CPU policy 強化**: 簡易 tenpai 判定 + tingpai 揃え方優先で discard 選ぶ
   → 局がアガリで終わるようになる → defen が動く → 学習 signal 入る
2. **報酬 shaping 強化**: shanten 距離 [Majiang.Util] 直 read で 「向聴数が減るほど +」
3. **PPO 移行**: stable_baselines3 採用検討、 sample efficiency 上げる
4. **副露 / 北抜き action**: action space 14 → 18 [北抜き / pon / chi / kan / pass]

## 2026-05-13 08:25 JST [v2-v4 iteration / 結論]

### v2 [smart CPU + auto-riichi]
- pickBestDiscard + 80% 自動立直 で hule 発生率 0% → 200%/game
- defen が実際動く → 学習 signal は入る状態に
- 300 ep 学習: reward ±1.6M に発散、 trained=-6122 vs random=-139 で trained 大敗

### v3 [reward clipping ±5]
- step reward / 10000、 final / 30、 ±5 クリップ
- 200 ep 学習: trained=-4.42 vs random=-1.86、 まだ trained 負け越し

### v4 [A2C-lite + 大きいネット]
- value head 追加 [baseline]、 entropy bonus、 hidden 64→128 + 1 層、 grad clip 1.0
- env に wall-clock 3s stuck guard、 deterministic eval
- 500 ep 学習: trained=-2.82 vs random=-2.73、 **ほぼ tied、 学習効果ナシ**

### 結論 [next session]
- 現 obs 46 dim は 麻雀には貧弱すぎ [手牌 multihot 37 + meta 9]、 副露 / 河 / 立直状態 が見えてない
- REINFORCE は variance 高く 500 ep では足りない、 5000+ ep か PPO 化必要
- **v5 milestone**: obs 拡張 [副露 / 河 / 立直 / 残山 / ぽっち / 金牌 込み 200 dim+] + PPO + 1 万 ep
  → これ無しでは random 超え期待できない
- alternative: 教師あり学習に切替、 既存の Game3.pickBestDiscard を expert として模倣学習

### 完了
- `env_helpers.ts` 大幅改修
  - `maybeAdvanceRound`: 未処理 hule / 流局 [paishu=0] で `nextRound + qipai` 自動
  - `lastProcessedHuleIdx` で 同一 hule 二度回し回避
  - `advanceUntilLearnerTurn`: stuck 検出 [lunban 不変 5 連続] で 強制 nextRound
  - `cpuStep` / `step`: dapai / hule の throw を silent skip、 env を kill しなくなった
  - `computeFinalReward`: `state.finished` guard 削除、 getFinalScore 常時呼び OK
- `python ai/agent.py --mode random --episodes 10` → mean reward 45.00、 step cap 0 件
- 既存 vitest 133/133 pass 維持

### 残課題
- reward 45.00 固定 [P0 = rank 1 tie-break 勝ち]、 random vs random では variance 出ず
  → defen が実際に動く局を発生させないと学習 signal にならない
  → CPU の hule 成功率を上げる [tenpai 時の停止 / 副露なし のままだと当面難しい]
- encoder / action decoder は 現状 v0 scaffold のまま [37 dim 手牌 + 6 meta + 3 = 46 dim]、 v1 で拡張
- action 14-17 [北抜き / ツモ宣言 / pass / ロン] 未実装、 step 側で auto-resolve に寄せた

### 学習計画
- v0 [今夜]: random baseline 確立 + env が動く確認
- v1 [明日]: REINFORCE 1000 episode、 random より勝ち越せるか check
- v2: PPO + self-play、 stable_baselines3 採用検討
- v3: TS env を onnx でブラウザに乗せる

## 2026-05-14 04:00 JST [ヒューリスティック CPU 強化 / pickBestDiscard]
リョー指示 「CPU 打牌精度向上 [AI 強化]」 で RL 待たずに rule-based 強化:

### 追加 prio rule [src/lib/game3.ts:765-863]
1. **守備**: 全リーチ家現物 +10 既存 + **非現物 -5 追加** [937415b]
2. **金牌 keep**: 候補が p0/s0/z4 で goldHand[kind]>0 なら -3 [chip 4 倍守る] [36f179a]
3. **赤 5 keep**: 候補が p0/s0 そのもので -1 [chip 2 倍守る] [36f179a]
4. **CPU リーチ smart**: canLizhi true でも 待ち枯渇 [全 4 枚 visible] なら declareLizhi 見送り [09ea482、 src/lib/store/cpuActions.ts]

### 評価方針
- 既存 V25-V32 fuzz [random / 多巡 / state corruption] で regression 0 件、 安全
- 学習効果は AI v12 PPO の reward signal に影響する可能性、 次の学習回し時に baseline 移動か確認
- unit test 6 件 追加 [pick_best_discard_safety 3 + cpu_lizhi_smart 2 + 既存補強]

## 2026-05-14 07:30-07:40 JST [自走 セッション: ukeire 視認 + 副露 strategy]
リョー指示 「ずっと作業して」 で 自走、 svelte warn 44→0 と CPU AI 強化 並行:

### CPU 強化 [4 commit]
1. **ukeire 視認枯渇 考慮** [dc40ef9]: pickBestDiscard の computeUkeire を 他家手 + 全 player 河 の visible 枚数で減算、 4 枚全部見えてる牌は ukeire 0 で除外 → 過大評価せず実残牌のみで受け入れ計上
2. **CPU pon 風牌 strategy** [21c984b]: 三元牌 [z5-z7] 常に pon、 風牌 [z1-z3] は cand.player の zifengZ または changfengZ 一致時のみ pon。 萬筒索 は引き続き スルー
3. **CPU 大明槓 strategy** [9edb5f9]: pon と同 基準で auto-kan、 z5-z7 常 / z1-z3 自風 場風 一致のみ / 萬筒索 スルー [嶺上負け リスク回避]
4. **CPU 暗槓 strategy** [0ef9102]: cpuStep で getKanCandidates check、 三元牌 [z5-z7] 4 枚揃い時のみ 自動 ankan、 新ドラ + yakuhai 1 役 で正収益。 風牌 / 数牌 は 与ドラ リスク回避 で スルー

### 副次効果 [非 AI 改善]
- **svelte-check 44→0** [ca1c324 + 31ed154]: SaiKoroModal 旧 3D dice CSS 36 件 / App.svelte mode-single 3 件 / 他 4 件、 dead CSS 計 130 行削減 + PochiRevealModal a11y keydown
- **unit test 359→360**: pick_best_discard 視認枯渇 regression test 追加

### v5 へ向けて 残課題
- CPU 副露 unit test [pure helper 切出して store 直接 test、 qijia 不定 問題]
- CPU 副露後の捨牌 quality [pickBestDiscard が 副露済の sp に対しても合理的か audit]
- obs 拡張 [副露 / 河 / 立直 / 残山 / ぽっち / 金牌 込 200 dim+] と PPO 移行 は未着手
