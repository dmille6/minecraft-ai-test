#!/usr/bin/env bash
# test_install_valuescore.sh -- exercises install-valuescore.sh's --apply, re-apply, a failing --apply, and --rollback
# against a THROWAWAY HOME with a fake `crontab` on PATH. The real ~/mcai-analysis and the real crontab are never
# touched. Run on 10.0.0.31 as mike, from a checkout laid out as scripts/host + scripts/lib:
#   bash scripts/host/test_install_valuescore.sh
set -uo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_HOME="$HOME"
T="$(mktemp -d /tmp/vsinst.XXXXXX)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home/mcai-analysis" "$T/home/estel/scripts/lib" "$T/home/digest" "$T/bin"
cp -p "$REAL_HOME/mcai-analysis/scoreboard.py" "$T/home/mcai-analysis/scoreboard.py"
cp -p "$REAL_HOME/estel/scripts/lib/"*.py "$T/home/estel/scripts/lib/"
mkdir -p "$T/home/.config"; ln -s "$REAL_HOME/.config/mcai" "$T/home/.config/mcai"   # the ES read-only key, read in place
cat > "$T/bin/crontab" <<'EOF'
#!/usr/bin/env bash
F="$HOME/crontab.txt"
case "${1:-}" in
  -l) [ -e "$F" ] && cat "$F" || { echo "no crontab for mike" >&2; exit 1; } ;;
  -r) rm -f "$F" ;;
  -)  cat > "$F" ;;
  *)  cp "$1" "$F" ;;
esac
EOF
chmod +x "$T/bin/crontab"
printf '%s\n' '3,33 * * * * /usr/bin/python3 other-job.py' '# valuescore-1023 look-alike comment (must survive rollback)' > "$T/home/crontab.txt"
run() { HOME="$T/home" PATH="$T/bin:$PATH" bash "$SRC/install-valuescore.sh" "$@"; }
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

before_sb="$(md5sum < "$T/home/mcai-analysis/scoreboard.py")"
run > "$T/dry.out" 2>&1
check 'dry run exits 0' '[ $? -eq 0 ] || grep -q "DRY RUN" "$T/dry.out"'
check 'dry run changes nothing' '[ "$(md5sum < "$T/home/mcai-analysis/scoreboard.py")" = "$before_sb" ] && [ ! -e "$T/home/mcai-analysis/valuescore.py" ]'

run --apply > "$T/apply.out" 2>&1; rc=$?
check '--apply exits 0' "[ $rc -eq 0 ]"
check '--apply installed valuescore.py' '[ -e "$T/home/mcai-analysis/valuescore.py" ]'
check '--apply added exactly one valuescore cron line' '[ "$(grep -c "valuescore.py --json" "$T/home/crontab.txt")" -eq 1 ]'
check '--apply kept the other cron lines' 'grep -q other-job.py "$T/home/crontab.txt" && grep -q look-alike "$T/home/crontab.txt"'
LINE="$(grep 'valuescore.py --json' "$T/home/crontab.txt")"     # the exact line the installer writes, kept for a later case
check '--apply wrote a state file' 'ls "$T/home/mcai-analysis"/.valuescore-install-*.state >/dev/null 2>&1'

# re-apply refuses (the installed scoreboard.py is no longer the expected old version) and changes nothing
cp "$T/home/crontab.txt" "$T/cron.before"
run --apply > "$T/reapply.out" 2>&1; rc=$?
check 're-apply refuses' "[ $rc -ne 0 ] && grep -q REFUSED '$T/reapply.out'"
check 're-apply leaves the crontab alone' 'cmp -s "$T/cron.before" "$T/home/crontab.txt"'

