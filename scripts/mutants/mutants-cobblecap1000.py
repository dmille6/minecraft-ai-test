#!/usr/bin/env python3
"""External anchored mutants for cobblecap-1000 (the town cobble cap is 1000, written once in stocktarget.mjs).

    python3 scripts/mutants/mutants-cobblecap1000.py <export-dir> [name filter]

The runner is mutants-stocktarget.py's (each anchor present EXACTLY ONCE, the unmutated file must pass first, KILLED only
if a named test file fails; the file is restored either way). Every mutant puts back a 256 the change removed, or breaks
the whole-stack rule the cap is judged with, or blinds a gate of the read.
"""
import importlib.util, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('mutants_stocktarget', os.path.join(HERE, 'mutants-stocktarget.py'))
MS = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(MS)

CR = ['cobble-rule']
ST = ['stocktarget']
WE = ['well']
TD = ['towndeposit']
PYC = ['py:scripts/host/cobblecapread.py']
PYS = ['py:scripts/host/stocktargetread.py']
MUTANTS = [
    ('the cap back to 256 in the one place', 'bots/src/stocktarget.mjs',
     'export const TOWN_COBBLE_CAP = 1000', 'export const TOWN_COBBLE_CAP = 256', CR),
    ('the cobble group target a literal 256 (the fold and the prune drift from the cap)', 'bots/src/stocktarget.mjs',
     "  cobble: bulk(['cobblestone', 'cobbled_deepslate'], TOWN_COBBLE_CAP),", "  cobble: bulk(['cobblestone', 'cobbled_deepslate'], 256),", CR + ST),
    ('cobbleAdmit defaults to a literal 256', 'bots/src/cobblecap.mjs',
     'export function cobbleAdmit (view, stack, cap = TOWN_COBBLE_CAP) {', 'export function cobbleAdmit (view, stack, cap = 256) {', CR),
    ('admitStacks defaults to a literal 256', 'bots/src/cobblecap.mjs',
     'export function admitStacks (view, stacks = [], cap = TOWN_COBBLE_CAP) {', 'export function admitStacks (view, stacks = [], cap = 256) {', CR),
    ('a whole stack may carry the town past the cap', 'bots/src/cobblecap.mjs',
     "  return base + (Number(stack) || 0) <= cap ? 'bank' : 'at_cap'", "  return base < cap ? 'bank' : 'at_cap'", CR),
    ('an admitted stack is not charged before the next', 'bots/src/cobblecap.mjs',
     "    if (d === 'bank') { bank.push(s); v.lb = (Number(v.lb) || 0) + s } else refused[d]++", "    if (d === 'bank') { bank.push(s) } else refused[d]++", CR),
    ('the licence row says a literal cap (r7)', 'bots/src/cobblecap.mjs',
     'export const cobbleCapModeDetail = (cap = TOWN_COBBLE_CAP) => `phase=mode cap=${cap}`', 'export const cobbleCapModeDetail = (cap = 256) => `phase=mode cap=${cap}`', CR),
    ('the licence row is never written (r7)', 'bots/src/index.mjs',
     "    try { logEvent({ kind: 'cobblecap_mode', status: 'success', snapshot: snapshot(bot), detail: cobbleCapModeDetail() }) } catch {}", "    try { void ({ kind: 'cobblecap_mode', status: 'success', snapshot: snapshot(bot), detail: cobbleCapModeDetail() }) } catch {}", CR),
    ('the refusal sentence names 256', 'bots/src/skills.mjs',
     'a whole stack would carry the town past its ${TOWN_COBBLE_CAP} cobble (town cobble cap)', 'a whole stack would carry the town past its 256 cobble (town cobble cap)', CR),
    ('the well\'s cobble switch at 256', 'bots/src/skills.mjs',
     "    return (Number(v?.avail) || 0) >= TOWN_COBBLE_CAP ? 'at_cap'", "    return (Number(v?.avail) || 0) >= 256 ? 'at_cap'", WE),
    ('the read: D1 never fires', 'scripts/host/cobblecapread.py',
     "    d1 = [(r['bot'], ta(f), str(r['t'])) for r, f in banks_c if moved(f) and ta(f) is not None and ta(f) > cap]",
     "    d1 = [(r['bot'], ta(f), str(r['t'])) for r, f in banks_c if moved(f) and ta(f) is not None and ta(f) > cap + 10 ** 9]", PYC),
    ('the read: D1 judged against the base cap', 'scripts/host/cobblecapread.py',
     "    d1 = [(r['bot'], ta(f), str(r['t'])) for r, f in banks_c if moved(f) and ta(f) is not None and ta(f) > cap]",
     "    d1 = [(r['bot'], ta(f), str(r['t'])) for r, f in banks_c if moved(f) and ta(f) is not None and ta(f) > base_cap]", PYC),
    ('the read: a refusal counts as liveness', 'scripts/host/cobblecapread.py',
     "    out['bank_above_base_cap'] = sum(1 for r, f in mine if moved(f) and ta(f) is not None and ta(f) > base_cap)",
     "    out['bank_above_base_cap'] = sum(1 for r, f in mine if ta(f) is not None and ta(f) > base_cap)", PYC),
    ('the read: the arms gate never fires', 'scripts/host/cobblecapread.py',
     "    out['rows_control_canary_cap'] = sum(1 for r in post_k if r['name'] == '_cobble_bank' and row_cap(kv(r['detail']), None) == cap)",
     "    out['rows_control_canary_cap'] = sum(1 for r in post_k if r['name'] == '_cobble_bank' and row_cap(kv(r['detail']), None) == -1)", PYC),
    ('the read: an old-build row (cap=256) counts as liveness (Codex cc1000-r1 P2)', 'scripts/host/cobblecapread.py',
     "    mine = [(r, f) for r, f in banks_c if row_cap(f, None) == cap]", "    mine = banks_c", PYC),
    ('the read: equal caps still ready', 'scripts/host/cobblecapread.py',
     " and out['instrument_control'] >= 1 and not out['caps_invalid'])", " and out['instrument_control'] >= 1)", PYC),
    ('towncap: an explicit missing module falls back (Codex cc1000-r1 P2)', 'scripts/host/towncap.py',
     "    if explicit is not None:\n        if not os.path.exists(explicit):", "    if explicit is not None and os.path.exists(explicit):\n        if False:", PYC),
    ('the read: a declared pool with no journal counts as covered (Codex cc1000-r2 P2)', 'scripts/host/cobblecapread.py',
     "        if not any(JOURNAL_FILE.search(n) for n in names):", "        if False:", PYC),
    ('the read: a rotated journal is not recognised (Codex r3 P2)', 'scripts/host/cobblecapread.py',
     "JOURNAL_FILE = re.compile(r'\\.cobble\\.(g\\d+\\.)?jsonl$')", "JOURNAL_FILE = re.compile(r'\\.cobble\\.jsonl$')", PYC),
    ('the read: a canary row of another build is kept (Claude cc1000-r1 P3)', 'scripts/host/cobblecapread.py',
     "                    if arm == 'canary' and per == 'post' and cv and ver and not ver.startswith(cv):", "                    if False:", PYC),
    ('the read: the bank-closed tripwire counts nothing', 'scripts/host/cobblecapread.py',
     "            out['bank_closed_%s_%s' % (per, arm)] = sum(1 for r in rs if (r['name'] == '_cobble_bank' and num(kv(r['detail']), 'no_room') > 0)",
     "            out['bank_closed_%s_%s' % (per, arm)] = 0 * sum(1 for r in rs if (r['name'] == '_cobble_bank' and num(kv(r['detail']), 'no_room') > 0)", PYC),
    ('the read: a two-name refusal is not the instrument (Claude cc1000-r2 P3-a)', 'scripts/host/cobblecapread.py',
     "r['name'] == '_stock_refused' and num(kv(r['detail']), 'at_cobble') > 0)", "r['name'] == '_stock_refused' and num(kv(r['detail']), 'at_cobble') == 1)", PYC),
    ('the read: the journal gate never fires', 'scripts/host/cobblecapread.py',
     "    return {'breach_c5_journal': sum(1 for g in j.get('g3', []) if g.get('g') == 'cobble'),",
     "    return {'breach_c5_journal': 0,", PYC),
    ('towncap: the row\'s own cap= is ignored', 'scripts/host/towncap.py',
     '    return int(v) if v.isdigit() else default', '    return default', PYC),
    ('stocktargetread: the cobble target a literal 256 again', 'scripts/host/stocktargetread.py',
     "    TARGETS['cobble'] = town_cobble_cap(", "    TARGETS['cobble'] = 256 or town_cobble_cap(", PYS),
]


def main():
    MS.MUTANTS[:] = MUTANTS
    root = sys.argv[1]
    only = sys.argv[2] if len(sys.argv) > 2 else None
    killed = survived = 0
    baseline = {}
    for name, rel, old, new, files in MUTANTS:
        if only and only not in name:
            continue
        path = os.path.join(root, rel)
        src = open(path).read()
        n = src.count(old)
        assert n == 1, f'ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE (%d)" % n}: {name}'
        for f in files:
            if f not in baseline:
                baseline[f] = not MS.run(root, [f])
            assert baseline[f], f'baseline already fails {f}: the mutant cannot be judged'
        try:
            open(path, 'w').write(src.replace(old, new, 1))
            bad = MS.run(root, files)
        finally:
            open(path, 'w').write(src)
        if bad:
            killed += 1; print(f'KILLED    {name}  ({", ".join(bad)})', flush=True)
        else:
            survived += 1; print(f'SURVIVED  {name}', flush=True)
    print(f'cobblecap-1000: {killed} killed, {survived} survived')
    sys.exit(1 if survived else 0)


if __name__ == '__main__':
    main()
