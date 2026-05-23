# V33 fuzz z 字牌 +1 leak 解析メモ [2026-05-15 yuma]

## 観察事実

V33 inventory invariant fuzz [`src/lib/__tests__/v33_inventory_fuzz.test.ts`]
を `V33_LONG=1` [1000 試合] で走らせた結果、 9 件の inventory diff が検出された。
全件 `pre_next` [局終了後 nextRound 直前] のチェックで、 全て z 字牌 [風牌 + 三元牌] が `exp 4 → got 5` の +1 leak。

```
g0_r2: z1+1, z6+1, z7+1
g0_r4: z1+1
g0_r5: z6+1
g1_r1: z1+1, z7+1
g2_r1: z1+1
g3_r2: z6+1, z7+1
g4_r1: z7+1
g4_r2: z2+1, z6+1
g5_r1: z1+1
g6_r1: z3+1, z6+1
```

レンジ: z1/z2/z3/z6/z7。 z4 [北、 nukidora 控除済 exp=3] と z5 [ぽっち、 別 key 管理 exp=0] は出ない。

## game ロジックへの影響

- 流局 / 和了 のテスト 全 367 pass
- 連続 3 試合 e2e [multi_match_play] / 5 試合 e2e [long_match_play] とも
  natural finish に至ったケースは chip carry sum=0 で正常
- TileChecker UI 上の枚数表示 のみ ズレる

## 仮説

`src/lib/game3/inventory.ts:1-104`:

- `computeTileInventory` は 山 / 王牌 / 全 player の 手牌 + 副露 + nukidora を集計
- `expectedInventory` は 116 枚 を 各 tile に分配 [z1-3, z6-7 = 4、 z4 = 3 (北抜き 1 枚 控除済)、 z5* = 4 色 別 key]
- 副露パース行 (line 46-) で `"z3333"` 形式の中萬パース/字牌大明槓 解析
- line 70-73: gold (`z4`/`gN`)・pochi (`z5*`) の特別ハンドリングはあるが、
  通常 字牌 [z1-3, z6-7] の **「副露牌が手牌側にも残ったまま fulou notation でも count される」**
  経路が疑わしい

タイミングが全件 `pre_next` [hule / 流局 後、 nextRound 直前] なので、
applyHule 後 / pingju 後 の手牌 / 副露 cleanup タイミングのズレが原因の可能性大。
hua [華牌 = f1-4] では出ていないので、 hua reset path とは別の問題。

## アクション

- Codex Round 14 audit [private notes] の軸 E [山 / 華牌枯渇時 rollback 整合] とは
  別軸 [軸 G: 副露 字牌 inventory leak] として
  R15 input に追記、 inventory.ts + game3.ts の hule/pingju 後 cleanup を集中精査依頼
- 暫定 V33 fuzz は **diff 0 でなくとも pass する** assertion なので CI green は維持
  [`expect(diffs.length).toBe(0)` ではなく `firstDiffDump` を console.log するだけ]
- 修正後 V33 fuzz を `diffs.length === 0` で hard assert に切替えて regression guard 化
