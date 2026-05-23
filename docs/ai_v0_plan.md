# AI v0: Meowjong 流 self-play RL env scaffold [2026-05-12]

リョー指示 [深夜セッション handoff]:
- Meowjong 流の self-play RL を v0 として組む
- Game3 lib を再利用、 Python bridge or in-process で env 作成
- 全 CPU 局走を学習 episode に転用

## 方式選定 [v0]

検討した 3 案:

| 案 | pros | cons | 採否 |
|---|---|---|---|
| A. TS env + Python RL bridge [stdin/stdout JSON] | Game3 そのまま再利用、 RL は安定の Python 資産 [PyTorch] | プロセス間 IPC オーバヘッド、 episode/sec 落ちる | **採用** |
| B. Pure TS [TF.js / brain.js] | 1 プロセスで完結、 デプロイ簡単 | 学習速度遅、 RL ライブラリ薄、 GPU 連携面倒 | 不採用 |
| C. Python に Game3 を移植 | RL 側純度高、 jit + multiprocessing 効く | 移植コスト膨大、 仕様変動に二重保守 | 不採用 |

→ **A 採用**。 episode/sec は self-play 規模次第で 50-500 想定、 v0 として十分。

## 観測空間 [obs] [v0 簡略]

各 step で active player 視点の以下を float32 vector で:

```
// 手牌: 116 種別 × max 4 枚 → one-hot 様 [長さ 116]
// [m1-9 / p0-9 [gp 含む] / s0-9 [gs 含む] / z1-7 [z4 は gN 含む] / z5b/r/g/y / f1-4]
hand: number[116]

// 河 [全 player]: 直近 30 牌 [片側 116-dim one-hot × 30] → 3 player × 30 × 116
river: number[3 * 30 * 116]

// 副露 [全 player]: 各 fulou を encode、 max 4 mianzi × 116
fulou: number[3 * 4 * 116]

// global scalar:
//  - changbang [連荘数] / 場風 [n_e / n_s] / dora 表 [116-dim sum]
//  - 自分の点数 / 他家点数 / 場供託
//  - リーチ flag × 3 / 一発 flag × 3 / フィーバー flag × 3
//  - 抜き北 / 金北 / 抜き華 各 player
globals: number[~50]
```

総 dim ≈ 116 + 10440 + 1392 + 50 ≈ **12000 程度**。 重ければ後で剪定。

## アクション空間

active player に提示される選択肢、 v0 は **discrete 単一 head**:

```
0..115        : 打牌 [tile index]、 illegal は mask
116..131      : 副露宣言 [pon × 4 mianzi + kan × 4 + chi × 4 + pass 等、 後で展開]
132           : リーチ宣言
133           : ツモ宣言
134           : ロン宣言
135           : 抜き北 / 抜き華
136           : pass [全 skip]
```

総 ~137 action、 illegal mask は env が返す `legal_mask: bool[137]`。

## 報酬

- step 終了時: 0
- 局終了時: 自分の点数差分 / 1000 [stable scale]
- 半荘終了時 [東風 1 半荘]: ranking 報酬 [1 位 +3 / 2 位 0 / 3 位 -3]
- フィーバー / ぽっち倍率による高得点で外れ値出る、 clip [-10, 10]

## API [TS 側]

```ts
// src/ai/env.ts
export interface EnvObs {
  obs: Float32Array;
  legal_mask: boolean[];
  player: 0 | 1 | 2;
  done: boolean;
  reward: number;
  info: { round: number; lunban: number; phase: string };
}

export class AnmikaEnv {
  reset(seed?: number): EnvObs;
  step(action: number): EnvObs;
  // 観測 encoder は別ファイル
  // 内部で Game3 + store の壊さない subset を使う
}
```

CLI driver `tools/ai_env_cli.ts` が stdin から JSON line 受けて env.step → stdout に obs JSON 返す。

Python 側 `tools/ai_train.py` は subprocess.Popen で env プロセス起動、 PyTorch + ray.rllib などで学習。

## v0 implementation 段階

- [x] 0. 方式選定 + 設計 doc [このファイル]
- [ ] 1. obs encoder [`src/ai/encoder.ts`]、 Game3 state → Float32Array
- [ ] 2. action decoder + legal_mask [`src/ai/action.ts`]
- [ ] 3. AnmikaEnv [`src/ai/env.ts`]、 reset / step 実装
- [ ] 4. CLI driver [`tools/ai_env_cli.ts`]、 stdin/stdout JSON
- [ ] 5. Python wrapper [`tools/ai_env.py`]、 gym-like API
- [ ] 6. self-play loop [`tools/ai_train.py`]、 random policy ベースラインから
- [ ] 7. PPO / IMPALA で学習ループ追加

## 注意

- Game3 / store は 「全 CPU 走」 を前提に書かれてる、 個別 player を 外部制御する hook は ナイ
- env では cpuStep 経由ではなく、 1 player 分の action を直接 game に注入する形が必要
- 既存 cpuStep は heuristic baseline として残す [reward shaping ベンチ用]
- ぽっち / 金牌 / フィーバー / 八連荘 等の anmika 独自仕様は obs に full 表現する、 でないと学習側で見えない

## 進行管理

このセッションは scaffold 着手まで、 完成は別セッションで継続。
タスク: pending_tasks.json `【09:00 JST まで継続】anmika 残務` 配下。
