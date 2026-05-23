# anmika ブラウザ regression check

## 必要 deps
- playwright + chromium [既存 node_modules、 git ignored]

## 使い方
```
npm run dev  # dev server [vite]
# 別 terminal で:
node ai/browser_check.mjs       # CPU 3 人 自動連打 で半荘走らせ、 error 捕捉
node ai/browser_scenarios.mjs   # 14 個 scenario preset 全 click で error 捕捉
```

env var TIMEOUT_MS で browser_check.mjs の自動連打 timeout 調整。
