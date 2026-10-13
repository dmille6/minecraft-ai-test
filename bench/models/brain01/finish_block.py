#!/usr/bin/env python3
"""Take over ONE running brain-01 block from the series runner (which is stopped so it starts no next block): keep the
gemma-share floor on it until its cl_run exits, then free the Studio (PAUSE + unload `brain` only) and record the pause.
    python3 finish_block.py <cl_run pid> <arm> <block>
"""
import importlib.util, json, os, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('s', os.path.join(HERE, 'brain01_series.py')); s = importlib.util.module_from_spec(spec)
sys_argv = sys.argv; sys.argv = ['x']; spec.loader.exec_module(s); sys.argv = sys_argv
pid, arm, b = int(sys.argv[1]), sys.argv[2], int(sys.argv[3])
alive = lambda: subprocess.run(['kill', '-0', str(pid)], capture_output=True).returncode == 0
s.install_share()
aborted = None
while alive():
    rd = s.latest_run(arm, b)
    why = s.violates(arm, s.share(rd)) if rd else None
    if why:
        aborted = why; print('ABORT', os.path.basename(rd), why, flush=True)
        subprocess.run(['kill', str(pid)]); s.stop_bots(rd); s.flag(os.path.basename(rd), why); break
    for _ in range(30):
        if not alive(): break
        time.sleep(10)
while alive(): time.sleep(10)
print('block b%d %s ended %s' % (b, arm, time.strftime('%FT%TZ', time.gmtime())), flush=True)
out = subprocess.run(['ssh', '-o', 'BatchMode=yes', 'mike@ai.ticrcorp.com',
                      'touch ~/brain01/PAUSE && ~/.lmstudio/bin/lms unload brain 2>&1 | tail -1; ~/.lmstudio/bin/lms ps | grep -c "^brain " || true'],
                     stdin=subprocess.DEVNULL, capture_output=True, text=True).stdout
print('STUDIO FREED', time.strftime('%FT%TZ', time.gmtime()), out.strip().replace('\n', ' | '), flush=True)
with open(s.RUNS, 'a') as f:
    f.write(json.dumps({'run_id': 'brain01-pause-%s' % time.strftime('%m%dT%H%M', time.gmtime()), 'arm': 'brain01-pause', 'flag': 'PAUSE (not a run): the Studio yielded to andy-eval\'s owner-requested LoRA fine-tune after block b%d %s; the series resumes with the remaining blocks in their original order' % (b, arm), 'start': time.strftime('%FT%TZ', time.gmtime())}) + '\n')
