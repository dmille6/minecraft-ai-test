#!/bin/bash
M=/private/tmp/claude-501/-Users-darrellmiller-Documents-code-minecraft-ai--claude-worktrees-heuristic-nightingale-49eee9/2a199c24-8dc2-4c02-9509-8499787c3dd1/scratchpad/m4
export PATH=$M/shimbin:$PATH
cd $M
exec 8>shim.lk
if flock -n 8; then echo "other process: acquired"; else echo "other process: REFUSED (held)"; fi
