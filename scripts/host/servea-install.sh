#!/bin/bash
# servea-install.sh -- serving A (OWNER 11-02): install the oai+ probe fix (main aa5d5130) and the 5080 rollout home on
# the canary host, BETWEEN CANARIES (installer pattern: install-hold, then /tmp/mcai-canary.lock flock -n for the whole
# run). Run by the servea waiter; safe to run by hand. Idempotent (marker ~/servea/installed-aa5d5130).
#
#   servea-install.sh        exit 0 installed (or already), 75 busy (a canary/loop/installer holds the slot: retry later),
#                            1 failed (nothing left half-done: the canary read is restored from its backup)
#
# Sources: ~/servea/stage/ (main's modelread.py, modelrollout.py, qwen35load.mjs, holdtoken.py and their tests, synced
# by the waiter). What it changes:
#   ~/mcai-analysis/modelread.py      the canary loop's read: main's (oai+ -> /health probe; MIN_CONTROL env, default 40
#                                     = unchanged). Backup modelread.py.bak-servea-<ts>.
#   ~/servea-rollout/                 a NEW rollout home for the 4B (modelrollout.py + modelread.py + qwen35load.mjs +
#                                     holdtoken.py; state in ./state). ~/qwen35-rollout (the live Blackwell A/B) untouched.
#   /tmp/modelread.py                 the LIVE copy the scheduler checks (H4) and the canary loop runs (RD=/tmp): when it
#                                     is the old read it is moved aside (H4 then copies the new one in from reads_src);
#                                     any OTHER content there refuses (someone's unreviewed read: stale-tmp-read rule).
#   servea-01's queue variant         replace-variant with its reads md5 = the new modelread.py (the scheduler checks it).
#   ~/servea/servea-check.sh          the waiter's preflight load check (with the live-fleet guard).
# The scheduler hold is TOKEN-OWNED (holdtoken.py: refuses if any hold exists, releases only its own).
set -u
ST=$HOME/servea/stage; TS=$(date -u +%Y%m%dT%H%M%SZ); MARK=$HOME/servea/installed-aa5d5130
MR=$HOME/mcai-analysis/modelread.py
[ -f "$MARK" ] && { echo "ALREADY $(cat "$MARK")"; exit 0; }
for f in modelread.py modelrollout.py qwen35load.mjs holdtoken.py test_modelread.py test_modelrollout.py servea-check.sh; do
  [ -f "$ST/$f" ] || { echo "FAIL: stage file missing: $f"; exit 1; }
done
[ -d "$ST/fixtures" ] || { echo "FAIL: stage fixtures/ missing (test_modelrollout reads it)"; exit 1; }
TOKEN="servea-install-$$-$(date +%s%N)"
python3 "$ST/holdtoken.py" claim "$TOKEN" 30 > /tmp/servea-install-hold.log 2>&1; rc=$?
[ $rc -eq 0 ] || { echo "BUSY (holdtoken claim rc $rc: $(tail -1 /tmp/servea-install-hold.log))"; exit 75; }
release () { python3 "$ST/holdtoken.py" release "$TOKEN" > /dev/null 2>&1; }
exec 9> /tmp/mcai-canary.lock
if ! flock -n 9; then release; echo "BUSY (canary lock)"; exit 75; fi
fail () { echo "FAIL: $*"; release; exit 1; }

# 1 the staged files' own tests, on this host
( cd "$ST" && python3 test_modelread.py > /tmp/servea-install-t1.log 2>&1 && python3 test_modelrollout.py > /tmp/servea-install-t2.log 2>&1 ) \
  || fail "staged tests failed (/tmp/servea-install-t1.log, -t2.log)"

# 2 the canary read, with a backup
cp -p "$MR" "$MR.bak-servea-$TS" || fail "backup of $MR"
OLD=$(md5sum "$MR" | cut -d' ' -f1)
install -m 644 "$ST/modelread.py" "$MR.new-servea" && mv "$MR.new-servea" "$MR" || fail "install $MR"
NEW=$(md5sum "$MR" | cut -d' ' -f1)
TMPR=/tmp/modelread.py; TMPMOVED=""
restore () { cp -p "$MR.bak-servea-$TS" "$MR"; [ -n "$TMPMOVED" ] && mv "$TMPMOVED" "$TMPR"; }
if [ -e "$TMPR" ]; then
  T=$(md5sum "$TMPR" | cut -d' ' -f1)
  if [ "$T" = "$OLD" ]; then mv "$TMPR" "$TMPR.bak-servea-$TS" && TMPMOVED="$TMPR.bak-servea-$TS" || { restore; fail "moving the old $TMPR aside"; }
  elif [ "$T" != "$NEW" ]; then restore; fail "$TMPR is neither the old ($OLD) nor the new read ($NEW): someone's read is staged there; a human decides"; fi
fi

