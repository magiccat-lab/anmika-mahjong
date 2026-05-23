# コントリビュート

知人デバッグ用の public repo。 issue / PR ともに歓迎。

## bug 報告 [Issue]

最低限 以下を書いてくれると助かる:

- 再現 URL [https://anmika.magiccatlab.com/ 本番 / 手元 local どちらか]
- ブラウザ [Chrome / Safari / Edge + バージョン]
- 再現手順 [step1, step2, ...]
- 期待した動作 / 実際の動作
- 牌譜 / スクリーンショットあれば添付
- console error あれば copy

## PR

- branch 名は `fix/<内容>` か `feature/<内容>`
- `npm test` [vitest] が通ること
- e2e [Playwright] は本番依存なので通らなくても OK、 但し意図的な break は事前に Issue で相談
- commit message は日本語 OK、 内容が分かれば形式自由

## セットアップ

[`README.md`](./README.md) 参照。 server 側は別途 `.env` が必要 [Discord OAuth client / JWT_SECRET 等]、 ローカル試運転だけなら `ANMIKA_TEST_AUTH=1` で擬似 login 経路が開く。
