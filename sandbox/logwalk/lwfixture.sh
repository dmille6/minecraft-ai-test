#!/usr/bin/env bash
# SANDBOX-ONLY (logwalk-01show rig fixture), ON the worlds host under the sandbox2 lock: the cut list (lwrig.mjs LW_FIXR) applied to
# sandbox2's world copy -- every free log within the radius set to air, the town's chunks force-loaded for it -- then saved.
#   lwfixture.sh <cmds file>
set -euo pipefail
R() { python3 /home/mike/t11rcon.py sandbox2 "$@"; }
R "forceload add -96 -96 96 96" >/dev/null; sleep 4
mapfile -t cmds < "$1"
ok=0; for ((i = 0; i < ${#cmds[@]}; i += 20)); do o=$(R "${cmds[@]:i:20}"); ok=$((ok + $(grep -c 'Changed the block' <<< "$o" || true))); done
R "forceload remove -96 -96 96 96" "save-all flush" >/dev/null
echo "fixture: ${#cmds[@]} lines, $ok changed"
