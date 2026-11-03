#!/usr/bin/env python3
# Worlds-host relay for swim.mjs (expwater-01): runs rconpipe.py <server> and the driver on THIS host and ferries "@@RCON" lines.
#   swimrelay.py <sandbox3> <out.jsonl> <crossings> <bots dir> [noegress|egress] [far_up 0|1] [width]
# Copy sandbox/drown/rconpipe.py beside it. Take the sandbox lock first (sandbox/sbxlock.sh take sandbox3 <tag>).
# 11-03 runs (sandbox3, bots tree adbf9e41): level shores width 8 20/20, 14 19/20, 20 18/20; far shore one up 0/10 exits.
import subprocess, sys, threading, os
SRV = sys.argv[1]
assert SRV in ('sandbox', 'sandbox2', 'sandbox3')
here = os.path.dirname(os.path.abspath(__file__))
pipe = subprocess.Popen(['python3', os.path.join(here, 'rconpipe.py'), SRV], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
drv = subprocess.Popen(['node', os.path.join(here, 'swim.mjs'), SRV] + sys.argv[2:], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
def back():
    for line in pipe.stdout:
        drv.stdin.write(line); drv.stdin.flush()
threading.Thread(target=back, daemon=True).start()
for line in drv.stdout:
    if line.startswith('@@RCON '):
        pipe.stdin.write(line[7:]); pipe.stdin.flush()
    else:
        sys.stdout.write(line); sys.stdout.flush()
drv.wait(); pipe.stdin.close(); pipe.wait()
print('relay: driver exit', drv.returncode, flush=True)
