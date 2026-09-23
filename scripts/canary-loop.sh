#!/bin/bash
# canary-loop.sh <run_id> [--no-act] -- the canary loop on the bots host (docs/reports/canary-loop-design.md v3).
# One run per canary, under an exclusive lock, journaled, idempotent; pages via ~/digest/page.jsonl (the operator's
# session tails it). The registration ~/mcai-analysis/registrations/<run_id>.json binds sha, reads, rules, promotion.
# --no-act: everything but deploy/promote/teardown (prints what it would do). Phases resume from the journal.
set -u; RUN=${1:?run_id}; NOACT=${2:-}; H=$HOME; REG=$H/mcai-analysis/registrations/$RUN.json; J=$H/canary-journal.jsonl; PAGE=$H/digest/page.jsonl; MAN=/srv/mcbots/trial-manifest.json
exec 9>/tmp/mcai-canary.lock; flock -n 9 || { echo "another loop holds the lock"; exit 3; }
jf() { python3 -c "import json,sys; print(json.load(open('$REG')).get('$1',''))"; }
mf() { python3 -c "import json; print(json.load(open('$MAN')).get('$1') or '')"; }
journal() { printf '{"ts":"%s","run":"%s","phase":"%s","note":%s}\n' "$(date -u +%FT%TZ)" "$RUN" "$1" "$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$2")" >> $J; }
page() { printf '{"ts":"%s","run":"%s","level":"%s","msg":%s}\n' "$(date -u +%FT%TZ)" "$RUN" "$1" "$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$2")" >> $PAGE; echo "PAGE[$1] $2"; }
lastphase() { grep "\"run\":\"$RUN\"" $J 2>/dev/null | tail -1 | python3 -c "import sys,json; l=sys.stdin.read().strip(); print(json.loads(l)['phase'] if l else 'none')"; }
SHA=$(jf sha); [ -n "$SHA" ] || { page error "registration $RUN has no sha"; exit 2; }
PH=$(lastphase); echo "loop $RUN sha $SHA resumes from phase: $PH"
# ---- v19 preflight, BEFORE the draw: a declared change/linkage row that the BASELINE already
# emits cannot show the change acted on the bot that died, yet it licenses a REVERT from a
# single death. Two canaries were lost to exactly that (-13 `death_site_recorded`, a row the
# death handler writes; -13b `flooded_pocket_rung`, which is fleet-wide on 1d6c97d and which a
# CONTROL death carried at 00:01:45 while -13b was being reverted for it). Refuse the
# registration here -- before the draw, before the deploy, before three hours of fleet time.
if [ "$(mf canary_code_version)" != "$SHA" ]; then
  if ! sudo python3 $H/mcai-analysis/changerowcheck.py "$RUN" --hours 6 --registrations $H/mcai-analysis/registrations > $H/digest/changerowcheck-$RUN.log 2>&1; then
    page error "change-row preflight REFUSED $RUN; not drawing or deploying. $(grep -A3 '^REFUSED' $H/digest/changerowcheck-$RUN.log | tail -3 | tr '\n' ' ')"
    journal preflight-refused "$(tail -5 $H/digest/changerowcheck-$RUN.log | tr '\n' ' ')"
    exit 2
  fi
  journal preflight-ok "$(grep 'positive control' $H/digest/changerowcheck-$RUN.log)"
fi
# ---- phase DRAW + DEPLOY (skipped when the manifest already names this sha)
if [ "$(mf canary_code_version)" != "$SHA" ]; then
  if [ -n "$(mf canary_pool)" ]; then page error "manifest names another canary ($(mf canary_pool) $(mf canary_code_version)); refusing to start"; exit 2; fi
  journal draw "waiting for two pools"
  while true; do D=$(bash $H/mcai-analysis/drawrec.sh "$RUN" 2>&1 | tail -4); P=$(echo "$D" | grep -o "DRAW (.*owner C): \[.*\]" | grep -o "'[a-z-]*'" | tr -d "'" | paste -sd, -); [ -n "$P" ] && break; sleep 1200; done
  journal drawn "$P :: $(echo "$D" | head -2 | tr '\n' ' ')"
  if [ "$NOACT" = "--no-act" ]; then echo "would deploy $SHA to $P"; exit 0; fi
  $H/bin/fleet-deploy "$SHA" "$RUN" "$(jf notes) pools $P drawn at deploy by the canary loop" --pool "$P" > $H/digest/deploy-$RUN.log 2>&1 || { page error "deploy launch failed"; exit 2; }
  grep -q "VERIFIED" $H/digest/deploy-$RUN.log || { page error "deploy not verified: $(tail -2 $H/digest/deploy-$RUN.log | tr '\n' ' ')"; exit 2; }
  journal deployed "$P $(mf declared_at)"; page info "canary $RUN $SHA deployed to $P at $(mf declared_at)"
