#!/usr/bin/env bash
# 全曲の歌を 16 小節ずつ (前後に 1 小節の重なり) GAME にかける
S=/tmp/claude-1000/-home-m-catlab-secretary-v2-prod/61738d81-d23a-4cf2-9ae0-7d3e1a4e86c6/scratchpad
PY=/home/m-catlab/secretary-v2-homes/shun/stt/venv/bin/python
T0=1.420844930980664; BAR=1.875
for c in 0 1 2 3 4 5 6 7; do
  a=$(python3 -c "print(max(0, $T0 + ($c*16 - 1)*$BAR))")
  d=$(python3 -c "print(18*$BAR)")
  $PY -I $S/chip3/game_onnx.py $S/game_models/large/GAME-1.0.3-large-onnx $S/chip/sep/htdemucs/song/vocals.wav $a $d $S/chip4/game_chunk_$c.json ja
done