cp -p "$T/home/mcai-analysis/scoreboard.py" "$T/sb.installed"; echo '# someone else edited this' >> "$T/home/mcai-analysis/scoreboard.py"
run --rollback > "$T/rbedit.out" 2>&1; rc=$?
check 'rollback refuses after someone else edited scoreboard.py' "[ $rc -ne 0 ] && grep -q 'changed since this install' '$T/rbedit.out'"
cp -p "$T/sb.installed" "$T/home/mcai-analysis/scoreboard.py"
# Codex r3 P2-1: a crontab WRITE failure during rollback leaves the files installed, and a re-run then succeeds
cp "$T/bin/crontab" "$T/crontab.good"
cat > "$T/bin/crontab" <<'EOF3'
#!/usr/bin/env bash
F="$HOME/crontab.txt"
case "${1:-}" in -l) cat "$F" ;; *) echo "crontab: write failed" >&2; exit 1 ;; esac
EOF3
chmod +x "$T/bin/crontab"
run --rollback > "$T/rbfail.out" 2>&1; rc=$?
check 'rollback with a failing crontab write exits non-zero' "[ $rc -ne 0 ]"
check '... and leaves the installed files in place (retryable)' '[ -e "$T/home/mcai-analysis/valuescore.py" ] && cmp -s "$T/sb.installed" "$T/home/mcai-analysis/scoreboard.py"'
cp "$T/crontab.good" "$T/bin/crontab"
run --rollback > "$T/rb.out" 2>&1; rc=$?
check '--rollback exits 0' "[ $rc -eq 0 ]"
check '--rollback restored scoreboard.py' '[ "$(md5sum < "$T/home/mcai-analysis/scoreboard.py")" = "$before_sb" ]'
check '--rollback removed valuescore.py (it did not exist before)' '[ ! -e "$T/home/mcai-analysis/valuescore.py" ]'
check '--rollback removed only its own cron line' '! grep -q "valuescore.py --json" "$T/home/crontab.txt" && grep -q other-job.py "$T/home/crontab.txt" && grep -q look-alike "$T/home/crontab.txt"'

# a FAILING --apply, failing AFTER the files are installed (step 5's mkdir hits a regular file), must restore everything
rm -rf "$T/home/digest"; touch "$T/home/digest"
cp "$T/home/crontab.txt" "$T/cron.before"
HOME="$T/home" PATH="$T/bin:$PATH" bash "$SRC/install-valuescore.sh" --apply > "$T/failapply.out" 2>&1; rc=$?
check 'failing --apply exits non-zero' "[ $rc -ne 0 ]"
check 'failing --apply failed AFTER installing and ran the restore' 'grep -q "FAILED during --apply: restoring" "$T/failapply.out"'
check 'failing --apply restored scoreboard.py' '[ "$(md5sum < "$T/home/mcai-analysis/scoreboard.py")" = "$before_sb" ]'
check 'failing --apply left no valuescore.py' '[ ! -e "$T/home/mcai-analysis/valuescore.py" ]'
check 'failing --apply left the crontab as it was' 'cmp -s "$T/cron.before" "$T/home/crontab.txt"'
# Codex r2 P2-1: the EXACT line already present before an install must survive that install's rollback
rm -f "$T/home/digest"; mkdir -p "$T/home/digest"
printf '%s\n' "$LINE" >> "$T/home/crontab.txt"
cp "$T/home/crontab.txt" "$T/cron.before"
run --apply > "$T/apply2.out" 2>&1; rc=$?
check 'apply with the line pre-present exits 0 and does not duplicate it' "[ $rc -eq 0 ] && [ \"\$(grep -c 'valuescore.py --json' '$T/home/crontab.txt')\" -eq 1 ]"
run --rollback > "$T/rb2.out" 2>&1
check 'rollback keeps a line it did not add' 'cmp -s "$T/cron.before" "$T/home/crontab.txt"'
# Codex r2 P2-2: a crontab -l failure that is NOT "no crontab" must refuse before any change
cat > "$T/bin/crontab" <<'EOF2'
#!/usr/bin/env bash
case "${1:-}" in -l) echo "crontab: permission denied" >&2; exit 1 ;; *) echo "WRITE ATTEMPTED" >> "$HOME/cron-writes"; exit 0 ;; esac
EOF2
chmod +x "$T/bin/crontab"
run --apply > "$T/apply3.out" 2>&1; rc=$?
check 'a crontab -l error refuses' "[ $rc -ne 0 ] && grep -q 'crontab -l failed' '$T/apply3.out'"
check 'a crontab -l error changes nothing' '[ "$(md5sum < "$T/home/mcai-analysis/scoreboard.py")" = "$before_sb" ] && [ ! -e "$T/home/mcai-analysis/valuescore.py" ] && [ ! -e "$T/home/cron-writes" ]'
check 'no temporary directory left under HOME' '! ls -d "$T/home"/.valuescore-tmp.* >/dev/null 2>&1'
[ $fail -eq 0 ] && echo "ALL INSTALLER CHECKS PASS" || { echo "INSTALLER CHECKS FAILED"; for f in "$T"/*.out; do echo "--- $f"; tail -5 "$f"; done; }
exit $fail