fi
DECL=$(mf declared_at); T0=$(python3 -c "import datetime as dt; print(int(dt.datetime.fromisoformat('$DECL'.replace('Z','+00:00')).timestamp()))")
READS=$(python3 -c "import json; r=json.load(open('$REG')); m=r['read_minutes']+ (r.get('extension',{}).get('extra_reads',[]) if r.get('extension',{}).get('until_exposure') else []); print(' '.join(str(x) for x in sorted(m)))")
SCRIPTS=$(python3 -c "import json; print(' '.join(json.load(open('$REG'))['reads']))"); DEADLINE=$(jf deadline_min); [ -n "$DEADLINE" ] || DEADLINE=780
# ---- phase READS: at each registered minute run the scripts, then verdict.py; death poll every 5 min in between
FINAL=""; FINALV=""
# TEARDOWN IS THREE STEPS AND HALF OF IT IS SILENTLY WRONG (CLAUDE.md). These are factored so the
# KEEP-without-promotion path and the REVERT/INCONCLUSIVE path cannot drift apart -- two copies of
# a teardown is how five bots were left running canary code after a "complete" one.
_restart_assigned() {
  # IT ONLY RESTARTED UNITS ALREADY `running`, so a stopped or failed bot was skipped and came
  # back on CANARY code -- a teardown that looks complete and is not. Every assigned unit is
  # restarted now, whatever state it is in, and the ones that were not running are named.
  # Bot names are enumerated from the log directories of the assigned pools rather than from a
  # hardcoded Alpha/Bravo/Comet/Delta/Echo list, which is wrong the moment a roster is partial.
  local skipped=""
  for pool in ${P//,/ }; do
    for d in /var/log/mcai/$pool-*; do
      [ -d "$d" ] || continue
      local b=$(basename "$d")
      systemctl list-units "mcbot@$b.service" --no-legend | grep -q running || skipped="$skipped $b"
      sudo systemctl restart "mcbot@$b.service" 2>/dev/null || skipped="$skipped $b(restart-failed)"
      sleep 12
    done
  done
  [ -n "$skipped" ] && journal teardown-note "units not running before restart (still restarted):$skipped"
  return 0
}

_teardown() {
  sudo /usr/local/sbin/mcai-canary-tree teardown | tail -1
  sudo python3 -c 'import json; p="/srv/mcbots/trial-manifest.json"; m=json.load(open(p)); m["canary_pool"]=None; m["canary_code_version"]=None; json.dump(m, open(p,"w"), indent=2)'
  _restart_assigned
  sleep 90
  local LIVE=$(for pool in ${P//,/ }; do for d in /var/log/mcai/$pool-*; do f=$(ls -t $d/skill-*.jsonl 2>/dev/null | head -1); [ -n "$f" ] && tail -1 $f | python3 -c 'import sys,json; print(json.loads(sys.stdin.readline())["code"]["version"][:7])' 2>/dev/null; done; done | sort | uniq -c | tr '\n' ' ')
  journal torn-down "$LIVE"
  page verdict "$FINAL $RUN; torn down; pools live: $LIVE"
}

for M in $READS; do
  grep -q "\"run\":\"$RUN\".*\"phase\":\"read-$M\"" $J 2>/dev/null && { echo "read +$M already done"; continue; }   # scoped to THIS run: the unscoped grep matched the previous run and skipped every read (16 Sep 22:25Z)
  while [ $(( $(date +%s) - T0 )) -lt $(( M * 60 )) ]; do
    sleep 300
    # THE POLL IS THE DEATH GATE, AND ITS STDERR WAS BEING THROWN AWAY (`2>/dev/null`).
    # A poll that cannot run is a safety check that is down, and it would have been silent here
    # every five minutes for hours -- the same class of defect as the empty read verdicts on
    # banktruth-01, at the one site where it matters most.
    V=$(python3 $H/verdict.py $RUN 0 --poll 2>$H/digest/poll-err-$RUN.log | tail -1)
    if [ -z "$V" ]; then
      journal poll-failed "$(tail -3 $H/digest/poll-err-$RUN.log 2>/dev/null | tr '\n' ' ' | cut -c1-300)"
      page error "DEATH POLL PRODUCED NO VERDICT -- the safety gate is not running: $(tail -2 $H/digest/poll-err-$RUN.log 2>/dev/null | tr '\n' ' ' | cut -c1-200)"
    fi
    case "$V" in *REVERT*) journal poll-revert "$V"; page verdict "$V"; FINAL=REVERT; FINALV="$V"; break 2;; esac
    if [ $(( $(date +%s) - T0 )) -gt $(( DEADLINE * 60 )) ]; then journal deadline "no verdict by +$DEADLINE"; page error "deadline +$DEADLINE reached without a verdict: containment"; FINAL=INCONCLUSIVE; FINALV="deadline +$DEADLINE reached without a verdict (containment)"; break 2; fi
  done
  # THE READ SCRIPTS LIVE IN /tmp AND NOTHING PUTS THEM THERE.
  # This runs /tmp/$s.py, but no step in this loop copies them in -- they are placed by hand
  # when a canary is prepared. /usr/lib/tmpfiles.d/tmp.conf carries `D /tmp 1777 root root
  # 30d`, and the D directive EMPTIES /tmp on boot. The host has been up two weeks so it has
  # not bitten, but a reboot would leave every registered read missing and the failure would
  # surface only as "no evidence object", several steps from the cause.
  #
  # It deliberately does NOT copy them in from /opt or ~/mcai-analysis. The /tmp copies are
  # frequently NEWER than the tree ones -- on 2026-09-23 /tmp held fixes that /opt did not --
  # so auto-copying would silently downgrade the instrument mid-canary, which is worse than
  # the outage it would paper over. It refuses and names what is missing instead.
  _miss=""
  for s in $SCRIPTS; do [ -f "/tmp/$s.py" ] || _miss="$_miss $s"; done
  if [ -n "$_miss" ]; then
    page error "registered read script(s) missing from /tmp:$_miss -- nothing copies them in and a reboot empties /tmp. Restore them before this canary can be read."
    journal "reads-missing" "missing from /tmp:$_miss"
    exit 4
  fi
  # A READ'S EXIT STATUS WAS NEVER CHECKED. A crashed or timed-out read wrote its traceback into
  # the .txt and the loop carried on as though it had read something; the failure then surfaced
  # several steps later as verdict.py's "no evidence object", which names the symptom and not the
  # cause. `timeout` returns 124, which is worth distinguishing from a crash.
  for s in $SCRIPTS; do
    (cd /opt/minecraft-ai/scripts && timeout 900 python3 /tmp/$s.py $M > $H/digest/reads/$RUN-$s-$M.txt 2>&1)
    _rc=$?
    if [ $_rc -ne 0 ]; then
      _what=$([ $_rc -eq 124 ] && echo "TIMED OUT after 900s" || echo "exited $_rc")
      journal read-failed "$s +$M $_what: $(tail -2 $H/digest/reads/$RUN-$s-$M.txt 2>/dev/null | tr '\n' ' ' | cut -c1-260)"
      page error "read $s +$M $_what -- its evidence is absent or partial, so this read cannot decide"
    fi
  done
  # A CRASH USED TO BE INDISTINGUISHABLE FROM A QUIET READ.
  # This captured stdout only, so when verdict.py raised, the traceback went to a stderr
  # nobody kept and $V became the EMPTY STRING -- which was then journalled as the verdict.
  # banktruth-01 recorded {"phase":"read-30","note":""}, {"read-90","note":""} and
  # {"read-180","note":""} on 2026-09-23: three scheduled reads, three empty notes, four and
  # a half hours into a canary due that night, with the loop alive and journalling the whole
  # time. verdict.py now refuses instead of raising, but the loop must not be able to swallow
  # the next one either.
  V=$(python3 $H/verdict.py $RUN $M 2>$H/digest/verdict-err-$RUN-$M.log | tail -1)
  [ -z "$V" ] && V="CRASH (no verdict on stdout): $(tail -3 $H/digest/verdict-err-$RUN-$M.log 2>/dev/null | tr '\n' ' ' | cut -c1-400)"
  journal "read-$M" "$V"
  case "$V" in *REVERT*|*KEEP*|*INCONCLUSIVE*) FINAL=$(echo "$V" | awk '{print $2}'); FINALV="$V"; page verdict "$V"; break;; *UNREADABLE*) page error "$V (HOLD: death poll continues)";; *WATCH*) page flag "$V";; *) echo "$V";; esac
