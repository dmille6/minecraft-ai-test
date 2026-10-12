#!/bin/bash
# bash infra/brain/test_brain_subset.sh -- mcai-brain-subset on a temp harness (MCAI_SUBSET_TEST: no restarts; the env
# file stands in for the process environment). Every case must print PASS; exits 1 on any FAIL.
X=$(dirname "$0")/mcai-brain-subset; T=$(mktemp -d); mkdir -p $T/env; F=0
for b in hive-a-Alpha hive-a-Bravo board-b-Alpha; do printf 'BOT_NAME=%s\nCODE_VERSION=0cdb1a8\n' $b > $T/env/$b.env; done
export MCAI_HARNESS=$T MCAI_SUBSET_REC=$T/rec.json MCAI_SUBSET_TEST=1
ok() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; F=1; fi; }
E="OLLAMA_BRAIN_PRIMARY=http://127.0.0.1:11601|gemma4:26b|gemma4|15000 OLLAMA_THINK=false"
$X apply --run brain-01 --pools hive-a --env "$E" >/dev/null
ok "apply: exact values in every subset bot" "grep -qx 'OLLAMA_THINK=false' $T/env/hive-a-Alpha.env && grep -qx 'OLLAMA_THINK=false' $T/env/hive-a-Bravo.env"
ok "apply: other pools untouched" "! grep -q brain $T/env/board-b-Alpha.env"
ok "apply: record live" "grep -q '\"state\": \"live\"' $T/rec.json"
$X apply --run brain-01 --pools hive-a --env "$E" >/dev/null
ok "re-apply (resume) is idempotent: one block" "[ \$(grep -c '>>> brain-subset' $T/env/hive-a-Alpha.env) = 1 ]"
$X apply --run other --pools hive-a --env "$E" >/dev/null 2>&1; ok "a different subset is refused" "[ $? = 2 ]"
$X apply --run brain-01 --pools hive-a --env "CODE_VERSION=x" >/dev/null 2>&1; ok "CODE_VERSION refused" "[ $? = 2 ]"
rm -f $T/rec.json; for b in hive-a-Alpha hive-a-Bravo; do printf 'BOT_NAME=%s\nCODE_VERSION=0cdb1a8\n' $b > $T/env/$b.env; done
# exact-value check: make the stand-in "process env" disagree by appending a wrong value AFTER the block is written
MCAI_SUBSET_TEST=1 python3 - "$X" "$T" <<'PY'
import os, subprocess, sys
x, t = sys.argv[1:]
# monkeypatch: run apply, but sabotage the file between write and verify by a wrapper module
src = open(x).read().replace("    restart(bots)\n    want =", "    restart(bots)\n    open(os.path.join(H, 'env', bots[0] + '.env'), 'a').write('OLLAMA_THINK=true\\n')\n    want =", 1)
open(t + '/sab.py', 'w').write(src)
r = subprocess.run(['python3', t + '/sab.py', 'apply', '--run', 'brain-01', '--pools', 'hive-a', '--env', 'OLLAMA_THINK=false'], capture_output=True, text=True)
print('SABOTAGE rc', r.returncode, r.stderr.strip()[:120])
PY
ok "a wrong live value fails verification (rc 4) and the record stays 'applying' (still excluded)" "grep -q '\"state\": \"applying\"' $T/rec.json"
rm -f $T/rec.json; printf 'BOT_NAME=hive-a-Alpha\nCODE_VERSION=0cdb1a8\n' > $T/env/hive-a-Alpha.env
$X apply --run brain-01 --pools hive-a --env "$E" >/dev/null
$X remove --pools hive-a >/dev/null
ok "remove: blocks gone" "! grep -q brain $T/env/hive-a-Alpha.env && ! grep -q brain $T/env/hive-a-Bravo.env"
ok "remove: record dropped only after verification" "[ ! -e $T/rec.json ]"
exit $F
