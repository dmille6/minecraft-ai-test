#!/bin/bash
# canary-tree.sh against a FIXTURE DIRECTORY, with a stub systemctl. No fleet, no sudo, no deploy.
#
# WHY THIS FILE EXISTS. The three-step teardown was a rule in CLAUDE.md, and the script implemented
# one of the three steps and printed a sentence asking a human to do the second. That is the shape
# this project has measured failing: a correct remedy, printed, and not acted on. It could not be
# tested because every path was hardcoded to /srv, /etc and systemctl, so the only way to exercise a
# teardown was to tear down a real canary.
#
# The paths are overridable now (MCAI_HARNESS, MCAI_CANARY_TREE, MCAI_UNITDIR, TRIAL_MANIFEST,
# MCAI_LIB, SYSTEMCTL, MCAI_STAGGER), with the production values as defaults, so this drives the
# real script and asserts on what it did to the filesystem and on which units it restarted.
#
# THE CENTRAL ASSERTION is step 3: that teardown restarts EXACTLY the bots that were treated. The
# old path reconstructed them as `Alpha Bravo Comet Delta Echo` across the manifest's pool names,
# which for a within-world canary expands to nothing at all -- so the check that matters is not
# "did it restart five" but "did it restart the drawn set and nobody else".
#
# Run: bash scripts/test_canary_tree.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
TREE=$HERE/canary-tree.sh
PASS=0; FAIL=0

t_ok()  { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  [PASS] $1"; \
          else FAIL=$((FAIL+1)); echo "  [FAIL] $1"; echo "         got:  $2"; echo "         want: $3"; fi; }
t_true() { if [ "$2" = "1" ]; then PASS=$((PASS+1)); echo "  [PASS] $1"; \
           else FAIL=$((FAIL+1)); echo "  [FAIL] $1  ${3:-}"; fi; }

# ---------------------------------------------------------------- the fixture --
mkfixture() {
  ROOT=$(mktemp -d "${TMPDIR:-/tmp}/canarytree.XXXXXX")
  export MCAI_HARNESS=$ROOT/harness
  export MCAI_CANARY_TREE=$ROOT/harness-canary
  export MCAI_UNITDIR=$ROOT/units
  export TRIAL_MANIFEST=$ROOT/trial-manifest.json
  export MCAI_LIB=$HERE/lib
  export MCAI_STAGGER=0
  export SYSTEMCTL=$ROOT/bin/systemctl
  export SCLOG=$ROOT/systemctl.log
  mkdir -p "$MCAI_HARNESS/env" "$MCAI_HARNESS/node_modules" "$MCAI_UNITDIR" "$ROOT/bin" \
           "$ROOT/repo/bots/src"
  echo 'export default 1;' > "$ROOT/repo/bots/src/index.mjs"
  echo '{"name":"bots"}'  > "$ROOT/repo/bots/package.json"
  # A stub systemctl that RECORDS what it was asked to do. `show -p WorkingDirectory` answers from
  # the drop-in on disk, which is what real systemd would resolve to.
  cat > "$SYSTEMCTL" <<'STUB'
#!/bin/bash
echo "$*" >> "$SCLOG"
case "$1" in
  show) unit=""; for a in "$@"; do case "$a" in mcbot@*) unit=$a;; esac; done
        b=${unit#mcbot@}; b=${b%.service}
        d="$MCAI_UNITDIR/mcbot@$b.service.d/10-canary.conf"
        if [ -f "$d" ]; then grep -m1 '^WorkingDirectory=' "$d" | cut -d= -f2
        else echo "$MCAI_HARNESS"; fi ;;
  list-units) for u in $FIXTURE_ACTIVE; do echo "mcbot@$u.service loaded active running x"; done ;;
esac
exit 0
STUB
  chmod +x "$SYSTEMCTL"
  export FIXTURE_ACTIVE="hive-a-Alpha hive-a-Bravo hive-a-Comet hive-a-Delta hive-a-Echo \
board-c-Alpha board-c-Bravo board-c-Comet board-c-Delta board-c-Echo"
}

manifest() {   # $1=canary_pool-or-empty  $2=canary_sha  $3...=roster
  local pool="$1" sha="$2"; shift 2
  MAN="$TRIAL_MANIFEST" LIB="$MCAI_LIB" POOL="$pool" SHA="$sha" ROSTER="$*" python3 - <<'PY'
import json, os, sys
sys.path.insert(0, os.environ['LIB'])
import canary_manifest as cm
pool, sha = os.environ['POOL'], os.environ['SHA']
bots = [b for b in os.environ['ROSTER'].split() if b]
kw = {}
if bots: kw = {'roster': bots, 'canary_sha': sha}
elif pool: kw = {'pool': pool, 'canary_sha': sha}
json.dump(cm.declare('rl-14', '16e7e77', **kw), open(os.environ['MAN'], 'w'), indent=2)
PY
}

