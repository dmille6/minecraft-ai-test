#!/usr/bin/env python3
"""brain-01 behaviour mutants for test/brain01.test.mjs. Run on a COPY of the tree: python3 brain01-mutants.py <copy-root>
(the copy needs bots/node_modules). Each anchor must be present exactly once; a mutant is KILLED only when the test
fails BY AN ASSERTION (a FAIL line), never by a crash; the source is restored in `finally`; any SURVIVED or
NOT-AN-ASSERTION result makes this script exit 1. A baseline run must pass first."""
import subprocess, sys
base = sys.argv[1]
def run():
    try:
        r = subprocess.run(['node', 'test/brain01.test.mjs'], cwd=base + '/bots', capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired as e:   # a hang is not an assertion: reported as such, never as KILLED
        out = (e.stdout or b'').decode() if isinstance(e.stdout, bytes) else (e.stdout or '')
        return 124, [], 'TIMEOUT after 180 s; last test line: ' + (out.strip().splitlines() or [''])[-1]
    return r.returncode, [l.strip() for l in r.stdout.splitlines() if l.strip().startswith('FAIL')], r.stderr
rc, fails, err = run()
assert rc == 0 and not fails, 'BASELINE NOT GREEN: %s %s' % (fails[:2], err[-300:])
M = [
 ('global timeout for every endpoint', 'src/llm.mjs', 'setTimeout(() => ctl.abort(), ep.timeoutMs ?? this.timeoutMs)', 'setTimeout(() => ctl.abort(), this.timeoutMs)'),
 ('brain always local', 'src/llm.mjs', "brain: servedEp ? (servedEp.brain ?? 'local') : null,", "brain: servedEp ? 'local' : null,"),
 ('brain never null', 'src/llm.mjs', "brain: servedEp ? (servedEp.brain ?? 'local') : null,", "brain: servedEp ? (servedEp.brain ?? 'local') : 'local',"),
 ('mismatch vs global model', 'src/llm.mjs', 'model_mismatch: modelMismatch(servedEp?.model ?? this.model, servedModel),', 'model_mismatch: modelMismatch(this.model, servedModel),'),
 ('think also to the fallback', 'src/llm.mjs', '...(this.think === undefined || (this.thinkLabelledOnly && !ep.brain) ? {} : { think: this.think }),', '...(this.think === undefined ? {} : { think: this.think }),'),
 ('think always sent', 'src/llm.mjs', '...(this.think === undefined || (this.thinkLabelledOnly && !ep.brain) ? {} : { think: this.think }),', 'think: this.think ?? null,'),
 ('pool drops the label', 'src/llm.mjs', "brain: brain ?? null, timeoutMs: timeoutMs ?? null,", "brain: null, timeoutMs: timeoutMs ?? null,"),
 ('bad timeout defaulted', 'src/llm.mjs', "if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw", "if (false) throw"),
 ('logger drops brain', 'src/logger.mjs', '      brain: brain ?? null,\n', ''),
 ('work order not labelled', 'src/cognitive.mjs', 'brain: decisionBrain(!!order, res),', 'brain: decisionBrain(false, res),'),
 ('_brain_config on every bot', 'src/cognitive.mjs', "this.brainTally = labelled(this.llm.pool?.eps).length ? new BrainTally() : null", "this.brainTally = new BrainTally()"),
 ('_brain_share never written', 'src/cognitive.mjs', "if (share) { try { logEvent({ kind: 'brain_share',", "if (false) { try { logEvent({ kind: 'brain_share',"),
 ('brain primary not prepended', 'src/brain.mjs', "return [p, ...own.filter(e => e.split('|')[0] !== p.split('|')[0])]", "return own"),
 ('config ignores OLLAMA_BRAIN_PRIMARY', 'src/config.mjs', 'composePool(process.env.OLLAMA_BRAIN_PRIMARY,', 'composePool(undefined,'),
 ('_brain_config never written', 'src/cognitive.mjs', "logEvent({ kind: 'brain_config',", "void ({ kind: 'brain_config',"),
 ('repair goes back to the rejected endpoint', 'src/llm.mjs', 'if (labelledPool && servedEp?.brain) skip = servedEp\n        attempt++\n        continue\n      }\n\n      // Trimmed.', 'attempt++\n        continue\n      }\n\n      // Trimmed.'),
 ('second walk after total failure', 'src/llm.mjs', '        if (labelledPool) break\n', ''),
 ('skip ignored by #post', 'src/llm.mjs', "for (const ep of (skip && eps.length > 1 ? eps.filter(e => e !== skip) : eps)) {", "for (const ep of eps) {"),
]
bad = 0
for name, f, old, new in M:
    print('...', name, flush=True)
    p = base + '/bots/' + f; src = open(p).read()
    assert src.count(old) == 1, 'ANCHOR %s (%d)' % (name, src.count(old))
    try:
        open(p, 'w').write(src.replace(old, new))
        rc, fails, err = run()
    finally:
        open(p, 'w').write(src)
    verdict = 'KILLED' if (rc and fails) else ('NOT-AN-ASSERTION' if rc else 'SURVIVED')
    bad += verdict != 'KILLED'
    print(verdict, '|', name, '|', fails[0][:100] if fails else err.strip().splitlines()[-1][:100] if err.strip() else '')
print('%d of %d killed by an assertion' % (len(M) - bad, len(M)))
sys.exit(1 if bad else 0)
