#!/bin/bash
# nightwatch.sh -- TIER 0: deterministic fleet digest, no model. Run by cron every 30 min on the bots host.
# Writes /srv/mcbots/digest/<UTC ts>.md and refreshes /srv/mcbots/digest/latest.md. Every section is a script that
# already existed; this only runs them on a clock so nobody has to. Read scripts live in /tmp (staged) or scripts/.
set -u; cd /opt/minecraft-ai || exit 1
D=$HOME/digest; mkdir -p $D
TS=$(date -u +%Y%m%dT%H%M); OUT=$D/$TS.md; exec > $OUT 2>&1
sec() { echo; echo "## $1  ($(date -u +%H:%M:%S))"; }
echo "# fleet digest $TS UTC"
M=/srv/mcbots/trial-manifest.json
POOL=$(python3 -c "import json;print(json.load(open('$M')).get('canary_pool') or '')")
CV=$(python3 -c "import json;print(json.load(open('$M')).get('canary_code_version') or '')")
DECL=$(python3 -c "import json;print(json.load(open('$M')).get('declared_at') or '')")
RUN=$(python3 -c "import json;print(json.load(open('$M')).get('run_id') or '')")
ELAPSED=$(python3 -c "import datetime as dt;d=dt.datetime.fromisoformat('$DECL'.replace('Z','+00:00'));print(int((dt.datetime.now(dt.timezone.utc)-d).total_seconds()/60))" 2>/dev/null || echo "?")
# A TORN-DOWN CANARY LEAVES run_id AND declared_at IN THE MANIFEST -- only
# canary_pool and canary_code_version are cleared by the three-step teardown.
# Printed unconditionally, the header therefore names a dead run and an elapsed
# clock that reads as a live deadline: measured 2026-09-19, owner-01b was torn
# down at 16:42Z on 18 Sep and the tier-1 analyst paged "stall: past the +780
# deadline with no verdict" six times overnight on a slot that was free and a
# ledger that said so three lines below. The fields stay (they are the history),
# but a closed canary must not be presented as a running one.
if [ -n "$POOL" ]; then
  echo "manifest: LIVE CANARY run_id=$RUN canary_pool='${POOL}' canary_code_version='${CV}' declared_at=$DECL (+${ELAPSED} min)"
else
  echo "manifest: NO LIVE CANARY -- canary_pool is empty, the slot is free, no deadline is running and no read is due."
  echo "manifest: (history only, NOT a live canary) last_run_id=$RUN declared_at=$DECL; the +${ELAPSED} min since that stamp is NOT an elapsed deadline."
fi
sec "versions live (must be exactly one, or two with a code canary)"
for d in /var/log/mcai/*/; do tail -c 200000 $d/skill-*.jsonl 2>/dev/null | grep -a '"version"' | tail -1 | grep -ao '"version": *"[^"]*"' | cut -d'"' -f4; done | sort | uniq -c
sec "open loop"
timeout 120 python3 scripts/check-open-loop.py 2>&1 | tail -3
sec "quick status (2 h)"
timeout 280 python3 /tmp/quickstatus.py 2>&1 | tail -12
if [ -n "$POOL" ]; then
  sec "canary read: $RUN on $POOL (+${ELAPSED} min)"
  if [ "$CV" = "$(python3 -c "import json;print(json.load(open('$M')).get('declared_code_version') or '')")" ]; then
    echo "(same code both arms: a MODEL/ENV canary -> modelshare + cooldid4)"
    timeout 280 python3 /tmp/modelshare.py "$ELAPSED" 2>&1 | tail -8
    timeout 280 python3 /tmp/cooldid4.py 2>&1 | grep -v "^\s*$" | tail -14
  else
    W=$(( ELAPSED > 3 ? ELAPSED - 3 : 1 ))
    timeout 280 python3 scripts/canary-report.py --pool "$POOL" --minutes "$W" 2>&1 | tail -22
  fi
  sec "canary deaths since cutoff"
  grep -ah '"_death"' /var/log/mcai/$POOL-*/skill-*.jsonl 2>/dev/null | python3 -c "
import sys,json
n=0
for l in sys.stdin:
    try: r=json.loads(l)
    except: continue
    if r.get('@timestamp','')>='$DECL': n+=1; print(' ', r['@timestamp'][11:19], r['bot']['name'], (r['skill'].get('detail') or '')[:120])
print('canary deaths since cutoff:', n)"
fi
sec "tripper (last lines)"
(sudo -n journalctl -u mcai-tripper --no-pager -n 6 2>/dev/null || tail -6 /var/log/mcai/tripper.log 2>/dev/null || echo "tripper log not readable without sudo") | cut -c1-200
echo; echo "## end $(date -u +%H:%M:%S)"
cp $OUT $D/latest.md
