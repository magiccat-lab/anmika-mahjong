# 2026-07-18 リョー裁定: 嶺上開花の適用範囲 / ゾロ目連続特典

Discord でのリョー報告 2 件に対する裁定と実装。

## 裁定 1: 嶺上開花はカン補充のみ

- 北抜き・華抜きの補充牌ツモに嶺上開花は付かない。カン (暗槓/加槓/大明槓) の補充のみ。
- 海底摸月の抑制は従来どおり: 北・華の補充ツモは山 0 枚でも海底扱いにしない。
- 実装: `game3.ts` に `lingshangFromKan` を追加。`lingshangActive` [補充牌 state] と分離し、
  ヤク判定だけ `lingshangActive && lingshangFromKan` を使う。
- 牌譜互換: `lingshangFromKan` の無い旧牌譜は `lingshangActive` の値を引き継ぐ [旧 semantics]。

## 裁定 2: ゾロ目連続特典はシュバ不問・固定額

- 発動: サイコロチャンス中にゾロ目が 2 連続した時点から。シュバリー宣言・常時シュバサイ
  [alwaysShuvari] の有無は関係ない [従来はシュバサイ限定だった]。
- 額: 2 回目以降の各ゾロ目の出目で固定。1,1→111 / n,n→n×11 [22/33/44/55/66] 枚オール。
- 倍率: シュバリー・ぽっち・FEVER いずれも乗せない [固定]。
- 払いサイコロ [赤/黄=逆ぽっち] の時は同額のまま払い扱い [符号だけ反転、-2 倍で -44 にはしない]。
  判定は winner の pochiMultiplier.chip の符号。ron 由来チャンスは非フィーバー時ぽっち無効の
  engine 慣例に従う。
- 実装: `store.ts` rollSaiKoroDice。label/表示は「ゾロ目連続特典」に改称。

## 関連

- 2026-07-15 裁定 [`2026-07-15_rule_rulings_and_implementation.md`] の「shuvariApplicable=true の
  シュバサイは宣言不要」はこの裁定 2 で上書き [シュバサイ概念自体がゾロ目判定から外れた]。
- テスト: `lingshang_source_2026_07_18.test.ts` / `saiKoro_actions.test.ts` / `nuki_bei.test.ts` /
  `flow_rules_regression.test.ts`
