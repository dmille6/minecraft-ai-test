#!/usr/bin/env python3
"""brain-01 behaviour mutants for test/brain01.test.mjs. Run on a COPY of the tree: python3 brain01-mutants.py <copy-root>
(the copy needs bots/node_modules). Each anchor must be present exactly once; every mutant must be KILLED."""
import subprocess, sys
base = sys.argv[1]
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
]
for name, f, old, new in M:
    p = base + '/bots/' + f; src = open(p).read()
    assert src.count(old) == 1, 'ANCHOR ' + name
    open(p, 'w').write(src.replace(old, new))
    r = subprocess.run(['node', 'test/brain01.test.mjs'], cwd=base + '/bots', capture_output=True, text=True, timeout=120)
    open(p, 'w').write(src)
    fails = [l.strip() for l in r.stdout.splitlines() if l.strip().startswith('FAIL')]
    print('KILLED' if r.returncode else 'SURVIVED', '|', name, '|', fails[0][:100] if fails else (r.stderr.strip().splitlines() or [''])[-1][:100])