done
[ -n "$FINAL" ] || { journal end "no final verdict"; page error "loop ended without a verdict"; exit 2; }
# ---- phase ACT
if [ "$NOACT" = "--no-act" ]; then echo "would act: $FINAL"; exit 0; fi
# Same guard on the closing note: an empty FINALV here would tear down on a blank verdict.
_FV="${FINALV:-$(python3 $H/verdict.py $RUN $M 2>$H/digest/verdict-err-$RUN-final.log | tail -1)}"
[ -z "$_FV" ] && _FV="CRASH (no verdict on stdout): $(tail -3 $H/digest/verdict-err-$RUN-final.log 2>/dev/null | tr '\n' ' ' | cut -c1-400)"
NOTE="$RUN: $_FV (canary loop)"; P=$(mf canary_pool)
# Containment for any verdict with no act branch. KEEP_ON_SAFETY is the live example: it
# matches *KEEP* in the read case above, so the loop stops reading and exits -- but it matched
# NEITHER branch below, so the loop recorded no ledger decision, neither promoted nor tore
# down, and left a DEPLOYED canary with the loop gone: an open loop found only the next
# morning. It never fired because 1011b reached exposure at +540. Contain as INCONCLUSIVE,
# which records and tears down, and is what the exposure interlock asks for on zero exposure.
case "$FINAL" in
  KEEP|REVERT|INCONCLUSIVE) ;;
  *) page error "verdict '$FINAL' has no promotion path; containing as INCONCLUSIVE and tearing down"; journal contained "$FINAL -> INCONCLUSIVE"; FINAL=INCONCLUSIVE ;;
