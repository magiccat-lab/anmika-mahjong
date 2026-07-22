# SP UI 再設計 [横持ちオンリー]

2026-07-22 リョー承認方針 + Sol(codex)設計レビューの合意版。
対象: single モード盤面。実効高 340〜500px の SP 横画面で破綻しない単一スケール構造にする。

## 決定事項

- SP は横持ちオンリー継続。portrait は案内画面を維持 [orientation lock は PWA でも全ブラウザ保証されないため]
- 既存 2900〜4400 行帯の @media パッチ層へ **新規 override を足すのは禁止** [Sol レビュー条件]
- 新レイアウトは `ui-board-v2` フラグ配下に並行構築し、完成後に旧層を一括削除 [ストラングラー方式]

## スケールトークン [「変数1本」ではなく基準1+派生4]

| token | 役割 | 目安 |
|---|---|---|
| `--tile-h` | 自家手牌の表示高 | `clamp(30px, 11dvh, 55px)` |
| `--river-tile-h` | 河牌の表示高 | `clamp(22px, 盤面短辺×0.20〜0.23, 34px)` |
| `--nuki-tile-h` | 抜き/ドラ表示 | 基準スケールから比率派生 |
| `--tap-min` | 操作ヒット領域 | 44px 固定。**表示サイズと分離**し、透明 hit 拡張で確保 [340px 高で牌自体を 44px にすると他行を圧迫] |

- Tile.svelte は CSS custom props を正式 API 化。sm/md/lg 固定値は fallback として残す
- 見た目サイズ = ヒット領域 という現行の同一視を解消。隣接 hitbox の重複は禁止

## レイアウト契約

- 行構成: `status / dora / nuki / center(minmax(0,1fr)) / hand`
- 全行 auto は 340px で center がゼロになるため、各行に block-size 上限と省略規則を持つ
  [低背: nuki ラベル短縮、status 内設定類は popover へ]
- `center-board translateY(-12vh)` の持ち上げ hack は廃止。行内で完結させる
- **ハイブリッドスケール**: 手牌・全体 chrome = dvh+clamp / 中央盤面 = container query
  - center セルは grid で寸法確定 [`minmax(0,1fr)` + `min-width/height:0`] にした上で `container-type: size`
  - 高さが子依存の container に cqh を使うと循環するため、「明示サイズのセル限定」で使う
  - fallback を必ず併記: `var(--board-side, min(34dvh, 24dvw))`
- safe-area: `100dvh` + `viewport-fit=cover` + `padding: calc(4px + env(safe-area-inset-*))`。左右席列は 15vmin 固定をやめ clamp + safe-area 込み

## 中央盤面 [board-stage]

- center 行内に明示 aspect の `board-stage` を1個置き、score と河を同じ `--board-unit` に載せる
- score 側長 = stage 短辺の 38〜42%
- score box の aspect は CSS 変数化。低背横のみ 1.35〜1.45 を単一式で許容 [正方形固執をやめ可読性優先]
- 河は 6列×最大3段の**固定 grid**。wrap 任せにしない [段が増えても座標不動]
- 容量超過時は河全体 scale や max-height clip ではなく、3段が stage に入るよう river 変数を stage から逆算 [clip は情報欠落なので不可]
- 左右河は回転後の占有寸法が入れ替わるため、wrapper 寸法と tile 座標は論理座標で決める。`top: calc(50% + 19vmin)` 系 absolute 群は撤去対象

## 操作列 [action dock]

- リーチ/カン/抜き等は右下親指域の dock に集約 [safe-area 込み bottom/right]
- dock 表示中は手牌に dock 幅分の `padding-inline-end` を予約して誤タップ回避
- 複数ボタンは 44px を縦積みしない。primary 1個 + 展開、または横並び

## モーダル共通 Sheet

- 共通化は**見た目の shell だけ**。業務 props [canOperate/winner/候補/roll/onSelect等] は各 feature component に残す
- Sheet API: `open / ariaLabel / tone / dismissible=false [進行 modal は原則閉じ不可] / size: compact|standard|wide` + header/body/footer 3 slot。body scroll・safe-area padding・focus containment・SP全画面/desktop panel 切替を持つ
- Svelte 5 なので snippets/render props 第一候補 [既存 slot 統一箇所の無理な全移行は不要]
- 移行順: Pochi 2種 [markup ほぼ同一] → Fuyu/Kinpei → SaiKoro → RoundEnd 最後
  [RoundEnd は panel + inline 金北を含む。金北は「和了結果を見ながら選ぶ」要件があるため body 内 sub-flow のまま]

## 移行手順 [commit 単位]

- A. スクショ基線: 844x390 / 915x412 / 実効高340相当 + safe-area 疑似。bbox assert 込み
- B. Tile CSS props API 化 + hit target 分離 [見た目不変]
- C. v2 grid root [5行 + safe-area + center-cell/board-stage]。score/河の見た目は未移植
- D. score → 河 → nuki → action dock の順に v2 へ。各段でスクショ
- E. modal Sheet 化
- F. v2 固定後、旧 @media 2層・重複宣言・!important 群・flag を一括除去

優先順位: A → B → C → score+river → hand/action → Sheet。
中央 stage までを最初の塊 [P1] に含める [変数導入だけだと現行 hack に拘束されるため]。

## 検証 [Playwright assertion 化]

- 自家14牌が viewport 内
- 全操作 hitbox >= 44px
- score / 河 / nuki の bbox 非交差
- 視覚回帰: screenshot_audit.spec.ts に SP viewport 追加

## 完了条件

- S24 横 [実効高 340px] で手牌タップ 40px 以上
- パッチ用 @media / !important ゼロ [旧層一括削除完了]
- 全モーダルがスクロールなしで要点視認
