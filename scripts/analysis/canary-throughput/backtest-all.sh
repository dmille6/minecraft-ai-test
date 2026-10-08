#!/bin/bash
# backtest-all.sh -- six past canaries, each replayed twice at its DECIDING read instant: with the control it had, and
# with the control minus the pools a concurrent lane would have held (the other member of its pair). Pairs are adjacent
# canaries with disjoint pools. Prints the recorded verdict word, both replayed lines, and the bot dirs each view saw.
cd ~/lanes-work
OUT=~/lanes-work/backtest-all.out; : > $OUT
run() {  # tag run M T base pools decl excl
  local tag=$1 run=$2 M=$3 T=$4 base=$5 pools=$6 decl=$7 excl=$8
  local rec=$(grep "\"run\":\"$run\"" ~/canary-journal.jsonl | grep -E "\"phase\":\"(read-$M|poll-revert)\"" | tail -1 | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['note'][:220])")
  echo "=== $run +$M at $T (pools $pools) -- other lane: $excl" >> $OUT
  echo "  RECORDED : $rec" >> $OUT
  local f=$(bash backtest.sh $tag-full $run $M $T - $base $pools $decl 2>>$OUT.err | tail -1)
  echo "  FULL     : ${f:0:220}   [view: $(ls views/$tag-full/logs | grep -vc '^_') bot dirs]" >> $OUT
  local r=$(bash backtest.sh $tag-red $run $M $T $excl $base $pools $decl 2>>$OUT.err | tail -1)
  echo "  REDUCED  : ${r:0:220}   [view: $(ls views/$tag-red/logs | grep -vc '^_') bot dirs; excluded present: $(ls views/$tag-red/logs | grep -cE "^(${excl//,/|})-")]" >> $OUT
  echo "  SAME VERDICT WORD: $( [ "$(echo "$f" | awk '{print $2}')" = "$(echo "$r" | awk '{print $2}')" ] && echo yes || echo NO )  (full $(echo "$f" | awk '{print $2}'), reduced $(echo "$r" | awk '{print $2}'))" >> $OUT
}
run fs   foodskip-01    360  2026-10-07T12:02:00Z c902d6f board-d,hive-c,placebo-b         2026-10-07T01:10:52.406369Z board-b,placebo-a
run td   towndeposit-01 180  2026-10-07T16:11:00Z c6e91a8 board-b,placebo-a                 2026-10-07T13:06:18.788320Z board-d,hive-c,placebo-b
run jw   junkwell-01    poll 2026-10-05T15:13:00Z 1918bb5 placebo-a,board-b                 2026-10-05T10:05:20.951551Z board-a,board-c,board-d,placebo-d
run cf2b chestfull-02   360  2026-10-05T21:33:00Z 1918bb5 board-a,board-c,board-d,placebo-d 2026-10-05T15:24:10.072778Z placebo-a,board-b
run wd   withdraw-01    540  2026-10-06T14:29:00Z 47110e8 board-b,placebo-a                 2026-10-06T05:22:41.403680Z board-a,board-c,hive-a
run cl2  climbflood-02  360  2026-10-06T20:52:00Z b54e22c board-a,board-c,hive-a            2026-10-06T14:44:21.659980Z board-b,placebo-a
echo DONE >> $OUT