esac
case "$FINAL" in
  KEEP)
    # KEEP WITHOUT A PROMOTION PATH USED TO `exit 2` AND LEAVE THE CANARY DEPLOYED.
    # The comment fifteen lines above describes exactly this failure -- "left a DEPLOYED canary
    # with the loop gone: an open loop found only the next morning" -- and the KEEP branch still
    # did it. It is not a corner case: a canary inside the 24-27 Sep program window MUST declare
    # promotion "none", because fleet-wide promotion is forbidden there, so every KEEP in that
    # window would have stranded its treatment. Record the KEEP, then tear down; the verdict is
    # preserved and the fleet is returned to baseline.
    if [ "$(jf promotion)" != "fleet-wide" ]; then
      page verdict "KEEP $RUN, promotion '$(jf promotion)' -- recording and tearing down rather than promoting"
      journal keep-unpromoted "promotion=$(jf promotion); recording KEEP then restoring baseline"
      (cd /opt/minecraft-ai && sudo python3 scripts/check-open-loop.py --record KEEP --note "$NOTE" | tail -1); journal recorded KEEP
      FINAL=KEEP_TEARDOWN
    fi
    if [ "$FINAL" = "KEEP_TEARDOWN" ]; then _teardown; exit 0; fi
    (cd /opt/minecraft-ai && sudo python3 scripts/check-open-loop.py --record KEEP --note "$NOTE" | tail -1); journal recorded KEEP
    $H/bin/fleet-deploy "$SHA" "$RUN-promote" "PROMOTION of $RUN (KEEP by the canary loop)" > $H/digest/deploy-$RUN-promote.log 2>&1; grep -q "VERIFIED" $H/digest/deploy-$RUN-promote.log || { page error "promotion not verified"; exit 2; }
    journal promoted "$SHA fleet-wide"; page verdict "PROMOTED $RUN $SHA fleet-wide (operator: fast-forward main and keep main-pre-<date>)";;
  REVERT|INCONCLUSIVE)
    (cd /opt/minecraft-ai && sudo python3 scripts/check-open-loop.py --record $FINAL --note "$NOTE" | tail -1); journal recorded "$FINAL"
    _teardown;;
esac
