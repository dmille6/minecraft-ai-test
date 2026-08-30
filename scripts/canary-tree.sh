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
set -euo pipefail
H=/srv/mcbots/harness
C=/srv/mcbots/harness-canary
DROPIN=10-canary.conf

usage() { echo "usage: canary-tree.sh build <repo> <sha> <run_id> <bot>...
       canary-tree.sh teardown
       canary-tree.sh verify" >&2; exit 2; }

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
  chown -R mcbot:mcbot "$C" 2>/dev/null || true

  # 2. Point ONLY the named units at it.
  for bot in "$@"; do
    local d=/etc/systemd/system/mcbot@"$bot".service.d
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
  done
  systemctl daemon-reload
  echo "canary tree at $C; $# unit(s) redirected"
}

teardown() {
  # TWO STEPS, AND HALF A TEARDOWN IS SILENTLY WRONG. Removing only the drop-ins
  # leaves canary_pool set and every fleet recycle blocked forever; clearing only
  # the manifest lets the next recycle restart canary bots onto baseline and
  # dissolve the canary without saying so.
  local n=0
  for d in /etc/systemd/system/mcbot@*.service.d; do
    [ -f "$d/$DROPIN" ] || continue
    rm -f "$d/$DROPIN"; rmdir "$d" 2>/dev/null || true; n=$((n+1))
  done
  systemctl daemon-reload
  echo "removed $n canary drop-in(s) -- now clear canary_pool in the trial manifest"
}

verify() {
  local bad=0
  local n; n=$(ls -d /etc/systemd/system/mcbot@*.service.d 2>/dev/null | wc -l | tr -d ' ')
  echo "canary drop-ins present: $n"
  for d in /etc/systemd/system/mcbot@*.service.d; do
    [ -f "$d/$DROPIN" ] || continue
    local bot; bot=$(basename "$d" .service.d); bot=${bot#mcbot@}
    local wd; wd=$(systemctl show -p WorkingDirectory --value "mcbot@$bot" 2>/dev/null)
    case "$wd" in *harness-canary*) echo "  ok   $bot -> $wd" ;;
                  *) echo "  FAIL $bot -> $wd"; bad=1 ;; esac
  done
  # The invariant, checked directly: every unit WITHOUT a drop-in must resolve to
  # the baseline tree.
  for u in $(systemctl list-units 'mcbot@*' --state=active --no-legend | awk '{print $1}'); do
    local bot=${u#mcbot@}; bot=${bot%.service}
    [ -f /etc/systemd/system/mcbot@"$bot".service.d/$DROPIN ] && continue
    local wd; wd=$(systemctl show -p WorkingDirectory --value "$u" 2>/dev/null)
    case "$wd" in *harness-canary*) echo "  FAIL $bot is a CONTROL pointing at the canary tree"; bad=1 ;; esac
  done
  [ "$bad" = 0 ] && echo "invariant holds: controls point at baseline" || echo "INVARIANT BROKEN"
  return $bad
}

case "${1:-}" in
  build) shift; build "$@" ;;
  teardown) teardown ;;
  verify) verify ;;
  *) usage ;;
esac
