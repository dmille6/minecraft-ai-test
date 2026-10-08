#!/bin/bash
# restore-reads.sh -- /tmp is emptied on reboot (and systemd-tmpfiles-clean ages files out), but canary-loop.sh,
# chain-after.sh and nightwatch.sh read scripts from /tmp. The source of truth is ~/mcai-analysis; copy any read that
# is MISSING from /tmp (never overwrite a newer staged copy). Run @reboot and every 10 min by cron. Added 2026-10-08
# (owner: "yes" to the four reboot fixes) after two outages lost /tmp reads.
shopt -s nullglob
n=0
for f in /home/mike/mcai-analysis/*.py; do
  b=/tmp/$(basename "$f")
  [ -e "$b" ] || { cp -p "$f" "$b" && n=$((n+1)); }
done
[ $n -gt 0 ] && echo "$(date -u +%FT%TZ) restored $n read script(s) to /tmp" >> /home/mike/digest/restore-reads.log
exit 0
