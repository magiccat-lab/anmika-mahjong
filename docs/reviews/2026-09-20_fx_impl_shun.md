---
status: in_progress
opened: 2026-09-20
outcome: 演出ゼロベース再検討のリョー決定 (E+F) を実装。フィーバー待ち枚数の裁定と、ぽっち開封の作り直しも同時に
---

# 演出の実装 (2026-09-20、shun)

リョー「E と F 合体とかでいいよ。フィーバーの待ち表示はちゃんと出して、王牌も含んだ枚数で。
ポッチツモ演出とかもダセーから直してくれ。実装は駿」(アンミカ ch)。
案は `2026-09-20_fx_redesign_yuma.md`。

## リョーの決定 (yuma の doc の 5 章に対する答え)

| 聞いた事 | 決定 |
|---|---|
| 1. 案 A〜F | **E + F の合体**。席側の小さい帯 (F) + 席から広がる光の輪 (E) |
| 2. フィーバー待ちの残り枚数 | **出す。ただし王牌も含んだ枚数で** |
| 3〜5 (「山を見る」/ 音 / ぽっちの尺) | 回答なし。3 は現状維持、4 と 5 は据え置き |

追加で「ポッチツモ演出がダサい」→ 作り直した。

## 入れたもの

| # | 何 | commit |
|---|---|---|
| 1 | 待ちの残り枚数を王牌込みに | 8a4246a |
| 2 | カットインを E+F に | e760bf2 |
| 3 | ぽっち開封を静かな作りに | e994290 |

### 1. 王牌込みの枚数

`Shan3.concealedDeadWall` を新設。**嶺上 + 未公開のドラ表 + 未公開の裏ドラ**を返す。
公開済みのドラ表は盤面に出ているので含めない (含めると見えている牌を残りと数える)。
blind (online の projection) は現物を持たないので空を返す。

待ちの集計を `live wall + concealedDeadWall` に変えた。これで数字の意味が
「まだ見えていない枚数」になり、王牌に落ちた事が引き算で分からなくなる。

**solo と online の両方を直した**。`App.svelte` の `feverWaitInfo` と
`ws_server.ts` の `confirmedFeverWaitInfo` で、片方だけだと数字が食い違う。

### 2. E+F のカットイン

- `CutinOverlay.svelte` を全面書き換え。DOM は 輪 2 + 帯 1 の 3 個
- 帯は宣言席の側 (上家=左 / 下家=右 / 自分=下) に寄せ、文字は
  現行 46〜110px → clamp(18, 3.4vw, 30)px。卓の中央は覆わない
- 輪は席を中心に 2 本、`transform: scale()` と `opacity` だけ
- **尺を 3 段に**: 軽 (リーチ/ポン/カン) 0.7 / 中 (ロン/ツモ) 1.2 / 重 (フィーバー) 1.8 秒。
  `cutinDurationMs()` を store に置き、**App の pump と watchdog も同じ関数を使う**
  (watchdog の 3 倍尺もこれ基準。片方だけ変えると保険が効かなくなる)
- カン/ポンの青緑を廃止して金 1 色
- **フィーバーの全画面フラッシュ (mix-blend screen) を廃止**。スマホで一番重い描画
- 重 だけタップでスキップ。**タイマーの所有者は App のまま**で、overlay は
  「押された」を dispatch するだけ (2026-07-23 の単一所有者の約束を壊さない)

### 3. ぽっち開封

斜めスラム・ネオン光彩・絵文字 (🎉😢)・点滅をやめ、卓と同じ静かな面に。
主役は牌、文字は説明。開いた後のぽっちの色だけ下線に残す。正/逆 は 1 文字。

**閉じ方 3 重 (auto close / クリック / 10 秒 deadline) は触っていない。**
あれが無いと全画面 overlay が残って入力を全部塞ぐ (2026-07-22 の実害)。

## 検査

- `npm run check` 0 errors
- `npx vitest run --exclude '**/*fuzz*' --exclude '**/*stall_hunt*'` 1,540 中 1,534 緑 (6 skip)
- `SHOT_DIR=... npx playwright test tests/screenshot_audit.spec.ts` を 915x412 で実行し、
  カットインの実画面を撮って確認 (ポンの帯が下家側、卓の中央は見えたまま)

### 検査で見つけて直した物

- `screenshot_audit.spec.ts` が `.cutin-overlay` を探していた。class が `.fx` に
  変わったのでそのままだと **「カットインが一度も出なかった」を黙って通す**。追従させた
- playwright の webServer が素の `python` を呼んでいて `jwt` が無く起動しない。
  本番と同じ `server/.venv/bin/python` に (start_prod.sh の PY と同じ)

## 環境のメモ (この repo の外)

playwright の browser は lane HOME ごとに別で、shun は chromium-1228、
anmika が要求するのは 1223 (yuma の HOME にある)。今回は
`PLAYWRIGHT_BROWSERS_PATH=/home/m-catlab/secretary-v2-homes/yuma/.cache/ms-playwright`
で回した。secretary 側の監査 2 回目 #7 で HF のキャッシュは共有にしたが、
playwright は手付かず。次にやるならそこ。

## まだやっていない

- 和了の「牌 → 開示 → 演出」の順番入れ替え (yuma の doc 4 章)。hule 経路 4 か所に
  手を入れるので、堅牢性の方の回帰と一緒に見たい
- D 一行テロップの常設 (履歴)。E+F には含まれない
- 音 (カットインは今も無音)。リョーの回答待ち
