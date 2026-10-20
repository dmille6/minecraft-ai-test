#!/usr/bin/env bash
# ON THE SHOWCASE VM, as root: the brain replay the start gate requires (design section 2). Uses the ACTIVE release's
# code and pinned control env, a throwaway LOG_DIR/STATE_DIR (nothing reaches the showcase logs or ES), and the feed's
# newest whole bench prompts. Result: /srv/showcase/ops/replay-last.json (the gate reads it).
#   sudo /srv/showcase/bin/replay-prompts.sh
set -euo pipefail
REL=$(readlink -f /srv/showcase/harness)
[ -f "$REL/RELEASE.json" ] || { echo "no active release (stage + activate one first)"; exit 1; }
SHA=$(python3 -c "import json; print(json.load(open('$REL/RELEASE.json'))['sha'])")
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
python3 /srv/showcase/bin/showcase_ops.py follow >/dev/null       # a fresh feed (the prompts ride in it)
python3 - "$REL" "$SHA" "$TMP" <<'PY'
import json, sys
sys.path.insert(0, '/srv/showcase/bin')
import make_env as ME
rel, sha, tmp = sys.argv[1:4]
control = ME.parse_env(open(rel + '/control.env').read())
site = {'home': [0, 70, 0], 'board': [3, 70, 0], 'border_radius': 5000}   # placement is irrelevant to the prompt
rows = dict(ME.build_env(control, 0, site, sha))
rows['BOT_NAME'] = 'showcase-Alpha'
rows['LOG_DIR'], rows['STATE_DIR'] = tmp + '/log', tmp + '/state'
open(tmp + '/replay.env', 'w').write('\n'.join(f'{k}={v}' for k, v in rows.items()) + '\n')
PY
mkdir -p "$TMP/log" "$TMP/state"
cd "$REL"
set -a; . "$TMP/replay.env"; set +a
node /srv/showcase/bin/replay-prompts.mjs /srv/showcase/ops/feed-last.json /srv/showcase/ops/replay-last.json
