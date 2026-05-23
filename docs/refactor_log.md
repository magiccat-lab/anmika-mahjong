# refactor log [anmika-mahjong]

リファクタ・component 抜出・UI 整理の作業記録。
新しいセッションでもここを Read すれば 「今どこまでやったか」 が分かる。

## 2026-05-10 セッション

### 既に component 化済 [この セッション前半で commit、 b2cf740 まで]
- `lib/Tile.svelte` — 1 牌描画
- `lib/TileChecker.svelte` — 116 枚 inventory 検証
- `lib/ChipBreakdown.svelte` — chip 加算 breakdown
- `lib/WallPanel.svelte` — 山 / ドラ表 / 裏ドラ表
- `lib/DebugLogPanel.svelte` — DEBUG_LOG 表示
- `lib/ZimoHistory.svelte` — ツモ順 panel
- `lib/FuyuModal.svelte` — フィーバー中 冬使う / 保留
- `lib/KinpeiModal.svelte` — 金北 強化対象選択
- `lib/PlayerStatus.svelte` — 1 player の score / chip / リーチ等

### 2026-05-10 セッション [追加分: vitest + C7/C8/C9/C10 + E16-18]
- `__tests__/helpers.test.ts` 15 件 / `shan3.test.ts` 18 件 / `chip.test.ts` 13 件 / `feverLizhi.test.ts` 14 件 / `game3.test.ts` smoke 2 件 = 計 62 件全 pass
- vitest 4.1.5 + @vitest/ui 導入、 `npm test` / `test:watch` script 追加
- Counter.svelte [scaffolding dead code] 削除
- App.svelte 等の 型 error 25 件 fix [PLAYERS as const / PlayerId 推論 / null narrow / majiang-core.d.ts]
- C8 完了: `lib/game3/huleChip.ts` 新設 [applyFuyuChip + applyChipsOnHule]
  - `HuleChipCtx` interface に 13 field + 2 method bridge [applyChipOall / applyChipFromLoser callback]
  - game3.ts: 230 行 → wrap method 6 行に圧縮、 行数 2099 → 1885 [-214]
  - test 5 file 全 pass + svelte-check 0 error + vite build OK
  - 残置完全解消、 multi-mutate orchestration は無くなった

### game3.ts 分割 [後半対応]
- `lib/game3/feverLizhi.ts` 新設 — canFeverLizhi / isFeverWaitExhausted を pure helper 化
- `lib/game3/yaku.ts` 新設 — isKanpaman / doraIndicatorOf を pure helper 化
- `lib/game3/chip.ts` 新設 — computeChipMultiplier / applyChipOall / applyChipFromLoser を ChipState context 経由で抜出
- `lib/game3/tingpai.ts` 新設 — getTingpaiList / getTingpaiListBeforeZimo / canTsumoWithPochiSwap を pure helper 化
- 行数: 2232 → 2099 [-133]
- `lib/game3/snapshot.ts` 新設 — saveSnapshot / restoreSnapshot を SnapshotRefs context 経由で抜出
- 残置判断: `applyFuyuChip` / `applyChipsOnHule` は game3.ts に残す
  - 理由: chipLedger / chipBreakdown / akiUsedCount / huapai / nukidora / goldHand / kinpeiTarget / lizhi / openLizhi / pochiMultiplier / feverActive / shan.baopai / shan.fubaopai 等の多数フィールドを read+write する orchestration で、 context 化が破綻なく出来ない [type 上は通っても挙動 regression を見抜けない]
  - 仕様 v8 / v9 等で頻繁に変動する箇所のため、 Game3 class 内に集約した方が変更安全

### Tile / inline style 整理
- `Tile.svelte` に `size` prop 追加 [sm 22x30 / md 32x44 / lg 40x55]
- HeaderInfo / RoundEndPanel / WallPanel のドラ表示牌は sm 採用
- 6 component の inline `style="..."` を全 scoped style に [ChipBreakdown / WallPanel / TileChecker / ZimoHistory / FuyuModal / KinpeiModal]
- フォントは Menlo/Consolas 11-13px 系で全 panel 統一、 chip 表は tabular-nums
- KinpeiModal は 春夏秋冬 で色分け [緑/赤/茶/青] で視認性向上
- App.svelte の obsolete style [section.player / hule-panel / game-end-panel / yaku-chip / paifu-load / replay-* 等] を component 移行済として除去 -76 行
- 方針: this 依存を排した関数を 1 段階ずつ抜き出し、 Game3 class 側は wrap method で互換維持
- 残り: chip 系 [applyChipFromLoser / applyChipOall / computeChipMultiplier]、 fuyu 系、 tingpai 系、 snapshot 系
- 行数: 2232 → 2158 [-74]、 安全な incremental 進行