# 3 every OPEN entry that pins the old read moves to the new one, or the install refuses. /tmp/modelread.py can hold one
#   read: once the old copy is moved aside, an open entry still pinned to the old md5 fails H4 at launch (blocked head;
#   round-2 Claude). servea-01 must be held; the only OTHER entry allowed to be re-pinned is qwen35c2-01 (its endpoint is
#   plain Ollama, for which the new read behaves identically: same /api/version probe, MIN_CONTROL default 40), and only
#   while its registration has no oai+ entry. Any other open entry on the old md5 refuses (restore + fail).
python3 "$HOME/canary-sched.py" status > /tmp/servea-install-status.txt 2>&1
python3 - "$OLD" "$NEW" <<'EOF'
import json, re, sys
old, new = sys.argv[1:3]
REPIN_OK = ('servea-01', 'qwen35c2-01')
state = {m.group(1): m.group(2) for m in (re.match(r'^(\S+)\s+(\S+)\s+\S+\s+hold=', l) for l in open('/tmp/servea-install-status.txt')) if m}
q = json.load(open('/home/mike/canary-queue.json'))
todo, out = [], []
for e in q['entries']:
    if state.get(e['run'], 'unknown') in ('done', 'cancelled', 'abandoned'):
        continue
    pins = {(v.get('reads') or {}).get('modelread') for v in e['variants'].values()} - {None}
    if old not in pins:
        continue
    if e['run'] not in REPIN_OK:
        sys.exit('open entry %s pins the old modelread %s and is not on the re-pin list: a human decides' % (e['run'], old[:8]))
    if e['run'] == 'servea-01' and not e.get('hold'):
        sys.exit('servea-01 is not held any more: someone released it; refusing to change it under them')
    for v in e['variants'].values():
        if v.get('reads_src') != '/home/mike/mcai-analysis':
            sys.exit('%s reads from %s, not ~/mcai-analysis' % (e['run'], v.get('reads_src')))
        if e['run'] != 'servea-01':
            r = json.load(open(v['registration']))
            if any('oai+' in kv for kv in r.get('canary_env') or []):
                sys.exit('%s has an oai+ endpoint: its read would change; a human decides' % e['run'])
    todo.append(e['run'])
    for tag, md5 in (('new', new), ('old', old)):
        x = {k: e[k] for k in ('run', 'class', 'after', 'not_before', 'hold', 'note', 'variants') if k in e}
        x = json.loads(json.dumps(x))
        for v in x['variants'].values():
            if (v.get('reads') or {}).get('modelread') in (old, new):
                v['reads']['modelread'] = md5
            v.pop('registration_sha256', None)
        json.dump(x, open('/home/mike/servea/repin-%s-%s.json' % (e['run'], tag), 'w'), indent=1)
if 'servea-01' not in todo:
    sp = [x for x in q['entries'] if x['run'] == 'servea-01']
    if not sp:
        sys.exit('servea-01 is not queued')
    if any((v.get('reads') or {}).get('modelread') != new for v in sp[0]['variants'].values()):
        sys.exit('servea-01 pins neither the old nor the new read: %s' % [v.get('reads') for v in sp[0]['variants'].values()])
open('/home/mike/servea/repin-todo.txt', 'w').write(' '.join(todo))
print('re-pin: %s' % (' '.join(todo) or 'nothing (already on %s)' % new[:8]))
EOF
[ $? -eq 0 ] || { restore; fail "re-pin check: see the line above"; }
DONE_REPIN=""
unrepin () { for r in $DONE_REPIN; do python3 "$HOME/canary-sched.py" queue replace-variant "$r" "$HOME/servea/repin-$r-old.json" > /dev/null 2>&1; done; }
for r in $(cat "$HOME/servea/repin-todo.txt"); do
  if python3 "$HOME/canary-sched.py" queue replace-variant "$r" "$HOME/servea/repin-$r-new.json" > /tmp/servea-install-rv.log 2>&1; then
    DONE_REPIN="$DONE_REPIN $r"
  else
    restore; unrepin; fail "replace-variant $r: $(tail -2 /tmp/servea-install-rv.log)"
  fi
done
restore_all () { restore; unrepin; }

# 4 the 5080 rollout home (the live A/B's ~/qwen35-rollout is not touched)
mkdir -p "$HOME/servea-rollout/state" || { restore_all; fail "mkdir servea-rollout"; }
for f in modelrollout.py modelread.py qwen35load.mjs holdtoken.py test_modelrollout.py test_modelread.py; do
  install -m 644 "$ST/$f" "$HOME/servea-rollout/$f" || { restore_all; fail "install servea-rollout/$f"; }
done
rm -rf "$HOME/servea-rollout/fixtures" && cp -r "$ST/fixtures" "$HOME/servea-rollout/fixtures" || { restore_all; fail "fixtures"; }
install -m 755 "$ST/servea-check.sh" "$HOME/servea/servea-check.sh" || { restore_all; fail "servea-check.sh"; }

( cd "$HOME/servea-rollout" && python3 test_modelrollout.py > /tmp/servea-install-t3.log 2>&1 ) || { restore_all; fail "tests in ~/servea-rollout"; }

echo "aa5d5130 installed $TS: modelread $OLD -> $NEW; servea-rollout ready" > "$MARK"
printf '{"ts":"%s","run":"servea","phase":"ops-note","note":"servea-install: modelread.py %s -> %s (oai+ /health probe; backup %s; old /tmp copy moved: %s); ~/servea-rollout installed; re-pinned:%s"}\n' \
  "$(date -u +%FT%TZ)" "${OLD:0:8}" "${NEW:0:8}" "$MR.bak-servea-$TS" "${TMPMOVED:-none}" "${DONE_REPIN:- none}" >> "$HOME/canary-journal.jsonl"
release
echo "INSTALLED $(cat "$MARK")"
