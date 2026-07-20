"""学習済み policy [.pt] を TS 推論用に書き出す [2026-07-20 yuma]

背景:
  src/ai/ の学習パイプラインは実戦コードから一度も import されていない。
  学習結果を対戦 CPU に効かせるには、重みをブラウザ側で読める形に落として
  TS で forward するのが一番軽い。ネットワークは

      shared: Linear(obs_dim, 256) -> ReLU -> Linear(256, 256) -> ReLU
      policy_head: Linear(256, act_dim)

  の 3 層だけなので、onnxruntime も torch も要らない。

出力:
  <out>/policy_meta.json   … 層ごとの shape と float32 offset
  <out>/policy_weights.bin … float32 little-endian の連結

使い方:
  python3 tools/export_policy.py --ckpt ai/ckpt_v13.pt --out public/ai
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

# 推論に要るのは policy 側だけ。value_head は学習専用なので出さない
LAYERS = ["shared.0", "shared.2", "policy_head"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ckpt", required=True)
    parser.add_argument("--out", default="public/ai")
    args = parser.parse_args()

    state = torch.load(args.ckpt, map_location="cpu")
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    buf = bytearray()
    layers: list[dict] = []
    for name in LAYERS:
        weight = state[f"{name}.weight"].detach().cpu().float().numpy()
        bias = state[f"{name}.bias"].detach().cpu().float().numpy()
        entry = {
            "name": name,
            "out": int(weight.shape[0]),
            "in": int(weight.shape[1]),
            "weightOffset": len(buf) // 4,
        }
        buf += weight.astype("<f4").tobytes()
        entry["biasOffset"] = len(buf) // 4
        buf += bias.astype("<f4").tobytes()
        layers.append(entry)

    meta = {
        "format": "anmika-policy-v1",
        "activation": "relu",
        "obsDim": layers[0]["in"],
        "actionSpace": layers[-1]["out"],
        "floatCount": len(buf) // 4,
        "layers": layers,
    }

    (out_dir / "policy_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    (out_dir / "policy_weights.bin").write_bytes(bytes(buf))
    print(f"[export_policy] {args.ckpt} -> {out_dir}")
    print(f"[export_policy] obs_dim={meta['obsDim']} action_space={meta['actionSpace']} "
          f"floats={meta['floatCount']} ({len(buf) / 1024 / 1024:.2f} MB)")


if __name__ == "__main__":
    main()
