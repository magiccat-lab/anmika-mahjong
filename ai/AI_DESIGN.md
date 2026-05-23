# anmika 麻雀 AI 設計 [2026-05-12 初稿]

## 目的
アンミカ三麻の打牌 / 副露 / リーチ宣言の自動 agent を作る。
リョー指示: ダハイ選択の強化学習 を アンミカ仕様に合わせて最適化、 朝まで自走実装 + 学習。

## オープンソース 麻雀 AI の現状
- **Suphx** [Microsoft Research、 2019]: 4 麻、 オフライン学習 + Monte-Carlo Tree Search。 ソースコードは非公開、 論文のみ
- **Mortal** [github.com/Equim-chan/Mortal、 MIT]: 天鳳 / Mahjong Soul ranked top tier、 PyTorch ベース、 supervised + RL、 4 麻特化
- **NAGA** [DeNA、 非公開]: 商用、 アプリ提供のみ
- **akochan** [GitHub、 Apache-2.0]: 期待値最大化 expectimax、 4 麻、 supervised
- **CryoLite / tenhou-net2** [研究プロジェクト、 古い]: 教師あり画像 CNN
- **nyaa-mahjongAI**: 個人実装、 教師あり
- **OpenSpiel mahjong** [DeepMind]: 4 麻 RL env、 簡易 / 学習用

### 結論
- Mortal / akochan の architecture を参考に、 アンミカ三麻専用に 一から書く
- 三麻 + アンミカ独自牌 [m7/m9 のみ、 z5 4 色、 金牌、 華牌] のため 4 麻 weight 流用は不可
- supervised は expert paifu が無い → self-play RL 直行

## アンミカ三麻特殊事項
- **牌**: 116 枚、 萬子 m7/m9 のみ、 z5 4 色 [pochi]、 金牌 3 種、 華牌 4 種
- **ぽっち効果**: 倍率 / 反転 / 神ぽ、 半荘累積 [一旦ツモると 以降全 hule で適用]
- **フィーバー立直**: 7m/7p/7s 暗刻保持で宣言、 tier 1/2/3 で打点 / 祝儀 ×1/2/4
- **シュバリ**: 半荘 1 回限定、 当局 chip ×2、 見逃し不可、 サイコロチャンス ゾロ連続発動条件
- **金北 / 抜きドラ**: 北 z4 抜きで打点 / 祝儀加算、 金北で chip +4 ボーナス
- **冬めくり**: アガリ winner が f4 持ちで山末尾 1 枚めくり chip
- **トビ賞 chip**: ≥0→<0 遷移で +5×倍率 chip
- **ウマ**: 2 着 ≥40000 で +30/0/-30、 未達 +45/-15/-30
- **トントンブー**: 東 1 局親アガリ + 他家飛びで +6 chip オール

## state representation
### 観測 [observation]
- **手牌 multihot**: 116 dim x [0/1/2/3/4 各 dim、 max 4]
- **直前ツモ**: 1-hot 116 dim
- **副露**: 各 player の 副露 mianzi リスト → flatten [type onehot + tiles multihot]
- **河**: 各 player の打牌履歴 [tile onehot + 順序 position 埋め込み]
- **抜き北 / 金北 / 抜き華**: 各 player の枚数 [scalar]
- **ぽっち状態**: pochiMultiplier 各 player [scalar -4..+4]
- **シュバ / フィーバー**: 各 player active / tier flag
- **kinpei target / lizhi / openLizhi**: 各 player
- **defen / chipLedger**: 各 player [normalize / 35000 / 0]
- **ドラ表 / 裏ドラ表**: tile onehot [4 枚分 ×2]
- **state.changbang / jushu / benbang / lizhibang**: scalar

total: ~1000-1500 features 概算

### 入力 tensor
- batch x [hand(116) + ハンドリスト連結 ~200 dim + meta scalars 50 dim] flatten
- 簡易 v0: 単純 MLP、 v1 で transformer encoder

## action space
- **打牌**: 14 candidate tiles [手牌 + ツモ]、 mask invalid
- **リーチ宣言**: 7 variant [no_lizhi / 通常 / シュバ / フィバ / シュバフィバ / オープン / シュバオープン]
- **副露**: pon / kan / damin (各 candidate mianzi に対応)、 mask
- **ロン**: yes / no [見逃し or 宣言]
- **ツモ**: 必ず宣言 [手牌アガリ形時 deterministic]
- **北抜き**: yes / no

### v0 簡略
- 打牌 のみ学習、 副露 / リーチは rule-based:
  - 副露: 役確保できれば取る、 アガリ近い場合のみ
  - リーチ: テンパイ + lizhi 可能で常に通常リーチ
  - 北抜き: ツモ z4 で常に抜く
  - ロン: 役あれば常に宣言

## reward
- 半荘終了時: **getFinalScore.total** [chipBase + uma + topNBonus + tobiBonus + tontonbuBonus]
- 中間 reward: なし [sparse]
- 学習対象 player のみ reward 計算 [3 player の中 1 player を学習者にする]

## environment wrapper [gym-style]
```python
class AnmikaEnv:
  def reset() -> obs:  # 新半荘 init、 学習者の手番が来るまで CPU 進行
  def step(action) -> (obs, reward, done, info):
    # action = 打牌 index
    # 学習者打牌 → 他家 CPU で advance → 学習者の次手番まで進める
    # 半荘終了で reward 計算 + done=True
  def legal_actions() -> mask:  # 打牌可能な手牌位置
```

## training
- **algorithm v0**: REINFORCE [policy gradient]
- **algorithm v1**: PPO [stable_baselines3]
- **batch**: 32 games rollout / update
- **rollout opponents**: random + previous checkpoint [self-play]
- **eval**: rule-based CPU との対戦 1000 試合の chip 期待値

## 技術スタック
- Python 3.11+
- PyTorch
- Game3 env は TS で書かれてるので、 Node.js subprocess で env 呼ぶ or TS env を Python に port
  - v0: TypeScript で env wrapper + Python で agent + bridge JSON
  - v1: TypeScript で env、 onnx 経由で推論

## 進捗 milestone
- [x] design doc 作成 [この doc、 2026-05-12 night]
- [ ] env wrap: Game3 を JSON-RPC で 1 step / reset / observe できる Node サーバ作る
- [ ] Python policy net 雛形 [MLP 1 hidden 256]
- [ ] random vs random baseline 取得 [1000 試合の chip 分布]
- [ ] REINFORCE 学習 loop
- [ ] 学習者 vs random で chip 期待値 比較 [+ なら改善]
- [ ] checkpoint 保存 → WebUI に load する path

## 既知の課題
- ぽっち効果 半荘累積なので state に必ず含める
- フィーバー中 他家強制ツモ切り なので 学習者が フィーバー player でない場合 action space = ツモ切りのみ
- シュバ宣言は半荘 1 回なので state に shuvariUsed flag 必須
- 副露 candidate の組合せ爆発を回避するため v0 では 副露 OFF か単純化

## 朝までの目標
1. design doc commit [この doc]
2. JSON-RPC env wrap [TypeScript server]
3. Python policy net 雛形 + random baseline
4. 学習 1 round 走らせて trajectory ログ取る
5. progress.md に結果書く

時間切れの場合は (1)-(2) のみ commit、 残り pending_tasks に書く