### Header / RoundEnd 系 component 化
- `lib/HeaderInfo.svelte` 新設 — 場・局・本場・供託・山残・ドラ表・現家・直ツモ
- `lib/RoundEndPanel.svelte` 新設 — 局結果 [hule-panel] + 役 chip + 表/裏ドラ表
- `lib/GameEndPanel.svelte` 新設 — 半荘終了 ranking [tabular 桁揃え]
- `lib/PaifuLoadPanel.svelte` 新設 — ロード牌譜 replay UI

### このターンで対応
- `lib/PlayerHandPanel.svelte` 新設 — 1 player の手牌+副露+抜き華+抜きドラ+河
  - App.svelte の player 0/1/2 の section [計 78 行] が 1 component の 3 呼出 [計 36 行] に圧縮
  - 各 player で同じ layout / フォント / spacing が確実に揃う
- `PlayerStatus.svelte` UI 整理
  - 表示順序を **風 → 点数 → 向聴 → ドラ → リーチ → 北 → チップ** に固定
  - monospace [Menlo / Consolas]、 tabular-nums で 桁揃え
  - 各 seg を class 化 [.id .feng .score .xt .dora .lizhi .nuki .chip] で色分け
- `App.svelte` header の button 群を意味グループ化
  - `.action-row` wrapper で 「進行 / アガリ / リーチ / 宣言 / ロン待ち / ポン待ち / 局終了 / システム / debug」 を 行単位に分離
  - `.action-row.hot` で アガリ・ロン待ち・ポン待ち を 黄背景強調
  - `.action-row.sys` で システム系 [初期化 / 牌譜 / debug-toggle] を opacity 落とし
  - inline `style="background:#a08020"` 等を class 化 [.lizhi-btn / .shuvari / .fever / .shuvari-fever / .open / .agariyame]
  - button 共通 style 統一 [12px / border #bbb / padding 4px 10px / hover]
  - `.row-label` で 「進行: / アガリ: / リーチ:」 等の見出しを 56px min-width 統一

## 残タスク [このセッション続行]

### 1. 残 component 化 [見通しが付くもの順]
- `Header.svelte` — 場・局・本場・供託・山残・ドラ表・現家
- `RoundEndPanel.svelte` — 局結果 [hule-panel] + 次局 button + アガリ止め button + ChipBreakdown ぶら下げ
- `GameEndPanel.svelte` — 半荘終了 ranking
- `PaifuLoadPanel.svelte` — 牌譜ロード replay UI
- `EventLog.svelte` — paifu events list
- `SystemBar.svelte` — システム + debug の操作 row [または App.svelte に残す]

### 2. game3.ts class メソッド分割 [大規模]
- 1900+ 行 1 class が `Game3` に詰まっている
- 方針: pure function 化して helper module に切り出し、 game state を引数で渡す
- 候補 module:
  - `lib/game3/chip.ts` — applyChipFromLoser / applyChipOall / computeChipMultiplier / chipBreakdown
  - `lib/game3/fuyu.ts` — applyFuyuChip / kinpei snapshot 系
  - `lib/game3/yaku.ts` — isKanpaman / canFeverLizhi / 北の役満特殊化 / 混老対
  - `lib/game3/tingpai.ts` — getTingpaiList / isFeverWaitExhausted
  - `lib/game3/state_io.ts` — saveSnapshot / restoreSnapshot / paifu serialize/deserialize
- Game3 class は orchestration [tsumo / dapai / hule / nextRound] に集中

### 3. UI 改善 [現構成のまま]
- ☑ PlayerStatus 順序統一
- ☑ button group 化
- ☐ Tile size の統一 [手牌 / 河 / 副露 / 抜き華で大小ばらつき]
- ☐ section の border / padding / margin を design token 化 [--seg-pad 等]

### 4. 麻雀アプリ風 UI [後回し、 リョー明言]
- 卓を中央に、 自家手牌を画面下、 対面・上家を左右回転表示
- このターンでは **やらない**

## 注意事項 [次セッションも守る]
- リョーは 「許可取らなくていい、 都度 md に記録」 派
- commit 単位で進捗 reply を 1 行入れる [reply_chunking 対応]
- game3.ts 分割は paifu v2 [shoupai / state 全保存] が動いている前提なので壊さないこと
- chip 計算は spec が docs/chip_spec.md にあり、 spec は v7 まで進んでいる
