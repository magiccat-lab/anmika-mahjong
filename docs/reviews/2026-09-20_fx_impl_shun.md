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

## codex への発注 (ANMIKA-FX-02、2026-09-20 15:5x 送信・返答待ち)

リョー「ポンの文字だせー、codex に gptimage2 使いながらデザイン案考えさせて
コード化させれば？ポッチもね」。帯の中が**ゴシック体の素の文字**なのが不満点。

| 項目 | 内容 |
|---|---|
| ID | ANMIKA-FX-02 |
| 宛先 | codex (team secretary) |
| 依頼 | カットインの「語」の見せ方を image_gen (gpt-image-2) で 3〜5 案、ぽっち開封を 2〜3 案。contact sheet 1 枚 + 第一候補の実装まで |
| 成果物 | `tmp/fx02-out/` (contact sheet / README.md / shots) |
| 状態 | **納品・検収済 (003dd06 で取り込み)** |

### 納品と検収 (2026-09-20 16:0x)

codex は 比較画像 4 案 + ぽっち 3 案を `tmp/fx02-out/contact-sheet.png` に出し、
第一候補 **A (金の線の文字図案) + P1 (牌の横に添える文字と印)** を実装した。

- `src/lib/fxArtwork.ts` 新設。6 語 + 白ぽっちの専用 SVG パスを data URI で持つ。
  **追加フォント無し・初回表示の追加通信 0 件**。案の差し替えはこの map か artwork prop
- bundle: JS 557.14 → 558.07KB (+0.93)、CSS 107.94 → 107.18KB (-0.76)
- 制約 (卓を隠さない / 金 1 色 / transform と opacity / 3 DOM / 尺据え置き / 絵文字なし) は
  読んで確認した。App と store のタイマー・watchdog・queue は未変更、ぽっちの閉じ方 3 重も維持

**codex 側で未達だった検収をこちらで実施**した。codex 環境は localhost socket が EPERM、
Chromium も sandbox で起動できず、全 vitest と実画面が取れないと自己申告していた。

| 検査 | 結果 |
|---|---|
| npm run check | 0 errors |
| vitest 高速 | 1,534 緑 (6 skip) |
| 実画面 915x412 | ポン / ロン / フィーバー / ぽっち開封前後を撮って目視 |

**検収でこちらが直した物**: ぽっちの札が中央の点数パネルに重なっていた
(`--anchor-x` 28% → 18%、狭い画面は 17%)。実画面を撮るまで気づけない型。

codex が `screenshot_audit.spec.ts` に「カットインを一度以上観測する」の assert を
足したのは良い。これが無いと演出が出なくても黙って通る。

渡した制約 (外すと差し戻し): 卓を隠さない / 色は金 1 つ / transform と opacity だけ /
3 DOM 以内 / 尺 3 段は store と両方 / 絵文字なし / webfont は self-host で数字を出す。

壊してはいけない物として、overlay が表示専用である事 (タイマーは App が単一所有者)、
ぽっちの閉じ方 3 重、screenshot_audit の `.fx` selector を明記した。

commit はさせない。差分で受けてこちらが検収してから入れる。

## 字が案と別物だった件 (2026-09-20、リョー指摘 → 1c1d927 で修正)

リョー「2枚目3枚目が実際の画像？フォントとか全然ちゃうやん」。**指摘のとおりだった。**

- 比較画像 (contact-sheet.png) は gpt-image-2 が描いた**絵**
- 実装は codex がその見た目を**手書きの SVG ストローク**で近似した物で、字形が別
- codex は README に「生成画像のピクセル再現ではない」と書いていた。
  **こちらがそれを報告で落とし、「実画面です」とだけ出したのが良くなかった**

直し方: 手書きパスをやめて実フォントにした。

- Noto Sans JP 900 を演出で使う **22 グリフだけサブセット**して self-host。**7.6KB**。
  SIL OFL 1.1 なので同梱できる。取り方は `public/fonts/README.md`
- システムにあった游ゴシックは Windows 由来で **web 配布できない**ので使わない
- 語を `<img src=dataURI>` から実テキストへ。**SVG を img で出すと外部フォントが効かない**。
  要素数は増やしていない (ぽっちの語はボタンの本文テキスト)
- `font-display: block` + preload。0.7 秒の演出なので、違う字で出てから入れ替わるより
  少し待って正しい字が出る方を取る

容量: JS 558.07 → 556.59KB (手書きパスが消えて減った)、CSS 107.18 → 107.39KB、font +7.6KB。

**学び**: 生成画像で案を作った時は、実装がその画像をどう再現したのかを必ず見る。
「実装した」と「案どおりに見える」は別。実画面のスクショを並べて初めて分かる。

## フォント選び直しと、読めていなかった件 (2026-09-20 → eb93f6b)

リョー「ゆうた one のフォントでカッコイイのあるでしょ、探して使ってよ」。

Google Fonts の「〜One」系 8 種を、**実際の帯の色・大きさ・金でそのまま並べて**比べた
(`tmp/fontcmp/compare.png`)。採ったのは **Dela Gothic One**。

| フォント | 22字サブセット | 印象 |
|---|---:|---|
| **Dela Gothic One** | **2.9KB** | **採用**。一番太い。金で小さく出しても潰れない |
| Reggae One | 2.6KB | 細身で少しレトロ |
| Train One | 5.7KB | 線画・鉄道風。金だと弱い |
| RocknRoll One | 2.9KB | 丸ゴシック |
| Rampart One | 6.8KB | 立体の重ね。小さいと潰れる |
| Potta One | 5.6KB | 筆寄り。和なら次点 |
| Yuji Syuku | 9.0KB | 毛筆。小さい字に向かない |
| Yusei Magic | 3.5KB | 手書きマーカー |
| (前) Noto Sans JP 900 | 7.6KB | 読めるが普通 |

### この作業で見つけた 2 件 — どちらも「画面は出るので気づけない」型

1. **フォントが一度も読めていなかった。** `server/app.py` は `/assets` `/sounds` `/tiles`
   しか mount しておらず `/fonts` が 404。`@font-face` が error になり黙って
   システムのフォントに落ちる。**前の節で「実画面で字形を確認」と書いた物は
   実際はフォールバックだった**。mount を足して解決
2. **文字色が金になっていなかった。** `App.svelte` の `main.mode-single` が色を
   `!important` で撒いていて負けていた。**実画素を測って**白 (rgb 232,232,232) の
   ままなのを確認してから `!important` で上書き。今は金 (rgb 217,180,83)

**学び**: 見た目の確認は目視で終わらせない。`document.fonts` の status と、
出ている画素の色を測る。スクショを見ただけでは「フォントが当たっていない」も
「色が負けている」も気づけなかった。

## まだやっていない

- 和了の「牌 → 開示 → 演出」の順番入れ替え (yuma の doc 4 章)。hule 経路 4 か所に
  手を入れるので、堅牢性の方の回帰と一緒に見たい
- D 一行テロップの常設 (履歴)。E+F には含まれない
- 音 (カットインは今も無音)。リョーの回答待ち
