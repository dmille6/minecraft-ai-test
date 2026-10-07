#!/usr/bin/env python3
"""bench-c2 behaviour mutants for test/directives.test.mjs. Run on a COPY of the tree: python3 directives-mutants.py <copy-root>.
Each anchor must be present exactly once; every mutant must be KILLED."""
import subprocess, shutil, sys
base=sys.argv[1]
M=[
 ('hold branch removed','src/cognitive.mjs',"if (dnext?.hold) {","if (false) {"),
 ('queue returns null while waiting','src/directives.mjs',"return { hold: true, id: d.id, gen: d.gen, origin: d.origin, until: d.retryAt }","return null"),
 ('reconnect release removed','src/cognitive.mjs',"directives.releaseAll('new connection', Date.now())","void 0"),
 ('original trigger dropped','src/cognitive.mjs',"trigger = `directive:${dstep.origin}/${trigger}`","trigger = `directive:${dstep.origin}`"),
 ('neverRan cooldown skip removed','src/cognitive.mjs',"      if (neverRan) {\n","      if (false) {\n"),
 ('orphan kept removed','src/directives.mjs',"this.orphans.set(d.gen, d)","void 0"),
 ('expiry does not retire','src/directives.mjs',"`lease ended at step ${this.active.step + 1} of ${this.active.steps.length}`, now)\n      this.#retire(this.active)","`lease ended at step ${this.active.step + 1} of ${this.active.steps.length}`, now)\n      this.active = null"),
 ('inflight never set','src/directives.mjs',"if (status === 'dispatched') d.inflight = true","void 0"),
 ('inflight always','src/directives.mjs',"    if (d.inflight) {\n      this.orphans.set","    if (true) {\n      this.orphans.set"),
 ('dispatched note removed','src/cognitive.mjs',"if (dstep) directives.note(dstep.gen, 'dispatched'","if (false) directives.note(dstep.gen, 'dispatched'"),
]
for name,f,old,new in M:
    p=base+'/bots/'+f; src=open(p).read()
    assert src.count(old)==1, 'ANCHOR '+name
    open(p,'w').write(src.replace(old,new))
    r=subprocess.run(['node','test/directives.test.mjs'],cwd=base+'/bots',capture_output=True,text=True,timeout=120)
    open(p,'w').write(src)
    msg=[l for l in (r.stdout+r.stderr).splitlines() if 'assert' in l.lower() or 'Error' in l][:2]
    print('KILLED' if r.returncode else 'SURVIVED', '|', name, '|', ' / '.join(m.strip()[:140] for m in msg))
