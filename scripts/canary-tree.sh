#!/bin/bash
# CANARY CODE LIVES IN ITS OWN TREE, so a control cannot load it by accident.
#
# THE BUG THIS FIXES. deploy-fleet.sh copies the new source over
# /srv/mcbots/harness/src for EVERY bot and relies on the 75 controls not being
# restarted. Any control that restarts for its own reasons -- a crash, the
# watchdog, systemd Restart=always -- comes back running CANARY code while still
# labelled baseline. Measured over 9 hours with a canary live: two controls
# drifted (board-b-Alpha, isolated-c-Bravo), both reporting the baseline sha
# with the canary digest. Stopping them does not hold; systemd brings them back
# and they are contaminated again. Roughly one control every four hours.
#
# THE INVARIANT: a baseline unit must start from the baseline tree no matter
# when it restarts -- during a canary deploy, a rollback, a recycle, a watchdog
# kick or a reboot. That is only true if canary code is never written where a
# baseline unit would look.
#
# WHY A DROP-IN AND NOT A SECOND UNIT TEMPLATE. One template, five per-instance
# drop-ins. A second template (mcbot-canary@) doubles the enablement, restart
# and teardown paths every piece of fleet automation has to remember.
#
# DO NOT EDIT THE COPY THAT IS RUNNING. `teardown` now restarts bots with a 12s
# stagger, so it is live for well over a minute, and bash re-reads a script by
# byte offset. Edit the repo copy and reinstall; never edit /usr/local/sbin
# while a teardown is in flight.
set -euo pipefail

# EVERY PATH IS OVERRIDABLE SO THIS FILE CAN BE TESTED WITHOUT A FLEET.
# The defaults are exactly the production paths, so nothing changes in use. The old version could
# only be exercised by deploying, which is why its teardown shipped incomplete for weeks: the
# three-step rule lived in CLAUDE.md as a thing to remember instead of in the script as a thing
# that runs. scripts/test_canary_tree.sh drives all of this against a fixture directory with a
# stub systemctl.
H=${MCAI_HARNESS:-/srv/mcbots/harness}
C=${MCAI_CANARY_TREE:-/srv/mcbots/harness-canary}
UNITDIR=${MCAI_UNITDIR:-/etc/systemd/system}
MAN=${TRIAL_MANIFEST:-/srv/mcbots/trial-manifest.json}
LIB=${MCAI_LIB:-/opt/minecraft-ai/scripts/lib}
SYSTEMCTL=${SYSTEMCTL:-systemctl}
STAGGER=${MCAI_STAGGER:-12}
DROPIN=10-canary.conf
#: The saved roster. Written by `build`, read by `teardown`. See teardown() for why it is not the
#: only source and must not be.
ROSTERF=$C/canary-roster.txt

