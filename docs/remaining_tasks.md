# anmika 残務メモ

更新日: 2026-06-13

## 現状

2026-06-13 時点で、通常の品質ゲートは通過済み。

- `npm.cmd test`: green
- `npm.cmd run check`: 0 errors
- `npm.cmd run build`: success
- Playwright smoke: green
- server TypeScript isolated compile: green
- Python `py_compile`: green

本番ブロッカーとして扱うべき未修正バグは、今回の一通りチェックでは見つかっていない。

## 残務 1: Svelte warning の整理

優先度: P2

`npm.cmd run check` と `npm.cmd run build` で、Svelte の warning が残っている。エラーではないが、今後の本物のwarningを見落としやすくなるので掃除する。

対象:

- `src/lib/OnlineGameView.svelte:11`
  - `hostUserId` が `export let` されているが未使用。
  - 使う予定がないなら prop を削除する。
  - 外部参照用に残すだけなら `export const hostUserId` にするか、呼び出し側の責務を見直す。

- `src/App.svelte:2644`
  - `main.mode-single .center-area .center-info` が未使用。

- `src/App.svelte:2930`
  - `main.mode-single .dora-row .dora-arrow` が未使用。

- `src/App.svelte:2931`
  - `main.mode-single .dora-row .dora-meta` が未使用。

- `src/App.svelte:3064`
  - `main.mode-single .toolbar-yellow .tb-row.hot` が未使用。

- `src/App.svelte:3241-3276`
  - `.single-side-player ...` 系の旧サイド表示CSSが未使用。
  - 旧UIを復活させる予定がなければまとめて削除。
  - 復活予定があるなら、現在のコンポーネント名・DOM構造に合わせてCSS selectorを更新。

- `src/App.svelte:3394`
- `src/App.svelte:3557`
- `src/App.svelte:3561`
  - `main.mode-single .agari-unified-panel .agari-right` が複数箇所で未使用。
  - 旧レイアウト用なら削除。
  - 現行レイアウトで右側パネルを戻す予定ならDOM側とCSS側を合わせる。

完了条件:

- `npm.cmd run check` が 0 errors / 0 warnings になる。
- `npm.cmd run build` で Svelte unused warning が出ない。

## 残務 2: production build の chunk size warning

優先度: P2

`npm.cmd run build` で、500 kB 超の chunk warning が出ている。現状はビルド成功しているのでブロッカーではないが、初回ロードとキャッシュ効率に効く。

主な大きいchunk:

- `dist/assets/Dice-*.js`
- `dist/assets/world.offscreen-*.js`
- `dist/assets/world.onscreen-*.js`
- `dist/assets/index-*.js`

対応案:

- dice-box / 3D dice 関連をサイコロモーダル表示時の dynamic import に寄せる。
- Vite/Rolldown の code splitting 設定を入れる。
- chunk size limit を上げるだけで済ませる場合は、実害がないことを確認して理由をコメントに残す。

完了条件:

- `npm.cmd run build` の chunk size warning を消す、または意図したwarningとして設定・コメントで管理する。

## 残務 3: debug / console log の棚卸し

優先度: P2

オンライン対戦中の `dlog` は抑制されているが、直接 `console.log` が残っている箇所がある。PlaywrightやDEV専用なら問題ないが、本番で出るものが混じると情報漏れ・ログ汚染になる。

確認対象:

- `src/App.svelte`
- `src/lib/game3.ts`
- `src/lib/diceBoxSingleton.ts`
- `src/lib/SaiKoroModal.svelte`

対応案:

- 本番でも必要なログは `dlog` か明示的な debug flag 配下に寄せる。
- Playwright専用ログは `navigator.webdriver` gate を残す。
- 本番不要な調査ログは削除する。

完了条件:

- `rg -n "console\\.(log|debug|warn|error)" src server` の結果を確認済みにする。
- 本番オンライン中に隠し情報がconsoleへ出ないことを確認する。

## 残務 4: フルオンラインE2Eの定期実行

優先度: P2

今回通したのはローカル単体・build・smoke中心。オンライン対戦のフルスタックE2Eは、必要なサーバ起動と複数ブラウザ接続を含めて別枠で定期実行したい。

対応案:

- `server/app.py` と `server/ws_server.ts` をテスト用設定で起動。
- `tests/online.spec.ts` を安定して走らせる。
- room作成、入室、host/client同期、nextRound、nextMatch、サイコロ、ダブロン系の代表シナリオをCIまたは手元script化する。

完了条件:

- オンラインE2Eを1コマンドで起動から停止まで回せる。
- ローカル環境で flaky にならない。

## 残務 5: 古いdocs/todo系の整理

優先度: P3

`docs/todo.md` や `docs/progress.md` には古い未確認メモが残っている。今回の品質チェックでgreenになった内容と、昔の仕様TODOが混ざっているため、今後の判断材料としては少し読みにくい。

対応案:

- 完了済み項目を削る。
- 仕様未実装のTODOと、品質改善TODOを分ける。
- この `docs/remaining_tasks.md` を現在の短期残務リストとして維持する。

完了条件:

- 現在の短期残務が1ファイルで追える。
- 古いTODOを読まなくても、次にやることが判断できる。

