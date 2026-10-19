#!/bin/bash
# v36-wait.sh <run> <until-epoch> -- run install-gate-v36.sh as soon as <run> is closed and the slot is empty.
# Closed = the run's journal shows `torn-down` or a fleet-wide `promoted` row. Empty = no canary loop, no canary
# drop-ins, and a manifest that declares no canary. The installer itself re-checks all of this under the scheduler's
# install-hold and /tmp/mcai-canary.lock and refuses if anything launched first; this only picks the moment.
# A refusal ONLY because the slot was not yet free (the hold not claimable: the scheduler's settling checks, or the loop
# lock held) is retried on the next empty-slot poll. Any other outcome -- INSTALLED, a test failure, a rollback -- ends
# the waiter. Polls every 30 s (the scheduler ticks every 5 min). Gives up at <until-epoch>. Log: ~/gate-v36/v36-wait.log
RUN=$1; UNTIL=$2; S=$(cd "$(dirname "$0")" && pwd); L=$S/v36-wait.log; N=0
echo "$(date -u +%FT%TZ) waiting for $RUN to close, then an empty slot (until $(date -u -d @$UNTIL +%FT%TZ))" >> $L
while [ "$(date +%s)" -lt "$UNTIL" ]; do
  if grep -qE "\"run\":\"$RUN\",\"phase\":\"(torn-down|promoted)\"" ~/canary-journal.jsonl \
     && ! pgrep -f '^bash /home/mike/canary-loop[.]sh' >/dev/null \
     && [ -z "$(ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf 2>/dev/null)" ] \
     && python3 -c "import json,sys; m=json.load(open('/srv/mcbots/trial-manifest.json')); sys.exit(1 if (m.get('canary_pool') or m.get('canary_code_version')) else 0)"; then
    N=$((N + 1))
    echo "$(date -u +%FT%TZ) slot empty (attempt $N): running install-gate-v36.sh" >> $L
    bash $S/install-gate-v36.sh > $S/install-v36-$N.out 2>&1; RC=$?
    echo "$(date -u +%FT%TZ) installer exit $RC: $(tail -1 $S/install-v36-$N.out | cut -c1-300)" >> $L
    if [ $RC -eq 2 ] && grep -qE '^REFUSED: (install-hold not claimed|/tmp/mcai-canary.lock is held)' $S/install-v36-$N.out; then
      sleep 120; continue
    fi
    exit 0
  fi
  sleep 30
done
echo "$(date -u +%FT%TZ) gave up at the deadline" >> $L
