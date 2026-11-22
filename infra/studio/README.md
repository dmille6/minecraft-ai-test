# Mac Studio (M4 Max, 128 GB, 10.0.0.241): judge and teacher for the week of 2026-11-22

- Access: `ssh mike@10.0.0.241`. After a restart, FileVault needs one local login before SSH works. No sudo, so the GPU wired-memory limit stays at the macOS default (~75% of 128 GB).
- Installed: Homebrew `llama.cpp` (build 10280) and `uv`; `mlx-lm==0.32.2` and the `hf` CLI as uv tools.
- Models in `~/mcai/models`: `mlx-community/Qwen3.5-122B-A10B-4bit`, `mlx-community/gpt-oss-120b-4bit`, `mlx-community/Qwen3.8-27B-8bit`.
- Replay set: `replay-1000.jsonl`. 1,000 real decisions from ELK (showcase + fleet, 7 days), stratified by skill × outcome and split by bot session
  into `screen` (547) and `final` (453). Copies: the Studio's `~/mcai/`, and the NAS `proxmox_data_share/mcai-new/`. Built with `export_replay.py` on .31.
- `overnight.sh` waits for the downloads, then runs `judge.py` with Qwen3.5-122B-A10B (thinking off) and then gpt-oss-120b (reasoning low), one at a time,
  writing `labels-<judge>.jsonl`. It can be resumed. Logs are in `~/mcai/logs/`.
- Labels: acceptable skills, decision ok / args ok (yes, no, unclear), and a short reason. **Only labels both judges agree on count**; a sample is checked by hand.
