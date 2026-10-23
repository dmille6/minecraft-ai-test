#!/usr/bin/env python3
"""Behaviour tests for valuescore.py's pure decisions, plus mutants (needs no ES and no network).

    python3 scripts/host/test_valuescore.py         (exit 1 on any failure)

The BLIND-INPUT MUTANT the owner asked for is case 'blind: renamed kind raises': the synthetic kind counts rename
'gather' to 'gathering', and check_inputs must raise ValueBlind rather than score a quiet 0. The source mutants at the
bottom each disable one decision; every one must turn at least one case red, and each anchor must be present exactly once
in the comment-stripped source (CLAUDE.md: a mutant that silently fails to apply reads as killed).
"""
import importlib.util, os, re, sys, tempfile

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'valuescore.py')
FULL = {'gather': 30000, 'mine': 8000, 'explore': 20000, 'goto': 20000, 'surface': 1000, 'home': 500, 'craft': 900}
DELTA = {'gather': 17000, 'mine': 5400, 'explore': 5000, 'goto': 4400, 'surface': 400, 'home': 190}   # 10-22-like shares


def load(text=None):
    path = SRC
    if text is not None:
        fd, path = tempfile.mkstemp(suffix='.py'); os.write(fd, text.encode()); os.close(fd)
    spec = importlib.util.spec_from_file_location('vs_%d' % abs(hash(path)), path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    if text is not None:
        os.unlink(path)
    return m


def raises(f, exc):
    try:
        f()
    except exc as e:
        return str(e) or True
    return False


def cases(v):
    out = []
    c = lambda name, ok, got=None: out.append((name, bool(ok), got))
    # weights: the table, the patterns, the zero list, products, and the unweighted (None) case
    for item, want in (('dirt', 0.0), ('sand', 0.0), ('andesite', 0.0), ('oak_log', 1.0), ('birch_log', 1.0),
                       ('mangrove_log', 1.0), ('cobblestone', 0.25), ('raw_iron', 8.0), ('raw_copper', 2.0),
                       ('diamond', 32.0), ('oak_sapling', 0.5), ('iron_pickaxe', 0.0), ('oak_planks', 0.0), ('stick', 0.0),
                       ('iron_ingot', 0.0), ('totally_new_item', None)):
        c(f'weight {item} = {want}', v.weight(item) == want, v.weight(item))
    # score: dirt is counted but weighs 0; a log is 1, raw iron 8; negatives and non-numbers are ignored
    res = v.score({'gather': [{'delta': {'dirt': 100, 'oak_log': 4, 'oak_planks': -4}, 'world': 'board-a'}],
                   'mine': [{'delta': {'raw_iron': 1, 'cobblestone': 8, 'weird': 'x'}, 'world': 'hive-b'}]})
    c('score: value = 4 logs + 1 raw iron x 8 + 8 cobble x 0.25 = 14', abs(res['value'] - 14) < 1e-9, res['value'])
    c('score: dirt counted as intake units', res['units'] == 113, res['units'])
    c('score: zero-weight units reported', res['zero_units'] == 100, res['zero_units'])
    c('score: by world', res['by_world'] == {'board-a': 4.0, 'hive-b': 10.0}, res['by_world'])
    c('score: by class', res['by_class'].get('iron') == 8.0 and res['by_class'].get('wood') == 4.0, res['by_class'])
    res2 = v.score({'gather': [{'delta': {'mystery_ore': 5, 'oak_log': 1}}]})
    c('score: an unknown item is UNWEIGHTED, not 0', res2['unweighted'] == {'mystery_ore': 5}, res2['unweighted'])
    # inputs: a full window passes
    c('inputs: a normal day passes', raises(lambda: v.check_inputs(FULL, DELTA, 24), v.ValueBlind) is False)
    # THE BLIND-INPUT MUTANT: a renamed row kind must fail loudly
    renamed = dict(FULL); renamed['gathering'] = renamed.pop('gather')
    got = raises(lambda: v.check_inputs(renamed, DELTA, 24), v.ValueBlind)
    c('blind: renamed kind raises', got and 'gather' in str(got), got)
    c('blind: the message names the similar kind', got and 'gathering' in str(got), got)
    thin = dict(FULL); thin['mine'] = 100
    c('blind: a vanished kind (100 docs/day) raises', raises(lambda: v.check_inputs(thin, DELTA, 24), v.ValueBlind))
    c('inputs: the floor scales with the window (100 mine docs in 1 h pass)',
      raises(lambda: v.check_inputs({k: n / 24 for k, n in FULL.items()} | {'mine': 100}, {k: n / 24 for k, n in DELTA.items()}, 1),
             v.ValueBlind) is False)
    nodelta = dict(DELTA); nodelta['gather'] = 0
    c('blind: inventory_delta renamed (gather rows carry none) raises', raises(lambda: v.check_inputs(FULL, nodelta, 24), v.ValueBlind))
    for k in ('explore', 'goto', 'surface', 'home'):
        nd = dict(DELTA); nd[k] = 0
        c(f'blind: {k} rows lose inventory_delta -> raises', raises(lambda: v.check_inputs(FULL, nd, 24), v.ValueBlind))
    # a renamed RAW item must surface as unweighted, never be zeroed by a suffix rule (Codex r1 P2-3)
    for item in ('raw_iron_block', 'iron_raw', 'coal_block'):
        c(f'weight {item} = None (unweighted)', v.weight(item) is None, v.weight(item))
    for item in ('white_wool', 'rail', 'lead', 'oak_fence', 'polished_andesite', 'stone_bricks'):
        c(f'weight {item} = 0 (listed junk/product)', v.weight(item) == 0.0, v.weight(item))
    # coverage: an empty hour or > 2 empty 10-minute bins is not a day to score
    c('coverage: a whole day with no gaps passes', raises(lambda: v.check_coverage({'empty_hours': [], 'empty_10min': []}), v.ValueBlind) is False)
    c('coverage: an empty hour raises', raises(lambda: v.check_coverage({'empty_hours': ['2026-10-22T03'], 'empty_10min': []}), v.ValueBlind))
    c('coverage: 3 empty 10-min bins raise',
      raises(lambda: v.check_coverage({'empty_hours': [], 'empty_10min': ['a', 'b', 'c']}), v.ValueBlind))
    c('coverage: 2 empty 10-min bins pass', raises(lambda: v.check_coverage({'empty_hours': [], 'empty_10min': ['a', 'b']}), v.ValueBlind) is False)
    # outputs
    c('output: zero rows raises', raises(lambda: v.check_output(v.score({})), v.ValueBlind))
    c('output: all-dirt day (value 0) raises', raises(lambda: v.check_output(v.score({'gather': [{'delta': {'dirt': 50}}]}), 1), v.ValueBlind))
    c('output: unweighted > 10 % raises (1 h window, below the per-item floor)',
      raises(lambda: v.check_output(v.score({'gather': [{'delta': {'widget': 5, 'oak_log': 10, 'gizmo': 4}}]}), 1), v.ValueBlind))
    # a REALISTIC day (10-22-like units): passes; then rename raw_iron / oak_log inside it -> must raise (Claude r1 P2-1)
    day = {'dirt': 39000, 'cobblestone': 24000, 'raw_iron': 500, 'oak_log': 1500, 'raw_copper': 550, 'coal': 260, 'andesite': 1500}
    mk = lambda d: v.score({'gather': [{'delta': d, 'world': 'w'}]})
    c('output: a realistic day passes', raises(lambda: v.check_output(mk(day), 24), v.ValueBlind) is False)
    ren = dict(day); ren['iron_raw'] = ren.pop('raw_iron')
    c('blind: raw_iron renamed inside a realistic day raises', raises(lambda: v.check_output(mk(ren), 24), v.ValueBlind))
    ren2 = dict(day); ren2['log_oak'] = ren2.pop('oak_log')
    c('blind: oak_log renamed inside a realistic day raises', raises(lambda: v.check_output(mk(ren2), 24), v.ValueBlind))
    noiron = dict(day); noiron.pop('raw_iron')
    c('sentinel: a day with no raw iron at all raises', raises(lambda: v.check_output(mk(noiron), 24), v.ValueBlind))
    c('sentinel: skipped for a 1 h window', raises(lambda: v.check_output(mk({'cobblestone': 900, 'oak_log': 10}), 1), v.ValueBlind) is False)
    newitem = dict(day); newitem['mystery_widget'] = 400        # a NEW (or renamed) item with every sentinel still present
    c('blind: one unweighted item above 50/day raises', raises(lambda: v.check_output(mk(newitem), 24), v.ValueBlind))
    gems = dict(day); gems['diamond'] = 8
    c('output: a realistic day with diamonds passes', raises(lambda: v.check_output(mk(gems), 24), v.ValueBlind) is False)
    ren3 = dict(gems); ren3['diamonds'] = ren3.pop('diamond')
    c('blind: a LOW-volume rename (diamond -> diamonds, 8) raises', raises(lambda: v.check_output(mk(ren3), 24), v.ValueBlind))
    ren4 = dict(day); ren4['raw_coper'] = ren4.pop('raw_copper')
    c('blind: a misspelt weighted name (raw_coper) raises', raises(lambda: v.check_output(mk(ren4), 24), v.ValueBlind))
    few = dict(day); few['magma_block'] = 3
    c('output: a few stray unweighted units pass', raises(lambda: v.check_output(mk(few), 24), v.ValueBlind) is False)
    stray = dict(day); stray['firefly_lantern'] = 3
    c('output: a stray unrelated unknown item passes (listed, not raised)', raises(lambda: v.check_output(mk(stray), 24), v.ValueBlind) is False)
    c('world: self-isolated-c-Bravo -> isolated-c', v.world_of('self-isolated-c-Bravo') == 'isolated-c')
    return out


def strip_comments(src):
    return '\n'.join(re.sub(r'\s+#.*$', '', l) for l in src.splitlines() if not l.lstrip().startswith('#'))


# Structural invariant (behaviour cannot reach it without ES): measure() must call both guards. Comments stripped first.
def wiring(src):
    body = strip_comments(src).split('def measure(', 1)[1].split('\ndef ', 1)[0]
    return [('wired: measure calls check_inputs', 'check_inputs(names, delta_docs, hours)' in body),
            ('wired: measure calls check_output', 'check_output(res, hours)' in body),
            ('wired: measure checks the ingest gap', 'MAX_INGEST_GAP_MIN * 60' in body),
            ('wired: measure calls check_coverage', 'check_coverage(cov)' in body),
            ('wired: measure streams every INTAKE kind', 'for k in INTAKE_KINDS:' in body)]


MUTANTS = [
    ("        if n < floor:", "        if n < 0:"),                                     # the vanished/renamed-kind guard
    ("        if n and delta_docs.get(k, 0) / n < share:", "        if False:"),
    ("    if cov.get('empty_hours'):", "    if False:"),
    ("    if len(cov.get('empty_10min') or []) > MAX_EMPTY_10MIN:", "    if False:"),
    ("    if item in ZERO or ZERO_PATTERNS.search(item) or PRODUCT.search(item):", "    if item in ZERO or PRODUCT.search(item):"),
    ("    check_coverage(cov)", "    pass"),
    ("    if res['value'] <= 0:", "    if res['value'] < 0:"),
    ("    if uw > MAX_UNWEIGHTED_SHARE * res['units']:", "    if False:"),
    ("    if big:\n", "    if False:\n"),
    ("    if alike:\n", "    if False:\n"),
    ("            if got < per_day * hours / 24:", "            if False:"),
    ("    'raw_iron': 8.0,", "    'raw_iron': 0.0,"),
    ("                if w is None:\n                    unweighted[item] += n\n                    continue",
     "                if w is None:\n                    w = 0.0"),
    ("|^bowl$|^paper$|^book$|^bricks?$|^stone_bricks$|^smooth_stone$|_bricks$)')", "|^bowl$|^paper$|^book$|_block$)')"),
    ("    check_inputs(names, delta_docs, hours)", "    pass"),
]


def main():
    src = open(SRC).read()
    v = load()
    res = cases(v) + [(n, ok, None) for n, ok in wiring(src)]
    bad = [r for r in res if not r[1]]
    for name, ok, got in res:
        print(('ok   ' if ok else 'FAIL ') + name + ('' if ok else f'   got {got!r}'))
    stripped = strip_comments(src)
    alive = []
    for old, new in MUTANTS:
        n = src.count(old)
        assert n == 1, f'MUTANT ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE"} ({n}): {old!r}'
        assert stripped.count(old.strip().splitlines()[0].strip()) >= 1, f'anchor only in a comment: {old!r}'
        mutated = src.replace(old, new, 1)
        try:
            m = load(mutated)
            mres = cases(m) + [(n_, ok, None) for n_, ok in wiring(mutated)]
            killed = any(not ok for _, ok, _ in mres)
        except Exception as e:                    # the mutant never ran: a broken harness, not a kill
            print(f'ERROR  {old.strip().splitlines()[0][:80]!r}: {type(e).__name__}: {e}')
            alive.append(old)
            continue
        print(('killed ' if killed else 'ALIVE  ') + repr(old.strip().splitlines()[0])[:90])
        if not killed:
            alive.append(old)
    print(f'\n{len(res) - len(bad)}/{len(res)} cases pass; {len(MUTANTS) - len(alive)}/{len(MUTANTS)} mutants killed')
    return 1 if bad or alive else 0


if __name__ == '__main__':
    sys.exit(main())
