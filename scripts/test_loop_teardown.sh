#!/usr/bin/env bash
# Does the canary loop's teardown actually restart EVERY assigned bot?
#
# THE DEFECT. The teardown restarted a unit only if `systemctl list-units ... | grep -q running`
# said it was already running. A bot that was stopped or failed at that moment was SKIPPED -- and
# came back later still running CANARY code. That is a teardown that looks complete and is not,
# which CLAUDE.md records costing five bots on canary code after a "complete" two-step teardown.
# It also enumerated bot names from a hardcoded Alpha/Bravo/Comet/Delta/Echo list, which is wrong
# the moment a roster is partial.
#
# This exercises the real function out of the real file, with systemctl and sudo stubbed, against a
# fixture where ONE bot is deliberately not running. It must be restarted anyway.
set -u
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ck() { if [ "$2" = "$3" ]; then echo "  [PASS] $1"; pass=$((pass+1)); else echo "  [FAIL] $1: got '$2' want '$3'"; fail=$((fail+1)); fi; }

# fixture: two assigned pools, five bots each; hive-a-Comet is NOT running
mkdir -p "$T/log"
for p in hive-a board-c; do for b in Alpha Bravo Comet Delta Echo; do mkdir -p "$T/log/$p-$b"; done; done

mkdir -p "$T/bin"
cat > "$T/bin/systemctl" <<'SH'
#!/usr/bin/env bash
if [ "$1" = "list-units" ]; then
  # everything is running EXCEPT hive-a-Comet -- the case the old code skipped
  case "$2" in *hive-a-Comet*) exit 0;; *) echo "$2 loaded active running";; esac
  exit 0
fi
if [ "$1" = "restart" ]; then echo "$2" >> "$RESTARTED"; fi
SH
cat > "$T/bin/sudo" <<'SH'
#!/usr/bin/env bash
exec "$@"
SH
chmod +x "$T/bin/systemctl" "$T/bin/sudo"
export PATH="$T/bin:$PATH"
export RESTARTED="$T/restarted.txt"; : > "$RESTARTED"

# extract the helper verbatim from the real script, so this cannot test a stale copy
sed -n '/^_restart_assigned() {/,/^}/p' scripts/canary-loop.sh > "$T/fn.sh"
ck "the helper definition was extracted" \
   "$(grep -c '^_restart_assigned() {' "$T/fn.sh" | tr -d ' ')" "1"
ck "and it has a body" "$([ "$(wc -l < "$T/fn.sh")" -gt 10 ] && echo yes || echo no)" "yes"

P="hive-a,board-c"
journal() { :; }
sleep() { :; }              # the real one staggers 12s per bot; 10 bots would be two minutes
# shellcheck disable=SC1090
. "$T/fn.sh"
# point the fixture at the function's hardcoded log root
sed -i.bak "s#/var/log/mcai#$T/log#g" "$T/fn.sh"; . "$T/fn.sh"
: > "$RESTARTED"
_restart_assigned

n=$(sort -u "$RESTARTED" | wc -l | tr -d ' ')
ck "every one of the 10 assigned bots was restarted" "$n" "10"
ck "including the one that was NOT running" \
   "$(grep -c 'hive-a-Comet' "$RESTARTED" | tr -d ' ')" "1"
ck "and nothing outside the assigned pools" \
   "$(grep -cvE 'hive-a|board-c' "$RESTARTED" | tr -d ' ')" "0"

# THE MUTANT: restore the `grep -q running &&` guard and the bot must be skipped again.
sed 's#systemctl list-units "mcbot@$b.service" --no-legend | grep -q running || skipped="$skipped $b"#systemctl list-units "mcbot@$b.service" --no-legend | grep -q running || continue#' "$T/fn.sh" > "$T/mut.sh"
ck "mutant anchor applied" "$(diff -q "$T/fn.sh" "$T/mut.sh" >/dev/null && echo same || echo differs)" "differs"
: > "$RESTARTED"
. "$T/mut.sh"; _restart_assigned
ck "the mutant SKIPS the not-running bot (so the test is load-bearing)" \
   "$(grep -c 'hive-a-Comet' "$RESTARTED" | tr -d ' ')" "0"

echo ""
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
