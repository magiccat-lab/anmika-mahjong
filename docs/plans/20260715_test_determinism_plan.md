# テスト決定論化(シードRNG) 実装プラン (2026-07-15)

レビュー担当が起草。オーナー承認後に自走実装へ発注する。

## 目的・背景

- Game3/Shan3 が `Math.random` 直参照で山を作るため、unit テストの約1/5がランダム依存。現行は `vite.config.ts` の `retry: 2` で flaky を吸収している(2026-05-14 の暫定措置)
- 2026-07-15 裁定「表示華(baopai)も金北候補に数える」で flaky 面がさらに拡大(kinpei 系で実測。ws_a10 レビュー時に can_tsumo / lizhi_marker / v36 の偶発 fail も確認)
- `--retry=0` で常に green にし、リリース判定を「リトライ吸収なし」に引き上げる(WS-B テスト運用改革の先行分)

## スコープ

- In: テスト時に注入可能なシード付きRNG、既存ランダム依存テストの決定論化、retry:2 の撤廃
- Out (non-goals / 触るな):
  - プロダクション実行時の乱数挙動・品質(default は従来どおり `Math.random`)
  - ゲームルール・精算ロジックの変更(テストの期待値をルールに合わせて直す場合も、プロダクション側は触らない)
  - `game3.ts:679-686` の最終成績計算
  - playwright E2E の構造改革(unit/vitest のみが対象)

## 要件(検証可能な形で)

1. `Shan3` / `Game3` にRNG注入点がある(例: `init.rng?: () => number`)。未指定時は従来どおり `Math.random` を使い、既存呼び出しコードは無変更で動く
2. vitest 実行時は全テストが決定論的になる(セットアップで seeded RNG を注入 or 各テストで明示指定)。`ANMIKA_TEST_SEED` 環境変数でシードを変えられる
3. `npx vitest run --retry=0` が3連続で 985+ 全件 green(シード default 値で)
4. `ANMIKA_TEST_SEED` を変えた2種以上のシードでも full suite green(シード依存の隠れ期待値を作らない)
5. `vite.config.ts` から `retry: 2` を削除し `retry: 0` 相当にする(コメントも現状に合わせ更新)
6. 既知flaky 4系統(can_tsumo「p8ツモ後に局結果」/ lizhi_marker「gN idempotent」/ v36 V36-F / kinpei 系)がシード下で決定論的に green。期待値がルール裁定(`rule_rulings_20260715.test.ts`)と矛盾するテストは裁定準拠に修正し、コミットメッセージで「テスト意味論の変更」と明示する
7. テスト実行時間は現行比 +20% 以内

## 制約

- コミット境界: RNG注入点 / テストセットアップ / 個別テスト修正 / config変更 で分割(単独 revert 可能に)
- 個別テスト修正でプロダクションコードのバグを発見した場合は、実装せず agmsg で相談に積む(勝手に直さない)
- ベースブランチ: `codex/all-fixes`(ed9a7df 以降)

## 完了条件

- `npx vitest run --retry=0` ×3連続 green
- `ANMIKA_TEST_SEED=<別値>` で full suite green(2シード以上)
- `npm run check` green
- `PYTHON=server/.venv/bin/python npm run test:e2e:online` green(回帰確認)

## 検収チェックリスト(Fable が実行)

- [ ] 要件1: RNG未注入で `new Game3()` が従来動作(diff レビュー+既存テスト green)
- [ ] 要件3: `--retry=0` ×3連続 green を実測
- [ ] 要件4: シード2種で green を実測
- [ ] 要件5: vite.config.ts に retry 吸収が残っていない
- [ ] 要件6: 4系統の修正が裁定準拠か diff レビュー
- [ ] 要件7: 実行時間比較(現行 ~65s 基準)
- [ ] diff にスコープ外変更(プロダクション乱数・ルール)が無い

## 相談プロトコル

- 迷ったらレビュー担当(プラン作成者)へ、いつもの相談経路で連絡する
- 形式: 「何に迷っているか + 選択肢 + 自分の推し」。プラン外の思いつきは実装せず相談に積む

## 進行表

| 日付 | 状態 | メモ |
|---|---|---|
| 2026-07-15 | プラン起草(リョー承認待ち) | 承認後 /goal 発注 |