usage() { echo "usage: canary-tree.sh build <repo> <sha> <run_id> <bot>...
       canary-tree.sh teardown [--no-restart]
       canary-tree.sh verify
       canary-tree.sh roster            # who this canary treats, from disk" >&2; exit 2; }

say() { printf '   %s\n' "$*"; }
# DIAGNOSTICS GO TO STDERR, because `roster()`'s STDOUT IS DATA. Written to stdout, the warning
# "drop-in present but NOT declared: hive-a-Alpha hive-a-Bravo" was captured by
# `bots=$(roster)` in teardown and fed to `systemctl restart` as if those words were bot names --
# so the one case where a canary most needs tearing down (drop-ins on disk, the saved roster gone)
# was the case where teardown restarted nothing real. Caught by case 6 of test_canary_tree.sh.
bad() { printf '   ! %s\n' "$*" >&2; }

# ENUMERATION IS A GLOB LOOP, NEVER `ls | wc -l`. This file runs under `set -euo pipefail`, and
# `ls <unmatched-glob>` exits 2 -- so with pipefail the whole assignment fails and `set -e` kills
# the function on the spot. That is not theoretical: written as `left=$(ls .../$DROPIN | wc -l)`,
# teardown removed the drop-ins and then died silently at its own step-1 verification, before
# clearing the manifest and before restarting anything. A teardown that exits mid-way having done
# step 1 only is precisely the half-teardown this rewrite exists to eliminate, and the check meant
# to prevent it was the thing causing it.
dropin_bots() {
  local d b
  for d in "$UNITDIR"/mcbot@*.service.d; do
    if [ -f "$d/$DROPIN" ]; then b=$(basename "$d" .service.d); echo "${b#mcbot@}"; fi
  done | sort -u
}
dropin_count() { dropin_bots | grep -c . || true; }

build() {
  local repo="$1" sha="$2" run="$3"; shift 3
  [ $# -gt 0 ] || usage
  # 1. STAGE THE TREE FIRST. Baseline src is never touched, so a control that
  #    restarts at ANY point in this function lands on baseline.
  mkdir -p "$C"
  rm -rf "$C/src"
  cp -r "$repo/bots/src" "$C/src"
  cp "$repo/bots/package.json" "$C/package.json"
  # node resolves node_modules upward from the entry file; the symlink keeps one
  # install rather than a second 179-package tree that can drift.
  ln -sfn "$H/node_modules" "$C/node_modules"
  # The per-bot env files carry MEMORY_SCOPE, pool and role -- the experiment's
  # independent variable. They are SHARED, deliberately: the canary changes code,
  # not condition.
  ln -sfn "$H/env" "$C/env"
  printf 'CODE_VERSION=%s\nRUN_ID=%s\n' "$sha" "$run" > "$C/canary.env"

  # 2. RECORD WHO IS TREATED, BEFORE POINTING ANYONE AT IT.
  #
  # Teardown has to restart exactly these bots, and until now nothing wrote them down. canary-loop.sh
  # reconstructed them instead, as `for b in Alpha Bravo Comet Delta Echo` across the pool names in
  # the manifest -- which is wrong in three separate ways: it assumes five bots per pool, it assumes
  # those five names, and for a within-world canary the manifest holds a sentinel rather than pool
  # names, so it expands to nothing and restarts NOBODY. That is precisely the silent half-teardown
  # CLAUDE.md records from 2026-09-04, where all five bots were still on the canary build after a
  # "complete" teardown and only the next deploy's verifier noticed.
  printf '%s\n' "$@" | sort -u > "$ROSTERF"
  chown -R mcbot:mcbot "$C" 2>/dev/null || true

  # 3. Point ONLY the named units at it.
  local n=0
  for bot in "$@"; do
    local d="$UNITDIR/mcbot@$bot.service.d"
    mkdir -p "$d"
    # EnvironmentFile is APPENDED, not cleared: the unit's own env file must
    # still load (it holds the bot's arm and pool), and a later file overrides
    # only the keys it sets. A drop-in `Environment=CODE_VERSION=` would NOT
    # win -- the unit's EnvironmentFile is applied after Environment= lines.
    cat > "$d/$DROPIN" <<EOF
[Service]
WorkingDirectory=$C
EnvironmentFile=$C/canary.env
ExecStart=
ExecStart=/usr/bin/node --max-old-space-size=768 --heapsnapshot-near-heap-limit=1 $C/src/index.mjs
EOF
    [ -f "$d/$DROPIN" ] || { bad "failed to write the drop-in for $bot"; return 1; }
    n=$((n+1))
  done
  $SYSTEMCTL daemon-reload
  # EVERY DROP-IN, NOT "the loop ran". One drop-in of two failing silently is the exact fault the
  # roster exists to make visible, and a loop that does not count cannot report it.
  local want=$#
  [ "$n" -eq "$want" ] || { bad "wrote $n drop-in(s) of $want requested"; return 1; }
  say "canary tree at $C; $n unit(s) redirected; roster saved to $ROSTERF"
}

# Who this canary treats, ACCORDING TO DISK.
#
# Two sources, deliberately, and they are not redundant:
#   * the saved roster, which is what was DECLARED;
#   * the drop-ins actually present, which is what is IN EFFECT.
# Teardown must act on the union -- restarting a bot that was declared but whose drop-in is missing
# is harmless, whereas skipping a bot whose drop-in exists leaves it running canary code from
# memory. Disagreement between the two is itself a finding and is printed, because it means either a
# drop-in failed to apply or something outside this script created one.
roster() {
  local from_dropins from_file
  from_dropins=$(dropin_bots)
  from_file=$(sort -u "$ROSTERF" 2>/dev/null || true)
  local only_file only_drop
  only_file=$(comm -23 <(printf '%s\n' "$from_file" | grep -v '^$' || true) \
                       <(printf '%s\n' "$from_dropins" | grep -v '^$' || true) || true)
  only_drop=$(comm -13 <(printf '%s\n' "$from_file" | grep -v '^$' || true) \
                       <(printf '%s\n' "$from_dropins" | grep -v '^$' || true) || true)
  [ -z "$only_file" ] || bad "declared but NO drop-in (unverified treatment): $(echo $only_file)"
  [ -z "$only_drop" ] || bad "drop-in present but NOT declared: $(echo $only_drop)"
  printf '%s\n%s\n' "$from_file" "$from_dropins" | grep -v '^$' | sort -u
}

# TEARDOWN IS THREE STEPS AND EACH ONE IS VERIFIED.
#
# CLAUDE.md: "Teardown is THREE steps -- drop-ins, clearing canary_pool, AND restarting the pool's
# bots. The first two are config; neither restarts anything, so the bots keep running the canary
# code from memory and the fleet sits on three versions, which halts the tripper. Measured
# 2026-09-04: after a 'complete' two-step teardown of placebo-b, all five bots were still reporting
# the canary build, and only the next deploy's verifier caught it."
#
# This function did step 1 and printed "now clear canary_pool in the trial manifest" -- an
# instruction to a human, which is the form of remedy this project has measured being ignored 262
# times. Steps 2 and 3 lived in canary-loop.sh, so a teardown by hand got one of three steps and a
# reminder. All three are here now, each followed by a check that it actually happened.
teardown() {
  local restart=1
  [ "${1:-}" = "--no-restart" ] && restart=0
  local bots; bots=$(roster)
  if [ -z "$bots" ]; then
    say "no canary drop-ins and no saved roster: nothing to tear down"
  fi
  say "teardown roster: $(echo $bots | tr '\n' ' ')"

  # ---- STEP 1: the drop-ins ----------------------------------------------------------
  local n=0
  for d in "$UNITDIR"/mcbot@*.service.d; do
    [ -f "$d/$DROPIN" ] || continue
    rm -f "$d/$DROPIN"; rmdir "$d" 2>/dev/null || true; n=$((n+1))
  done
  $SYSTEMCTL daemon-reload
  local left; left=$(dropin_count)
  [ "$left" -eq 0 ] || { bad "STEP 1 FAILED: $left drop-in(s) still present"; return 1; }
  say "step 1/3 ok: removed $n drop-in(s), none remain"

  # ---- STEP 2: the declaration -------------------------------------------------------
  # Cleared through canary_manifest.cleared() rather than by setting two keys to null, because a
  # within-world declaration has FOUR canary fields and leaving canary_split or canary_roster behind
  # makes the manifest either unreadable or still naming the treated bots.
  if [ -f "$MAN" ]; then
    MAN="$MAN" LIB="$LIB" python3 - <<'PY'
import json, os, sys
sys.path.insert(0, os.environ['LIB'])
import canary_manifest as cm
p = os.environ['MAN']
with open(p) as fh:
    man = json.load(fh)
out = cm.cleared(man)
# WRITE VIA A TEMP AND RENAME. A crash midway through a truncating write leaves a manifest that no
# reader can parse, and the tripper's response to an unreadable manifest is to go blind -- during a
# teardown, which is the worst moment for it.
tmp = p + '.new'
with open(tmp, 'w') as fh:
    json.dump(out, fh, indent=2)
os.replace(tmp, p)
PY
    local still; still=$(MAN="$MAN" LIB="$LIB" python3 -c '
import json, os, sys
sys.path.insert(0, os.environ["LIB"])
import canary_manifest as cm
print("yes" if cm.load(json.load(open(os.environ["MAN"]))).has_canary else "no")')
    [ "$still" = "no" ] || { bad "STEP 2 FAILED: the manifest still declares a canary"; return 1; }
    say "step 2/3 ok: the manifest declares no canary"
  else
    bad "step 2/3 SKIPPED: no manifest at $MAN -- the declaration may still name this canary"
  fi

  # ---- STEP 3: the restarts ----------------------------------------------------------
  # THE STEP THAT GETS SKIPPED, AND THE ONLY ONE THAT CHANGES WHAT IS RUNNING. Steps 1 and 2 are
  # config; a bot that is not restarted keeps executing the canary code it already loaded.
  if [ "$restart" = 0 ]; then
    bad "step 3/3 SKIPPED by --no-restart: $(echo $bots | wc -w | tr -d ' ') bot(s) are still"
    bad "running canary code from memory. The teardown is NOT complete."
    return 0
  fi
  local r=0 failed=""
  for b in $bots; do
    if $SYSTEMCTL restart "mcbot@$b.service"; then r=$((r+1)); else failed="$failed $b"; fi
    # Paper throttles new connections; a tighter stagger gets bots rejected.
    sleep "$STAGGER"
  done
  [ -z "$failed" ] || { bad "STEP 3 FAILED to restart:$failed"; return 1; }
  say "step 3/3 ok: restarted $r bot(s) with a ${STAGGER}s stagger"
  # THE MARK MUST BE TAKEN AFTER THE LAST RESTART, and only this function knows when that was.
  # Restarts are staggered, so a mark taken before them lets a bot that has not restarted yet be
  # read on its PRE-teardown line -- which is still the canary build. deploy-fleet.sh learned this
  # the other way round and reported a converged fleet as split; here it would report the opposite,
  # a completed teardown as still-on-canary. Printed unprefixed so a caller can sed it out.
  printf 'RESTART_MARK %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  say "now confirm the fleet is on ONE build: deploy-verify.py --teardown --since <the mark above>"
  say "NOT two. CLAUDE.md says 'confirm exactly two versions are live', which is the count while a"
  say "canary IS declared; step 2 just cleared it, so one declared build means one version live."
}

verify() {
  local bad_=0
  local n; n=$(dropin_count)
  echo "canary drop-ins present: $n"
  for d in "$UNITDIR"/mcbot@*.service.d; do
    [ -f "$d/$DROPIN" ] || continue
    local bot; bot=$(basename "$d" .service.d); bot=${bot#mcbot@}
    local wd; wd=$($SYSTEMCTL show -p WorkingDirectory --value "mcbot@$bot" 2>/dev/null)
    case "$wd" in *harness-canary*) echo "  ok   $bot -> $wd" ;;
                  *) echo "  FAIL $bot -> $wd"; bad_=1 ;; esac
  done
  # The invariant, checked directly: every unit WITHOUT a drop-in must resolve to
  # the baseline tree.
  for u in $($SYSTEMCTL list-units 'mcbot@*' --state=active --no-legend | awk '{print $1}'); do
    local bot=${u#mcbot@}; bot=${bot%.service}
    [ -f "$UNITDIR/mcbot@$bot.service.d/$DROPIN" ] && continue
    local wd; wd=$($SYSTEMCTL show -p WorkingDirectory --value "$u" 2>/dev/null)
    case "$wd" in *harness-canary*) echo "  FAIL $bot is a CONTROL pointing at the canary tree"; bad_=1 ;; esac
  done
  # THE DECLARED ROSTER IS PART OF THE INVARIANT. A drop-in that points at the canary tree is not
  # enough: it must be one of the bots that was DRAWN. This is the check that catches "right count,
  # wrong identity" -- two treated bots in a world, but not the two that were randomized -- which no
  # count and no prefix rule can see.
  if [ -f "$ROSTERF" ]; then
    local declared effective
    declared=$(sort -u "$ROSTERF")
    effective=$(dropin_bots)
    if [ "$declared" != "$effective" ]; then
      echo "  FAIL the effective canary is not the declared draw"
      echo "       declared:  $(echo $declared)"
      echo "       effective: $(echo $effective)"
      bad_=1
    else
      echo "  ok   effective canary == declared draw ($(echo $declared | wc -w | tr -d ' ') bot(s))"
    fi
  fi
  [ "$bad_" = 0 ] && echo "invariant holds: controls point at baseline" || echo "INVARIANT BROKEN"
  return $bad_
}

case "${1:-}" in
  build) shift; build "$@" ;;
  teardown) shift; teardown "$@" ;;
  verify) verify ;;
  roster) roster ;;
  *) usage ;;
esac
