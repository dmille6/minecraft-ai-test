#!/bin/bash
# Runs out/queue.txt top to bottom, one model at a time. A line is
#   "engine model label brain-think slow-think [screen] [run_bench args...]"
# ("screen" = the fixed A1 subset, no throughput sweep; the same label later run in full resumes and skips
# what the screen already did). Done LINES go to out/done.txt. Polls for appended lines; touch out/STOP to stop.
cd "$(dirname "$0")"
touch out/done.txt
while [ ! -e out/STOP ]; do
  line=""
  while IFS= read -r l; do
    [ -z "$l" ] && continue; [[ "$l" == \#* ]] && continue
    grep -qxF "$l" out/done.txt || { line="$l"; break; }
  done < out/queue.txt
  if [ -z "$line" ]; then sleep 60; continue; fi
  set -- $line
  ./run_model.sh "$@"
  echo "$line" >> out/done.txt
done
echo "queue stopped $(date -u +%FT%TZ)" >> out/driver.log
