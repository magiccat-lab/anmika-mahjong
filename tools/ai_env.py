"""AnmikaEnv: gym-like Python wrapper、 ai_env_cli.ts subprocess を spawn して step/reset を JSON で叩く。

使い方:
    env = AnmikaEnv(active=0, max_rounds=8)
    obs = env.reset(seed=42)
    while not obs['done']:
        legals = [i for i, b in enumerate(obs['legal_mask']) if b]
        action = random.choice(legals) if legals else 94  # PASS
        obs = env.step(action)

依存: subprocess [標準ライブラリのみ]、 numpy [optional]
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent  # projects/anmika-mahjong
CLI_SCRIPT = REPO_ROOT / "tools" / "ai_env_cli.ts"


class AnmikaEnv:
    def __init__(self, active: int = 0, max_rounds: int = 16, npx_path: str = "npx") -> None:
        self.active = active
        self.max_rounds = max_rounds
        env = os.environ.copy()
        # tsx 経由で起動、 stderr は親に流す
        self.proc = subprocess.Popen(
            [npx_path, "tsx", str(CLI_SCRIPT)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(REPO_ROOT),
            env=env,
            bufsize=1,
        )
        # ready signal を 待つ [stderr に "[ai_env_cli] ready"]
        line = self.proc.stderr.readline() if self.proc.stderr else ""
        if "ready" not in line:
            raise RuntimeError(f"ai_env_cli failed to start: {line!r}")

    def _send(self, req: dict[str, Any]) -> dict[str, Any]:
        if self.proc.stdin is None or self.proc.stdout is None:
            raise RuntimeError("env subprocess broken")
        self.proc.stdin.write(json.dumps(req) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            err = self.proc.stderr.read() if self.proc.stderr else ""
            raise RuntimeError(f"env subprocess died: {err}")
        return json.loads(line)

    def reset(self, seed: int = 0) -> dict[str, Any]:
        return self._send(
            {"cmd": "reset", "seed": seed, "active": self.active, "max_rounds": self.max_rounds}
        )

    def step(self, action: int) -> dict[str, Any]:
        return self._send({"cmd": "step", "action": action})

    def meta(self) -> dict[str, Any]:
        return self._send({"cmd": "meta"})

    def close(self) -> None:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        except Exception:
            pass
        self.proc.terminate()
        try:
            self.proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def random_episode(seed: int = 0, max_steps: int = 1000) -> dict[str, Any]:
    """random policy で 1 episode 走らせて step/reward summary を返す smoke test"""
    import random

    rng = random.Random(seed)
    env = AnmikaEnv()
    try:
        obs = env.reset(seed=seed)
        total_r = 0.0
        steps = 0
        while not obs["done"] and steps < max_steps:
            legals = [i for i, b in enumerate(obs["legal_mask"]) if b]
            action = rng.choice(legals) if legals else 94  # PASS
            obs = env.step(action)
            total_r += obs["reward"]
            steps += 1
        return {
            "steps": steps,
            "total_reward": total_r,
            "done": obs["done"],
            "final_player": obs["player"],
        }
    finally:
        env.close()


if __name__ == "__main__":
    import sys

    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    res = random_episode(seed=seed)
    print(json.dumps(res, indent=2))
