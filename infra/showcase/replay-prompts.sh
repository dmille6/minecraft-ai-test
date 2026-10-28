#!/usr/bin/env bash
# ON THE SHOWCASE VM, as root: the brain replay the start gate requires (design section 2). Uses the ACTIVE release's
# code and pinned control env, a throwaway LOG_DIR/STATE_DIR (nothing reaches the showcase logs or ES), and the feed's
# newest whole bench prompts. Result: /srv/showcase/ops/replay-last.json (the gate reads it).
#   sudo /srv/showcase/bin/replay-prompts.sh
set -euo pipefail
REL=$(readlink -f /srv/showcase/harness)
[ -f "$REL/RELEASE.json" ] || { echo "no active release (stage + activate one first)"; exit 1; }
# a fresh feed; never deploys. Skipped when the caller already holds ops.lock (start-bots.sh): `follow` takes that lock and
# would wait on its own caller forever -- the newest feed-last.json is used as it is.
[ "${SHOWCASE_LOCK_HELD:-}" = 1 ] || python3 /srv/showcase/bin/showcase_ops.py follow --observe-only >/dev/null
# The env is handed to node as a DICTIONARY (never sourced: values like `url|model` are not shell-safe).
exec python3 - "$REL" <<'PY'
import json, os, subprocess, sys, tempfile
sys.path.insert(0, '/srv/showcase/bin')
import make_env as ME
rel = sys.argv[1]
r = json.load(open(rel + '/RELEASE.json'))
control = ME.parse_env(open(rel + '/control.env').read())
# The CONTROL bot's own env (its home, border, scope, role), so the rebuilt system prompt can equal the one the bench
# bot sent (the hash control); only the brain endpoint, the model and the code version are the showcase's.
env = dict(control)
env.update(OLLAMA_BASE_URLS=f'{ME.BRAIN}|{ME.BRAIN_MODEL}', OLLAMA_BASE_URL=ME.BRAIN, OLLAMA_MODEL=ME.BRAIN_MODEL,
           CODE_VERSION=r['sha'])
with tempfile.TemporaryDirectory() as tmp:
    env.update(LOG_DIR=tmp + '/log', STATE_DIR=tmp + '/state')
    os.makedirs(env['LOG_DIR']); os.makedirs(env['STATE_DIR'])
    full = dict(os.environ, **env)
    p = subprocess.run(['node', '/srv/showcase/bin/replay-prompts.mjs', '/srv/showcase/ops/feed-last.json',
                        '/srv/showcase/ops/replay-last.json'], cwd=rel, env=full)
sys.exit(p.returncode)
PY
