#!/usr/bin/env python3
# analyst.py -- TIER 1 (shadow mode): a LOCAL model reads the latest tier-0 digest against the registered rule and
# fills a fixed schema. It never decides; it flags. Writes <digest>.verdict.json beside the digest. No paging yet.
import json, sys, os, glob, urllib.request, datetime as dt
D = os.path.expanduser('~/digest'); EP = os.environ.get('ANALYST_EP', 'http://ai.ticrcorp.com:11438'); MODEL = os.environ.get('ANALYST_MODEL', 'qwen2.5:72b')
import re
digest = sorted(f for f in glob.glob(D + '/*.md') if re.search(r'/\d{8}T\d{4}\.md$', f))[-1]   # only timestamped digests
_rp = os.path.expanduser('~/digest/RULE.md'); _rt = open(_rp).read() if os.path.exists(_rp) else '(no rule file)'
# the CURRENT rule: everything from the v14c amendment on (the rules in force) plus the registration blocks that mention the live
# canary's run_id; the 49 KB history overflowed the context and the analyst judged a rule frozen on 09-13 (2026-09-16)
_i = _rt.find('## v14c'); rule = _rt[_i:] if _i >= 0 else _rt[-16000:]
rule = rule[-20000:]
# THE WINDOW SHRANK AS THE DOCUMENT GREW, AND NOBODY WOULD HAVE SEEN IT.
# `rule[-20000:]` is a blind character tail of a registration doc that is now
# 93 KB. Measured 2026-09-19 right after syncing v23 to the host: the slice
# reached back only as far as v21, so v12, v14c, v15c, v16, v17, v18, v19 and
# v20 -- every one of them still in force -- were no longer in the analyst's
# prompt at all. The window was deliberately shrunk on 2026-09-16 because the
# full 49 KB overflowed the context and the analyst judged against a rule
# frozen on 09-13, so widening it back is not the fix.
#
# The fix is that the tail is a CONVENIENCE and the summary is AUTHORITATIVE.
# ~/digest/RULES-IN-FORCE.md is one paragraph, kept beside RULE.md and synced
# with it, naming every rule in force and -- the part a tail can never express
# -- which registered rules are WITHDRAWN. v22 is in the document and is not in
# force; without this the analyst reads it as current.
_fp = os.path.expanduser('~/digest/RULES-IN-FORCE.md')
if os.path.exists(_fp):
    rule = (open(_fp).read().strip()
            + "\n\n(The paragraph above is AUTHORITATIVE and lists every rule in force, including "
              "any that are registered but WITHDRAWN. What follows is the tail of the registration "
              "document: recent rules in full, older ones cut off by length. A rule missing below is "
              "NOT thereby out of force.)\n\n" + rule)
else:
    rule = ("(NO ~/digest/RULES-IN-FORCE.md ON THIS HOST -- the authoritative list of rules in force is "
            "MISSING, and what follows is only the tail of the registration document. Rules older than "
            "the cut are absent and any WITHDRAWN rule below still looks current. Say so in `reason` "
            "rather than judging a verdict against a rule set you cannot see.)\n\n" + rule)
text = open(digest).read()[:14000]
import subprocess
# THE ANALYST WAS READING TWO DEAD RUNS. This globbed `*.out` while
# canary-loop.sh writes `$RUN-$s-$M.txt` (and .json), so the extensions never
# matched: measured 2026-09-18, the directory held 6 `.out` files, ALL from
# 16 Sep for recovery0809 and recovery1011, against 75 `.txt` including the live
# run's. Every analyst verdict since the loop switched extensions carried
# two-day-old reads from finished trials under the heading "latest canary reads",
# beside a digest header naming the current run. It produced two confident false
# alarms on 2026-09-18 alone, including "the +30 read is missing" for a read that
# had been taken 20 minutes earlier.
#
# SCOPED TO THE LIVE RUN, and SILENT RATHER THAN SUBSTITUTED. Showing another
# run's reads is worse than showing none, so when this run has no reads yet the
# analyst is told exactly that instead of being handed a neighbour's.
#
# ...AND THE SAME DEFECT CAME BACK THROUGH THE MANIFEST. The three-step teardown
# clears canary_pool and canary_code_version but NOT run_id, so after a canary
# closes, run_id still names the dead run and this glob happily serves ITS reads
# under the heading "latest canary reads" beside a header saying the slot is
# free. run_id alone does not mean a canary is live; canary_pool does. Scope the
# reads to a LIVE canary, and when there is none, say so and show nothing.
try:
    _man = json.load(open('/srv/mcbots/trial-manifest.json')) or {}
