#!/bin/bash
# wait for qwen35-01 run-load.sh ALL-DONE, then 10 quiet minutes, then the guarded Blackwell worker
until grep -q ALL-DONE $HOME/qwen35-01/run-load.log 2>/dev/null; do sleep 30; [ "$(date -u +%s)" -ge "$(date -u -d 2026-10-31T02:00:00Z +%s)" ] && { echo "$(date -u +%FT%TZ) never saw ALL-DONE before 02:00Z; not starting"; exit 0; }; done
echo "$(date -u +%FT%TZ) saw ALL-DONE; quiet margin 10 min"; sleep 600
exec ./blackwell_window.sh
