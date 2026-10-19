#!/usr/bin/env python3
"""Move an ALREADY-QUEUED entry to sit directly after another one (operator tool, brain-01 10-19).

    python3 queue-move-after.py <run> <after_run> [--dry-run]

`canary-sched.py queue add` validates an entry and APPENDS it. The scheduler never looks past the head, so an entry
appended behind held entries (townfloor-01, monument-01, shaft-01 on 10-19) would never launch. This moves <run> to the
position right after <after_run>, and sets its `after` to [<after_run>], under the scheduler's OWN queue lock (it calls
canary-sched.py's with_queue, so it is never wrapped in another flock: the scheduler's commands take their locks
themselves). It changes nothing else: no hashes, no variants, no holds. A backup of the queue is written first.
Refuses if <run> or <after_run> is not queued. Run it only right after `queue add <run>`, and confirm with
`canary-sched.py status` (the line for <run>, and the DECISION line) afterwards.
Tested 10-19 on a COPY of the live queue (SCHED_QUEUE / SCHED_QUEUE_LOCK pointed at /tmp): --dry-run writes nothing;
the real move put the entry right after <after_run>, set its `after`, and wrote the backup.
"""
import importlib.util, json, os, shutil, sys, time

def main(argv):
    if len(argv) < 3:
        print(__doc__); return 2
    run, after, dry = argv[1], argv[2], '--dry-run' in argv
    spec = importlib.util.spec_from_file_location('canarysched', os.path.expanduser('~/canary-sched.py'))
    cs = importlib.util.module_from_spec(spec); spec.loader.exec_module(cs)
    P = cs.paths()
    out = {}

    def move(q):
        E = q['entries']
        names = [e.get('run') for e in E]
        if run not in names or after not in names:
            raise SystemExit('REFUSED: %s or %s is not queued (queue: %s)' % (run, after, names))
        e = E[names.index(run)]
        before = list(names)
        E.remove(e)
        E.insert([x.get('run') for x in E].index(after) + 1, e)
        e['after'] = [after]
        out['before'], out['after'] = before, [x.get('run') for x in E]
        if dry:
            raise _Dry()
        bak = P['queue'] + '.bak-move-%s-%s' % (run, time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
        shutil.copy2(P['queue'], bak); out['backup'] = bak

    class _Dry(Exception):
        pass
    try:
        cs.with_queue(P, move)
    except _Dry:
        print('DRY RUN (nothing written)')
    print('order before:', out.get('before')); print('order after: ', out.get('after'))
    if out.get('backup'):
        print('backup:', out['backup'])
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv))
