# アンミカ web 三麻アプリ

華八アンミカ筋肉五等ルール準拠の三人麻雀 web アプリ。

🔗 公開 URL: https://anmika.magiccatlab.com/

## 目的
- 標準三麻 → アンミカルール → CPU 機能 → オンライン対戦 / 牌譜検討
- ルール詳細: [`data/notes/anmika_rules.md`](./data/notes/anmika_rules.md) [WIP、 順次公開]

## ベース技術
- フロント: Svelte + TypeScript + Vite
- バックエンド: FastAPI [Python 3.12+] + sqlite + WebSocket
- AI: PyTorch policy network [tools/ 配下、 学習スクリプトのみ、 重みは public repo に含めない]
- [@kobalab/majiang-core](https://github.com/kobalab/majiang-core) [4 麻 → 三麻に拡張、 PR 候補]
- 関連: [majiang-ai](https://github.com/kobalab/majiang-ai) [思考ルーチン]、 [majiang-server](https://github.com/kobalab/majiang-server)

## 開発

### フロント
```bash
npm install
npm run dev      # vite dev サーバ
npm run build    # dist/ ビルド
npm test         # vitest unit test
npx playwright test  # e2e [server 起動が前提]
```

### サーバ
```bash
cd server
pip install -r requirements.txt
# 主な env 変数 [`.env.example` 参照]:
#   ANMIKA_DB_PATH=...                 # デフォルトは server/data/anmika.db
#   ANMIKA_PUBLIC_BASE_URL=...         # OAuth callback / 招待 URL に使う
#   DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET   # Discord OAuth
#   ANMIKA_JWT_SECRET=...              # JWT 署名
#   ANMIKA_TEST_AUTH=1                 # ローカルテスト用の擬似 login
uvicorn app:app --reload --port 8080
node --import tsx ws_server.ts          # WebSocket 中継 [別ターミナル]
```

## phase
- **Phase 1**: 標準三麻 ローカル対戦 ✅
- **Phase 2**: アンミカルール組込み ✅
- **Phase 3**: WebSocket オンライン対戦 + 牌譜保存 [active]
- **Phase 4**: CPU + 牌譜検討 UI [active]

## コントリビュート

知人デバッグ用に public 化済。 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 参照。 GitHub Issue で再現手順・期待値・実際の動作を書いてくれると助かる。

## License

MIT [`LICENSE`](./LICENSE) 参照。
