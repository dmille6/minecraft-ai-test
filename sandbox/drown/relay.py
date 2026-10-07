#!/usr/bin/env python3
# Controller-side relay (light I/O only): runs the mineflayer driver on the fleet host (10.0.0.31) and the
# persistent RCON pipe on the worlds host (10.0.0.30), and ferries "@@RCON {json}" request lines from the
# driver to the pipe and the pipe's JSON replies back. Everything else the driver prints is echoed.
#   relay.py <sandbox2> <driver args...>
import subprocess, sys, threading
SRV = sys.argv[1]
assert SRV in ('sandbox', 'sandbox2', 'sandbox3')
args = ' '.join(sys.argv[2:])
pipe = subprocess.Popen(['ssh', 'mike@10.0.0.30', f'python3 /tmp/rconpipe.py {SRV}'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
drv = subprocess.Popen(['ssh', 'mike@10.0.0.31', f'cd /home/mike/drowntime && node drown.cjs {args}'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
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
