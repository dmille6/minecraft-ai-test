#!/bin/bash
# voyager-01: the scheduled reads and the end of the 48-h run (design §8-9). Run as root on the worlds host.
#   voyager_end.sh day <N> <since-ISO>   write /srv/voyager/reports/day-<N>.txt (+ .json) from voyager_metrics.py
#   voyager_end.sh end <since-ISO>       the success-bar read: final metrics, then stop every voyager bot and server,
#                                        and unload the Studio models the pilot used (keep_alive 0)
set -u
R=/srv/voyager/reports; mkdir -p "$R"
M=/srv/voyager/code/voyager/watch/voyager_metrics.py
case "$1" in
day)
  python3 "$M" --since "$3" --arms a,b,c,ctl > "$R/day-$2.txt" 2>&1
  python3 "$M" --since "$3" --arms a,b,c,ctl --json > "$R/day-$2.json" 2>&1 ;;
end)
  python3 "$M" --since "$2" --arms a,b,c,ctl > "$R/final.txt" 2>&1
  python3 "$M" --since "$2" --arms a,b,c,ctl --json > "$R/final.json" 2>&1
  rm -f /srv/voyager/RUNNING-*
  for a in a b c ctl; do systemctl stop "voyager-bot@$a"; done
  for a in a b c ctl; do systemctl stop "voyager-paper@$a"; done
  for m in qwen3.6:35b-a3b qwen2.5-coder:32b qwen2.5:7b-instruct; do
    curl -s -m 30 http://ai.ticrcorp.com:11436/api/generate -d "{\"model\":\"$m\",\"keep_alive\":0}" > /dev/null
  done
  curl -s -m 10 http://ai.ticrcorp.com:11436/api/ps > "$R/studio-ps-after.json"
  date -u +%FT%TZ > "$R/ENDED" ;;
esac