except Exception:
    _man = {}
_run = _man.get('run_id') or ''
_live = bool((_man.get('canary_pool') or '').strip())
_reads = []
if _live and _run:
    _reads = sorted(glob.glob(os.path.expanduser('~/digest/reads/%s-*.txt' % _run)), key=os.path.getmtime)[-4:]
if not _live:
    text += ('\n\n## latest canary reads\n(no live canary — canary_pool is empty. Any reads on disk belong to '
             'a CLOSED run and are not evidence about now. No verdict is due and nothing is stalled.)')
elif not _reads:
    text += ('\n\n## latest canary reads\n(none yet for run %r — this is not evidence '
             'about the fleet, only that no read has been written)' % (_run or 'unknown'))
_lines = []
for _f in _reads:
    for _l in open(_f, errors='replace'):
        if any(k in _l for k in ('READ', 'GUARDS (v15c)', 'HARM', 'INSTRUMENT', 'EXPOSURE', 'OWN LINE', 'READABILITY', 'DiD', 'FRICTION', 'CANARY DEATH')): _lines.append(os.path.basename(_f) + ': ' + _l.rstrip()[:300])
if _lines: text += '\n\n## latest canary reads (the read scripts, verbatim key lines)\n' + '\n'.join(_lines[-60:])
schema = {"type": "object", "properties": {
  "fleet_healthy": {"type": "boolean"}, "versions_ok": {"type": "boolean"},
  "canary": {"type": "object", "properties": {
     "declared": {"type": "boolean"}, "elapsed_min": {"type": "integer"}, "exposure_ok": {"type": "boolean"},
     "gates_tripped": {"type": "array", "items": {"type": "string"}}, "readable": {"type": "boolean"},
     "verdict_under_rule": {"type": "string", "enum": ["KEEP", "REVERT", "INCONCLUSIVE", "HOLD", "NOT_YET"]},
     "why": {"type": "string"}}, "required": ["declared", "exposure_ok", "gates_tripped", "readable", "verdict_under_rule", "why"]},
  "anomalies": {"type": "array", "items": {"type": "object", "properties": {"claim": {"type": "string"}, "evidence": {"type": "string"}, "positive_control": {"type": "string"}}, "required": ["claim", "evidence", "positive_control"]}},
  "page_claude": {"type": "boolean"}, "reason": {"type": "string"}},
  "required": ["fleet_healthy", "versions_ok", "canary", "anomalies", "page_claude", "reason"]}
system = ("You are the night-shift analyst for an 80-bot Minecraft fleet run as canary experiments. You read ONE digest and the "
  "REGISTERED RULE and fill the schema. Rules you must obey: (1) a verdict can only be what the rule text permits at this elapsed "
  "time -- before the verdict read say NOT_YET or HOLD; (2) a death gate needs TWO canary deaths AND > 1.25x the control rate; one "
  "death is reported, never a trip; (3) never conclude 'nothing happened' from a zero without naming the positive control that shows "
  "the instrument sees something; (4) every anomaly needs the evidence line from the digest; (5) page_claude is true ONLY for: a "
  "gate tripped, a verdict read due now, more than one version live without a code canary, a canary with zero exposure after 30 min, "
  "or a stall. You decide nothing; you flag.")
user = f"=== REGISTERED RULE ===\n{rule}\n\n=== DIGEST ===\n{text}\n\nFill the schema."
body = json.dumps({"model": MODEL, "stream": False, "format": schema, "think": False,   # qwen3: thinking would eat num_predict and leave content empty "options": {"temperature": 0, "num_ctx": 24576, "num_predict": 700},
                   "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}).encode()
t0 = dt.datetime.now()
req = urllib.request.Request(EP + '/api/chat', data=body, headers={'Content-Type': 'application/json'})
res = json.load(urllib.request.urlopen(req, timeout=600))
content = (res.get('message') or {}).get('content') or ''
if not content.strip():
    print('EMPTY CONTENT; raw message:', json.dumps(res.get('message'))[:600], 'done_reason', res.get('done_reason')); sys.exit(2)
out = {"digest": os.path.basename(digest), "model": MODEL, "ms": int((dt.datetime.now() - t0).total_seconds() * 1000),
       "prompt_tokens": res.get('prompt_eval_count'), "verdict": json.loads(content)}
open(digest.replace('.md', '.verdict.json'), 'w').write(json.dumps(out, indent=2))
print(json.dumps(out, indent=2))
