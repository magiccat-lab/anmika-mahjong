# fx-notosansjp-900-subset.woff2

演出の語 (リーチ / ロン / ツモ / フィーバー / カン / ポン / 白ぽっち / 正 / 逆) 専用のサブセット。

- 元: Noto Sans JP Weight 900 (SIL Open Font License 1.1、self-host 可)
- 取り方: Google Fonts の `css2?family=Noto+Sans+JP:wght@900&text=<必要な字>` が返す
  woff2 をそのまま保存した。**必要な 22 グリフだけ**入っているので 7.6KB
- 字を増やす時は同じ手順で取り直す (text= に字を足す)。全部入りは 4MB 超なので使わない
- 使う所: `src/lib/fxArtwork.ts` の `@font-face`。他では使わない
