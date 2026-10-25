#!/bin/bash
# The coordinator's layout: a copy of the branch's scripts/ with the patched canary-loop.sh, canary-sched.py and
# drawrec.sh (and the patched test_canary_sched.py) in scripts/host/. Every suite, with `timeout` on PATH (a shim on
# macOS) so test_threepool's draw-block cases RUN instead of skipping. $1 = label (patched|live).
set -u
M=/private/tmp/claude-501/-Users-darrellmiller-Documents-code-minecraft-ai--claude-worktrees-heuristic-nightingale-49eee9/2a199c24-8dc2-4c02-9509-8499787c3dd1/scratchpad/m4
W=/Users/darrellmiller/Documents/code-minecraft-ai/.claude/worktrees/agent-ad31fb72daa88ce49
D=$W/docs/reports/tier2-four-pools-2026-10-24
LBL=$1
R=$M/layout4-$LBL; rm -rf $R; mkdir -p $R; cp -R $W/scripts $R/scripts
if [ "$LBL" = patched ]; then
  cp $M/pw/canary-loop.sh $M/pw/canary-sched.py $M/pw/drawrec.sh $M/pw/test_canary_sched.py $R/scripts/host/
else
  cp $M/host/canary-loop.sh $M/host/canary-sched.py $M/host/mcai-analysis/drawrec.sh $R/scripts/host/
fi
# test_bagfix_loop copies the host's ~/v30check.py: point the LAYOUT COPY at a read-only fetch of it (md5 a6770a3d)
python3 -c "import sys; p=sys.argv[1]; s=open(p).read(); assert s.count('/home/mike/v30check.py')==1; open(p,'w').write(s.replace('/home/mike/v30check.py', sys.argv[2]))" $R/scripts/host/test_bagfix_loop.py $M/host/v30check.py
md5 -q $R/scripts/host/canary-loop.sh $R/scripts/host/canary-sched.py $R/scripts/host/drawrec.sh
export PATH=$M/shimbin:$PATH
O=$M/out4-$LBL; rm -rf $O; mkdir -p $O
cd $R/scripts
python3 test_threepool.py > $O/test_threepool.out 2>&1; echo "threepool rc=$? $(tail -1 $O/test_threepool.out)"
python3 test_drawrequire.py > $O/test_drawrequire.out 2>&1; echo "drawrequire rc=$? $(tail -1 $O/test_drawrequire.out)"
python3 host/test_bagfix_loop.py > $O/test_bagfix_loop.out 2>&1; echo "bagfix_loop rc=$? $(tail -1 $O/test_bagfix_loop.out)"
python3 test_holdtoken.py > $O/test_holdtoken.out 2>&1; echo "holdtoken rc=$? $(tail -1 $O/test_holdtoken.out)"
if [ "$LBL" = patched ]; then
  python3 $D/patches/test_drawrec_tier2.py host/drawrec.sh $M/host/mcai-analysis/drawrequire.py $M/pw/tierrule.py --mutants > $O/test_drawrec_tier2.out 2>&1; echo "drawrec_tier2 rc=$? $(tail -1 $O/test_drawrec_tier2.out)"
  python3 $D/patches/test_loop_tier2.py host/canary-loop.sh $M/pw/tierrule.py $M/host/mcai-analysis/drawrequire.py --mutants > $O/test_loop_tier2.out 2>&1; echo "loop_tier2 rc=$? $(tail -1 $O/test_loop_tier2.out)"
  python3 host/test_canary_sched.py --mutants > $O/test_canary_sched.out 2>&1; echo "canary_sched rc=$? $(grep -E 'tests pass|mutants killed|SURVIVED' $O/test_canary_sched.out | tr '\n' ' ')"
fi
