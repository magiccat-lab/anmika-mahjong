"""アンミカさん本人の切れ端 (pick_anmika.py の clips) から、Irodori の Speaker Inversion 用の manifest を作る (2026-10-15 駿)。
prepare_manifest.py は HF の dataset 前提なので、同じ形 (text ・ caption ・ latent_path ・ num_frames) を手で書く。
  irodori の python build_manifest.py <anmika_voice dir>
"""
import json
import sys
from pathlib import Path

import soundfile as sf
import torch
from irodori_tts.codec import DACVAECodec

D = Path(sys.argv[1])
meta = json.load(open(D / "clips.json", encoding="utf-8"))
codec = DACVAECodec.load(repo_id="Aratako/Semantic-DACVAE-Japanese-32dim", device="cuda", deterministic_encode=True, deterministic_decode=True)
lat_dir = D / "inv" / "latents"
lat_dir.mkdir(parents=True, exist_ok=True)
CAP = "明るく華やかな大人の女性が、関西弁まじりで、笑顔で楽しそうに話している。"
n = 0
with open(D / "inv" / "manifest.jsonl", "w", encoding="utf-8") as f:
    for m in meta:
        y, sr = sf.read(D / "clips" / m["file"], dtype="float32")
        wav = torch.from_numpy(y).unsqueeze(0).to("cuda")
        with torch.inference_mode():
            lat = codec.encode_waveform(wav, sample_rate=sr)[0].cpu()
        p = lat_dir / (Path(m["file"]).stem + ".pt")
        torch.save(lat, p)
        f.write(json.dumps({"text": m["text"], "caption": CAP, "latent_path": str(p), "num_frames": int(lat.shape[0])}, ensure_ascii=False) + "\n")
        n += 1
print("rows", n, "latent dim", tuple(lat.shape))
