#!/bin/bash
# positive controls for the flock and timeout shims
M=/private/tmp/claude-501/-Users-darrellmiller-Documents-code-minecraft-ai--claude-worktrees-heuristic-nightingale-49eee9/2a199c24-8dc2-4c02-9509-8499787c3dd1/scratchpad/m4
export PATH=$M/shimbin:$PATH
cd $M
exec 9>shim.lk
flock -n 9 && echo "first: acquired"
bash $M/shimctl2.sh
exec 9>&-
bash $M/shimctl2.sh
timeout 1 sleep 3; echo "timeout on a 3-s sleep: rc=$? (want 124)"
timeout 5 true; echo "timeout on true: rc=$? (want 0)"
timeout 5 false; echo "timeout on false: rc=$? (want 1)"