restarted() { grep -o 'restart mcbot@[^ ]*' "$SCLOG" 2>/dev/null \
              | sed 's/restart mcbot@//; s/\.service//' | sort -u | tr '\n' ' ' | sed 's/ $//'; }
dropins()   { ls -d "$MCAI_UNITDIR"/mcbot@*.service.d 2>/dev/null | while read -r d; do
                [ -f "$d/10-canary.conf" ] || continue
                b=$(basename "$d" .service.d); echo "${b#mcbot@}"; done | sort | tr '\n' ' ' | sed 's/ $//'; }
declared()  { MAN="$TRIAL_MANIFEST" LIB="$MCAI_LIB" python3 -c '
import json, os, sys; sys.path.insert(0, os.environ["LIB"])
import canary_manifest as cm
d = cm.load(json.load(open(os.environ["MAN"])))
print(d.describe())'; }

echo
echo '1. WITHIN-WORLD build: 2 of 5 bots in each of two worlds'
mkfixture
DRAWN="hive-a-Alpha hive-a-Bravo board-c-Comet board-c-Delta"
manifest "" 2705838 $DRAWN
bash "$TREE" build "$ROOT/repo" 2705838 rl-14 $DRAWN > "$ROOT/build.log" 2>&1
t_ok 'drop-ins exist for exactly the drawn bots' "$(dropins)" \
     "board-c-Comet board-c-Delta hive-a-Alpha hive-a-Bravo"
t_ok 'the roster is SAVED to disk' \
     "$(tr '\n' ' ' < "$MCAI_CANARY_TREE/canary-roster.txt" | sed 's/ $//')" \
     "board-c-Comet board-c-Delta hive-a-Alpha hive-a-Bravo"
t_true 'world-mates got NO drop-in' \
       "$([ ! -f "$MCAI_UNITDIR/mcbot@hive-a-Comet.service.d/10-canary.conf" ] && echo 1 || echo 0)"
t_true 'the canary tree has its own src, not the baseline one' \
       "$([ -f "$MCAI_CANARY_TREE/src/index.mjs" ] && [ ! -e "$MCAI_HARNESS/src" ] && echo 1 || echo 0)" \
       'baseline src must never be written by a canary build'
bash "$TREE" verify > "$ROOT/verify.log" 2>&1; VRC=$?
t_ok 'verify passes on a clean within-world canary' "$VRC" 0
t_true 'verify confirms effective == declared draw' \
       "$(grep -c 'effective canary == declared draw' "$ROOT/verify.log")" 1

echo
echo '2. RIGHT COUNT, WRONG IDENTITY -- the fault only a roster can see'
# Two bots treated in hive-a, but Comet instead of Bravo. Every count is unchanged.
rm -rf "$MCAI_UNITDIR/mcbot@hive-a-Bravo.service.d"
cp -r "$MCAI_UNITDIR/mcbot@hive-a-Alpha.service.d" "$MCAI_UNITDIR/mcbot@hive-a-Comet.service.d"
bash "$TREE" verify > "$ROOT/verify2.log" 2>&1; VRC=$?
t_ok 'verify FAILS: the effective canary is not the drawn one' "$VRC" 1
t_true 'and it names the declared draw and the effective set' \
       "$(grep -c 'the effective canary is not the declared draw' "$ROOT/verify2.log")" 1
t_ok 'the treated COUNT is unchanged, which is why a count cannot catch this' \
     "$(dropins | wc -w | tr -d ' ')" 4

echo
echo '3. TEARDOWN: three steps, each verified, restarting the SAVED roster'
mkfixture
DRAWN="hive-a-Alpha hive-a-Bravo board-c-Comet board-c-Delta"
manifest "" 2705838 $DRAWN
bash "$TREE" build "$ROOT/repo" 2705838 rl-14 $DRAWN > "$ROOT/build.log" 2>&1
t_true 'before teardown the manifest declares a within-world canary' \
       "$(declared | grep -c 'within-world canary')" 1
: > "$SCLOG"
bash "$TREE" teardown > "$ROOT/td.log" 2>&1; TRC=$?
t_ok 'teardown exits 0' "$TRC" 0
t_ok 'STEP 1: no drop-in remains' "$(dropins)" ""
t_true 'step 1 reported ok' "$(grep -c 'step 1/3 ok' "$ROOT/td.log")" 1
t_ok 'STEP 2: the manifest declares no canary' "$(declared)" 'no canary declared'
t_true 'step 2 reported ok' "$(grep -c 'step 2/3 ok' "$ROOT/td.log")" 1
t_ok 'STEP 3: restarted EXACTLY the drawn bots' "$(restarted)" \
     "board-c-Comet board-c-Delta hive-a-Alpha hive-a-Bravo"
t_true 'step 3 reported ok' "$(grep -c 'step 3/3 ok' "$ROOT/td.log")" 1
t_ok 'no world-mate was restarted' "$(grep -c 'hive-a-Echo' <<<"$(restarted)" || true)" 0

echo
echo '4. THE OLD RECONSTRUCTION WOULD HAVE RESTARTED NOBODY'
# canary-loop.sh built `mcbot@$pool-$b` from the manifest's canary_pool for b in Alpha..Echo. A
# within-world manifest holds the sentinel `split:rl-14`, so that expansion is
# `mcbot@split:rl-14-Alpha` -- no unit, no restart, and a silent half-teardown. Demonstrated rather
# than asserted, because this is the failure the saved roster exists to prevent.
mkfixture
manifest "" 2705838 hive-a-Alpha hive-a-Bravo
SENT=$(python3 -c "import json,os;print(json.load(open(os.environ['TRIAL_MANIFEST']))['canary_pool'])")
t_ok 'the manifest canary_pool is a sentinel, not a pool list' "$SENT" 'split:rl-14'
OLDWAY=""
for pool in ${SENT//,/ }; do for b in Alpha Bravo Comet Delta Echo; do
  [ -d "$MCAI_UNITDIR/mcbot@$pool-$b.service.d" ] && OLDWAY="$OLDWAY $pool-$b"
done; done
t_ok 'reconstructing Alpha..Echo from canary_pool finds NO unit to restart' "$OLDWAY" ""
t_true 'while the saved roster names both treated bots' \
       "$(bash "$TREE" build "$ROOT/repo" 2705838 rl-14 hive-a-Alpha hive-a-Bravo >/dev/null 2>&1; \
          bash "$TREE" roster 2>/dev/null | wc -l | tr -d ' ' | grep -c '^2$')" 1

echo
echo '5. LEGACY whole-pool canary: unchanged behaviour'
mkfixture
POOLBOTS="hive-a-Alpha hive-a-Bravo hive-a-Comet hive-a-Delta hive-a-Echo"
manifest "hive-a" 2705838
bash "$TREE" build "$ROOT/repo" 2705838 rl-13 $POOLBOTS > "$ROOT/build.log" 2>&1
t_ok 'all five of the pool are treated' "$(dropins)" \
     "hive-a-Alpha hive-a-Bravo hive-a-Comet hive-a-Delta hive-a-Echo"
t_true 'the legacy manifest keeps canary_pool as the pool name' \
       "$(python3 -c "import json,os;print(json.load(open(os.environ['TRIAL_MANIFEST']))['canary_pool'])" | grep -c '^hive-a$')" 1
: > "$SCLOG"
bash "$TREE" teardown > "$ROOT/td5.log" 2>&1
t_ok 'teardown restarts exactly the five, from the saved roster' "$(restarted)" \
     "hive-a-Alpha hive-a-Bravo hive-a-Comet hive-a-Delta hive-a-Echo"
t_ok 'and the legacy manifest is cleared too' "$(declared)" 'no canary declared'

echo
echo '6. A DROP-IN WITH NO SAVED ROSTER is still torn down (union, not file-only)'
# The saved roster is new, so a canary built by the PREVIOUS version of this script has drop-ins and
# no roster file. Teardown must still restart those bots; trusting the file alone would strand them.
mkfixture
manifest "hive-a" 2705838
bash "$TREE" build "$ROOT/repo" 2705838 rl-13 hive-a-Alpha hive-a-Bravo >/dev/null 2>&1
rm -f "$MCAI_CANARY_TREE/canary-roster.txt"
: > "$SCLOG"
bash "$TREE" teardown > "$ROOT/td6.log" 2>&1
t_ok 'restarted from the drop-ins on disk' "$(restarted)" "hive-a-Alpha hive-a-Bravo"

echo
echo '7. --no-restart says the teardown is INCOMPLETE rather than reporting success'
mkfixture
manifest "" 2705838 hive-a-Alpha hive-a-Bravo
bash "$TREE" build "$ROOT/repo" 2705838 rl-14 hive-a-Alpha hive-a-Bravo >/dev/null 2>&1
: > "$SCLOG"
bash "$TREE" teardown --no-restart > "$ROOT/td7.log" 2>&1
t_ok 'nothing was restarted' "$(restarted)" ""
t_true 'and it says so in those words' \
       "$(grep -c 'teardown is NOT complete' "$ROOT/td7.log")" 1
t_true 'while still naming the bots left on canary code' \
       "$(grep -c 'running canary code from memory' "$ROOT/td7.log")" 1

echo
echo "$PASS/$((PASS+FAIL)) canary-tree cases pass"
[ "$FAIL" -eq 0 ]
