#!/usr/bin/env python3
"""norosh1.com の公開牌譜を全部落とす (2026-09-13、リョー許可済み。robots.txt は Allow: /)。

- /api/replay?page=N&limit=100 で一覧を舐めて gameId を集め、
  /api/replay/{gameId} を data/norosh/games/{gameId}.json に保存する
- 既にある局は飛ばす (再実行で差分だけ取る)。間隔 0.35 秒、失敗は指数バックオフで 5 回まで
- 進捗は data/norosh/fetch.log に 1 行ずつ
"""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path

BASE = "https://norosh1.com"
ROOT = Path(__file__).resolve().parents[1] / "data" / "norosh"
GAMES = ROOT / "games"
LOG = ROOT / "fetch.log"
INTERVAL = 4.0          # 実測の上限は 15 req/分 (2026-09-13)。4 秒間隔でちょうど張り付く。429 は待って続行
UA = "anmika-mahjong audit fetch (magiccatlab, contact via site) python-urllib"
BACKOFF_429 = 20.0


def log(msg):
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}"
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


def get(url, tries=5):
    """429 は失敗に数えない。Retry-After があればそれ、無ければ 20 秒から倍々で待って続ける"""
    delay, wait429, i = 2.0, BACKOFF_429, 0
    while True:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                ra = e.headers.get("Retry-After") if e.headers else None
                w = float(ra) if ra and ra.replace(".", "", 1).isdigit() else wait429
                log(f"429 wait {w:.0f}s {url}")
                time.sleep(w)
                wait429 = min(wait429 * 2, 300.0)
                continue
            err = e
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as e:
            err = e
        i += 1
        if i >= tries:
            raise RuntimeError(f"gave up: {url}: {err}")
        log(f"retry {i}/{tries} {url}: {err}")
        time.sleep(delay)
        delay *= 2


def main():
    GAMES.mkdir(parents=True, exist_ok=True)
    first = get(f"{BASE}/api/replay?page=1&limit=100")
    total, pages = first["total"], first["totalPages"]
    log(f"list: total={total} pages={pages}")
    index = {}
    page_games = first["games"]
    page = 1
    while True:
        for g in page_games:
            rs = ((g.get("rule") or {}).get("options") or {}).get("ruleSet") or {}
            index[g["gameId"]] = {"recordedAt": g.get("recordedAt"), "players": g.get("players"),
                                  "ruleVersion": (g.get("rule") or {}).get("version"),
                                  "variant": rs.get("variant"), "goldNorthCount": (rs.get("tileSet") or {}).get("goldNorthCount"),
                                  "ruleSet": rs}
        if page >= pages:
            break
        page += 1
        time.sleep(INTERVAL)
        page_games = get(f"{BASE}/api/replay?page={page}&limit=100")["games"]
        if page % 10 == 0:
            log(f"list page {page}/{pages} ids={len(index)}")
    (ROOT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=0), encoding="utf-8")
    log(f"index saved: {len(index)} games")
    # 三麻を先に (うちのエンジンは三麻。四麻卓は 4 割あるので後回し)
    todo = [gid for gid in index if not (GAMES / f"{gid}.json").exists()]
    todo.sort(key=lambda gid: (0 if index[gid].get("variant") == "sanma" else 1, gid))
    log(f"to fetch: {len(todo)} (have {len(index) - len(todo)})")
    for n, gid in enumerate(todo, 1):
        data = get(f"{BASE}/api/replay/{gid}")
        tmp = GAMES / f"{gid}.json.tmp"
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(GAMES / f"{gid}.json")
        if n % 100 == 0 or n == len(todo):
            log(f"fetched {n}/{len(todo)}")
        time.sleep(INTERVAL)
    log("DONE")


if __name__ == "__main__":
    main()
