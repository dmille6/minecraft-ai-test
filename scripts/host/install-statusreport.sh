#!/usr/bin/env bash
# install-statusreport.sh -- install the owner's status report (scripts/host/statusreport.py) on the canary host 10.0.0.31.
# Run FROM THE MAC (it ships a git archive of origin/main's scripts/ tree; nothing runs from /opt/minecraft-ai, which the
# fleet deploy resets to an older tree):
#
#   bash scripts/host/install-statusreport.sh            # DRY RUN: self-test + one report into a temp dir; installs nothing
#   bash scripts/host/install-statusreport.sh --apply    # ~/statusreport/app = origin/main scripts/ + SHA; ONE cron line
#   bash scripts/host/install-statusreport.sh --rollback # remove the cron line (the app dir and the reports stay)
#
# Cron runs in UTC on .31: 3 minutes past 00,05,06,11,12,17,18,23Z; statusreport.py itself keeps only the run that lands on
# 12 AM / 6 AM / 12 PM / 6 PM Central (CST and CDT), so the clock change needs no edit. Read-only on worlds and bots.
# The narrative pass turns itself on only when ~/.config/mcai/anthropic.key (mode 600) exists on the host (or a local
# model is configured in ~/.config/mcai/statusreport.json); this script never copies a key.
set -euo pipefail
MODE="${1:-dry}"
H=mike@10.0.0.31
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REF="${REF:-origin/main}"
TAG='# statusreport'
CRON="3 0,5,6,11,12,17,18,23 * * * cd \$HOME/statusreport/app/scripts && /usr/bin/nice -n 10 /usr/bin/python3 -B host/statusreport.py run >> \$HOME/digest/statusreport.log 2>&1 $TAG"

git -C "$REPO" fetch -q origin
SHA="$(git -C "$REPO" rev-parse "$REF")"
git -C "$REPO" cat-file -e "$SHA:scripts/host/statusreport.py" || { echo "REFUSED: $REF has no scripts/host/statusreport.py"; exit 2; }

ship() {   # $1 = target dir on the host
  git -C "$REPO" archive "$SHA" scripts | ssh "$H" "set -e; rm -rf '$1.new'; mkdir -p '$1.new'; tar -x -C '$1.new'; echo $SHA > '$1.new/SHA'"
}

case "$MODE" in
  dry)
    T=$(ssh "$H" 'mktemp -d $HOME/.statusreport-dry.XXXXXX')
    ship "$T/app"
    ssh "$H" "set -e; cd '$T/app.new/scripts' && python3 -B host/test_statusreport.py | tail -1
      python3 -B host/statusreport.py run --force --no-push --no-llm --out '$T/out' && head -12 '$T'/out/report-*.md; rm -rf '$T'"
    echo "dry run OK ($SHA). --apply installs it and adds: $CRON"
    ;;
  --apply)
    ship statusreport/app
    ssh "$H" "set -e; cd \$HOME/statusreport && python3 -B app.new/scripts/host/test_statusreport.py | tail -1
      rm -rf app.old; [ -d app ] && mv app app.old; mv app.new app; mkdir -p \$HOME/digest/statusreport
      crontab -l > \$HOME/statusreport/crontab.bak-\$(date -u +%Y%m%dT%H%M%SZ) 2>/dev/null || true
      if crontab -l 2>/dev/null | grep -qF '$TAG'; then
        (crontab -l | grep -vF '$TAG'; echo '$CRON') | crontab -; echo 'cron line replaced'
      else
        (crontab -l 2>/dev/null; echo '$CRON') | crontab -; echo 'cron line added'
      fi
      crontab -l | grep -F '$TAG'; cat app/SHA"
    ;;
  --rollback)
    ssh "$H" "(crontab -l | grep -vF '$TAG') | crontab -; echo 'cron line removed'; crontab -l | grep -cF '$TAG' || true"
    ;;
  *) echo "usage: $0 [--apply|--rollback]"; exit 1 ;;
esac
