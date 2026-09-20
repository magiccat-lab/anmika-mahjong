# fx-delagothicone-subset.woff2

演出の語 (リーチ / ロン / ツモ / フィーバー / カン / ポン / 白ぽっち / 正 / 逆) 専用のサブセット。

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
