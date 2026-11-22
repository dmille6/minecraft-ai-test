# mcai-analysis VM: the full-history analysis host (created 2026-11-22)

- **VM 211 on pve1, 10.0.0.45** (`ssh mike@10.0.0.45`). 16 cores, 64 GB RAM, 500 GB disk on `vmdata`, starts on boot.
- Python venv `~/venv` with DuckDB 2.0.1, PyArrow 26, zstandard and orjson. The ELK read-only key is at `~/.config/mcai/es-readonly.key` (mode 600),
  copied from .31 for this analysis host.
- `full_export.py <index> <first-day> <last-day>` writes one zstd NDJSON file per index per UTC day to `~/mcai/raw/<index>/`. It can be resumed.
  The full export of `mcai-llm-agents`, `mcai-llm-showcase`, `mcai-skill-agents` and `mcai-skill-showcase` (2026-07-01 → 11-22) started 11-22 ~22:30Z.
- **Size of the history** (ES counts, 11-22): decisions 7.54M (08-01 to 10-07) + 7.46M fleet + 0.57M showcase (10-08 onward), so **about 15.6M**.
  Skill and event rows: 45.3M + 73.4M + 7.6M, so **about 126M**.
- Known gaps (see `scripts/lib/estelemetry.py`): 10-07 holds duplicates, llm 09-08 is missing, 09-09..09-16 was backfilled, and about 50 rows are lost at each daily rotation.
