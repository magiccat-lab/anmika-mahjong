# fx-mochiypopone-subset.woff2 (2026-10-09 から。前は fx-delagothicone-subset.woff2)

演出の語 (リーチ / ロン / ツモ / フィーバー / カン / ポン / 白ぽっち / 正 / 逆) 専用のサブセット。
2026-10-14 に白ぽっちの絞りとサイコロの演出の字を足して取り直した (青 ・ 赤 ・ 緑 ・ 黄 ・ でかぽっち ・ 確定 ・ チップ ×2 ・ 逆払い ・ 大当り ・ ゾロ目 / リプレイ ・ 数字)。取り方は下と同じ (text= に全部の字)。
同じ日の夜、白ぽっちの強化 (ステップアップ ・ 予告 ・ プレミア) の字を足して取り直した (チャンス ・ 熱 ・ 激熱 ・ 超激熱 ・ SLOW ・ アンミカーニバル)。82 字で 12KB。
さらに華と北が揃った時のカットインの字 (四華 ・ 四北 ・ 八華 ・ 四華四北 ・ 八華四北) の 4 字 (四 ・ 華 ・ 北 ・ 八) を足して取り直した (86 字、URL は `?v=20261014c`)。

- 元: **Dela Gothic One** (SIL Open Font License 1.1、self-host 可)
- リョー「ゆうた one のフォントでカッコイイのあるでしょ」(2026-09-20) で、
  Google Fonts の「〜One」系 8 種を実際の帯の見た目で並べて比べ、これを採った。
  一番太くて小さい字でも読める。比較は tmp/fontcmp/compare.png
- 取り方: `css2?family=Dela+Gothic+One&text=<必要な字>` が返す woff2 をそのまま保存。
  **必要な 22 グリフだけ**で 2.9KB (前の Noto Sans JP 900 は 7.6KB)
- 字を増やす時は同じ手順で取り直す (text= に字を足す)。全部入りは数 MB なので使わない
- 使う所: `src/app.css` の `@font-face { font-family: 'FX Kana' }`。他では使わない

## 比べた候補 (必要 22 字のサブセット後の実寸)

| フォント | 容量 | 印象 |
|---|---:|---|
| **Dela Gothic One** | 2.9KB | **採用**。一番太い。金で小さく出しても潰れない |
| Reggae One | 2.6KB | 細身で少しレトロ |
| Train One | 5.7KB | 線画・鉄道風。金だと細くて弱い |
| RocknRoll One | 2.9KB | 丸ゴシック。柔らかい |
| Rampart One | 6.8KB | 立体の重ね。小さいと潰れる |
| Potta One | 5.6KB | 筆寄りで癖がある。和なら次点 |
| Yuji Syuku | 9.0KB | 毛筆。細くて小さい字に向かない |
| Yusei Magic | 3.5KB | 手書きマーカー |
| (前) Noto Sans JP 900 | 7.6KB | 読めるが普通 |

# zkgn/ — Zen Kaku Gothic New 500 / 700 (画面の字)

2026-10-09 shun2、見た目 b 雀荘 (リョー ○)。端末の字体まかせをやめ、卓 ・ ロビー ・ 部屋 ・ 入口の字をこれにそろえた。

- 元: **Zen Kaku Gothic New** (SIL Open Font License 1.1、self-host 可)
- Google Fonts の `css2?family=Zen+Kaku+Gothic+New:wght@500;700` が返す分割 (unicode-range ごとの woff2、
  2 太さ x 121 個) をそのまま保存し、URL だけ `/fonts/zkgn/` に書き換えて `zkgn.css` にした。
  ブラウザは画面に出た字の分割だけを読む (全部で 3.5MB あるが、1 画面で読むのは 10 個前後)
- 読み込み: `index.html` の `<link rel="stylesheet" href="/fonts/zkgn/zkgn.css">`、使う所は `src/app.css` の `--sans`
- 取り直す時は同じ URL を Chrome の UA で取り、上と同じ名前 (`zkgn-<太さ>-<連番>.woff2`) で保存する

## 2026-10-09 Mochiy Pop One に替えた

- リョー「iでいい」(カットインをダンガンロンパ風の帯にした時、字体 9 つを同じ帯で比べた中から)。
  比べたのは Dela Gothic One ・ Noto Serif JP 900 ・ Zen Old Mincho 900 ・ Potta One ・ Chokokutai ・ Darumadrop One ・ RocknRoll One ・ Rampart One ・ Mochiy Pop One
- 取り方は同じ (`css2?family=Mochiy+Pop+One&text=<必要な字>`)。演出の語に加えて「あなた」と P0〜3 も入れた (帯の右下の名前は本文の字なので要らないが、残しても数 KB)

# ci-delagothicone-line.woff2 (2026-10-14)

白ぽっちの予告の決め台詞「白って 200 色あんねん」専用。Dela Gothic One (SIL OFL 1.1) を `css2?family=Dela+Gothic+One&text=白って 200 色あんねん` で取った物 (2KB)。
先輩が 4 案 (Dela Gothic One ・ Yusei Magic ・ Rampart One ・ Mochiy Pop One) から a を選んだ。台詞を変える時は text= を変えて取り直す。使う所は `src/app.css` の 'CI Line' だけ

# fx-mochiypopone-kinpei.woff2 (2026-10-15)

NN金北のカットイン (春春金北 ・ 夏夏金北 ・ 秋秋金北 ・ 冬冬金北) で足りなかった 5 字 (春 ・ 夏 ・ 秋 ・ 冬 ・ 金)。`css2?family=Mochiy+Pop+One&text=春夏秋冬金` で取った物 (1.6KB)。
`src/app.css` で同じ 'FX Kana' に unicode-range で重ねる (元のサブセットの字の一覧は残っていないので、取り直さずに足した)

# fx-mochiypopone-fuyu.woff2 (2026-10-15)

冬冬金北の冬めくり (src/lib/FuyuFlip.svelte) の字だけのサブセット。`'FX Fuyu'` で使う (app.css)。
字は「冬金北めくりタップでラストチャンス終了合計枚+×0123456789ヒット!」。取り方は上と同じ (`css2?family=Mochiy+Pop+One&text=<字>` を Chrome の UA で取り、返る woff2 をそのまま保存)。6.5KB

# cyber/ (2026-10-29)

サイバー B 案 (金と黒) の字。Orbitron (点 ・ 数) と Chakra Petch (ラベル)、どちらも SIL OFL 1.1。latin だけの woff2 を `public/fonts/cyber/` に置き、`src/cyber.css` の `@font-face` で読む (実行時に Google Fonts へは取りに行かない)。
- `orbitron-latin-wght.woff2`: 可変 (600〜800 を 1 本で持つ)。`css2?family=Orbitron:wght@600;800` を Chrome の UA で取り、返る latin の woff2 をそのまま保存
- `chakrapetch-600-latin.woff2` ・ `chakrapetch-700-latin.woff2`: `css2?family=Chakra+Petch:wght@600;700` の latin
- 取り直す時は同じ URL を Chrome の UA で取り、`/* latin */` の url を落とす。URL に付けた `?v=` は中身を替えた時に上げる
