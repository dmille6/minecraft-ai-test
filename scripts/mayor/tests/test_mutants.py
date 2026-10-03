"""Mutants, run against the WHOLE SUITE. Each mutant edits one decision in a temp copy of
scripts/mayor (never the source tree), runs every test there in a subprocess, and must turn the
suite red. A mutant whose anchor is missing or not unique raises instead of silently "killing"
nothing (CLAUDE.md: mutants assert their anchor).

    python3 scripts/mayor/tests/test_mutants.py --report     # every mutant and the tests it broke
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
IN_MUTANT = os.environ.get('MAYOR_IN_MUTANT') == '1'

C, SH, SC, FR, IO = 'mayor_core.py', 'mayor_shadow.py', 'mayor_score.py', 'mayor_frontier.py', 'mayor_io.py'
WOOD_PER_BOT = """    for b in live:
        if short_of_wood(b):
            _, need, held = pick_ingredients(b)
            out.append({'duty': 'GET_WOOD', 'scope': 'bot', 'bot': b['id'], 'value': held, 'threshold': need,
                        'why': 'pickaxe %s; holds %d planks-eq of its own, a %s pickaxe needs %d%s (wood is not '
                               'shared between bots; banked wood not retrievable)' % (
                                   b['pick_state'], held, 'stone' if b['cobble'] >= 3 else 'wooden', need,
                                   '' if b['has_table'] else ' incl. a table')})
"""
WOOD_WORLD_111DADC = """    no_pick = sum(1 for b in live if b['pick_state'] in ('none', 'low'))
    wood, need = round(sum(b['log_eq'] for b in live), 2), 2 * no_pick + 1
    if live and wood < need:
        out.append({'duty': 'GET_WOOD', 'scope': 'world', 'bot': None, 'value': wood, 'threshold': need,
                    'why': 'held wood %.2f log-eq < 2 x %d bots without a pickaxe + 1 (banked wood UNKNOWN)' % (wood, no_pick)})
"""
MUTANTS = [
    # eligibility
    ('trapped bots eligible', C, "    if bot.get('trapped'):\n", "    if False:\n"),
    ('stale bots eligible', C, "    if not bot.get('fresh'):\n", "    if False:\n"),
    ('log height ignored', C, " and abs(r['y'] - pos['y']) <= cfg['log_v']]", "]"),
    ('log age ignored', C, "LOG_RE.search(r['kind']) and r['age_h'] <= cfg['log_age_h']", "LOG_RE.search(r['kind'])"),
    ('GET_WOOD room ignored', C, "if bot['free_slots_est'] < cfg['wood_min_free']:", "if False:"),
    ('deposit without bank proof', C, "if dep_free > 0 and bank.get('accepts_recently'):", "if dep_free > 0:"),
    ('iron without a trip pick', C, "if bot['stone_pick_uses'] < cfg['iron_trip_uses']:", "if False:"),
    ('no table needed', C, "need_table = 0 if bot['has_table'] else 4", "need_table = 0"),
    # GET_WOOD is per bot (2026-10-03): the wood must be in the short bot's own bag
    # the WHOLE per-bot block back to the 111dadc world rule (a partial swap would crash on `held`, not test it)
    ('GET_WOOD pooled at world scope again', C, WOOD_PER_BOT, WOOD_WORLD_111DADC),
    ('shared wood threshold off by one', C, "need = need_sticks + need_table + (0 if stone else 3)",
     "need = need_sticks + need_table + (0 if stone else 2)"),
    ('GET_WOOD shortage off the shared function', C,
     "return bot['pick_state'] in NO_PICK and pick_ingredients(bot)[0] is None",
     "return bot['pick_state'] in NO_PICK and bot['log_eq'] < 2"),
    ('GET_WOOD done when the world has wood', C,
     "return bot['logs'] >= start.get('start_logs', 0) + 1 or not short_of_wood(bot)",
     "return bot['logs'] >= start.get('start_logs', 0) + 1 or 'GET_WOOD' not in world_needs"),
    ('scorer: GET_WOOD persistence read at world scope', C, "BOT_SCOPE = ('FREE_BAG', 'RESTORE_PICK', 'GET_WOOD')",
     "BOT_SCOPE = ('FREE_BAG', 'RESTORE_PICK')"),
    # freshness, lookahead, certainty
    ('fresh from any row', C, "'fresh': st.full is not None and pos_age is not None and -MAX_SKEW_MS / 1000 <= pos_age <= cfg['stale_s'],",
     "'fresh': st.full is not None and age is not None and age <= cfg['stale_s'],"),
    ('future rows accepted', C, "    if now_ms is not None and t > now_ms + MAX_SKEW_MS:", "    if False:"),
    ('facts lookahead', C, "if not r.get('last') or r['last'] > now_ms:", "if not r.get('last'):"),
    ('iron shortage definite', C, "or item in (cfg.get('bank_unknown_conservative') or ())", "or False"),
    ('withdraw switch ignored', C, "(cfg.get('withdraw_verified') or {}).get(item) or ", ""),
    ('state row without inventory', C, "and isinstance(b.get('inventory'), dict) and (st.full_ms", "and (st.full_ms"),
    ('state row with any pos', C, "if _valid_pos(b.get('pos')) and", "if 'pos' in b and"),
    # deterministic mayor
    ('world cap removed', C, "        elif len(taken_bots) >= cfg['cap_per_world']:\n            why = 'cap_world'", "        elif False:\n            why = 'cap_world'"),
    ('per-duty cap removed', C, "        elif per_duty.get(c['duty'], 0) >= cfg['cap_per_duty']:\n            why = 'cap_duty'\n        elif c['targets']:",
     "        elif c['targets']:"),
    ('cooldown ignored', C, "        elif '%s|%s' % (c['bot_name'], c['duty']) in cool:\n", "        elif False:\n"),
    ('no hysteresis', C, "    for name in sorted(leases, key=lambda n: (leases[n].get('since_ms', 0), n)):", "    for name in []:"),
    ('lease never expires', C, "        if now - L['since_ms'] >= cfg['lease_s'] * 1000:\n            release(name, L, 'expired')",
     "        if False:\n            release(name, L, 'expired')"),
    ('duty_done always False', C, "    if duty == 'FREE_BAG':\n        return bot['slots_est'] < cfg['full_slots']",
     "    return False\n    if duty == 'FREE_BAG':\n        return bot['slots_est'] < cfg['full_slots']"),
    ('distance ranking reversed', C, "(DUTY_RANK[c['duty']], c['dist'] if c['dist'] is not None else 0.0,",
     "(DUTY_RANK[c['duty']], -c['dist'] if c['dist'] is not None else 0.0,"),
    ('lease keeps its R-id, not its place', C, "tgt = id_of_key.get(L.get('target_key'))", "tgt = L.get('target')"),
    ('held leases may share a target', C, "            if tgt in taken_targets:\n                release(name, L, 'conflict')",
     "            if False:\n                release(name, L, 'conflict')"),
    ('held leases ignore caps', C, "        if len(taken_bots) >= cfg['cap_per_world'] or per_duty.get(c['duty'], 0) >= cfg['cap_per_duty']:\n            release(name, L, 'over_cap')",
     "        if False:\n            release(name, L, 'over_cap')"),
    # validator
    ('validator: unknown candidate accepted', C, "        if c is None:\n            why = 'unknown_candidate'", "        if c is None:\n            continue"),
    ('validator: invented target accepted', C, "        elif tgt is not None and tgt not in c['targets']:", "        elif False:"),
    ('validator: duplicate target accepted', C, "        elif tgt is not None and tgt in targets_used:", "        elif False:"),
    ('validator: unknown evidence accepted', C, "        elif cited - known:", "        elif False:"),
    ('validator: caps ignored', C, "        elif per_duty.get(c['duty'], 0) >= cfg['cap_per_duty']:\n            why = 'cap_duty'\n        elif len(bots_used)",
     "        elif False:\n            why = 'cap_duty'\n        elif len(bots_used)"),
    ('validator: world cap ignored', C, "        elif len(bots_used) >= cfg['cap_per_world']:\n            why = 'cap_world'", "        elif False:\n            why = 'cap_world'"),
    ('validator: item schema skipped', C, "        bad = schema_errors(a, item_schema, '$.assignments[]')", "        bad = []"),
    ('validator: extra keys allowed', C, "        if sch.get('additionalProperties') is False:", "        if False:"),
    # shadow process
    ('tail: no first-bytes fingerprint', SH, "                if not rotated and self.head:", "                if False:"),
    ('replay by start, not availability', SH, "    return t + (int(d.group(1)) if d else 0)", "    return t"),
    ('replay snapshots unmarked', SH, "        if replay:\n            snap['replay'] = True", "        if False:\n            snap['replay'] = True"),
    ('vanished files never evicted', SH, "            if tail.missing_ms is not None and wall - tail.missing_ms > a.evict_file_min * 60000:", "            if False:"),
    ('output cap off', SH, "        if used > cap:", "        if False:"),
    ('out dir: bot trees allowed', IO, "            if _under(real, b):", "            if False:"),
    ('out dir: symlinks followed', IO, "_FLAGS_APPEND = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0)",
     "_FLAGS_APPEND = os.O_WRONLY | os.O_APPEND | os.O_CREAT"),
    # scorer
    ('scorer: silence counted as failure', SC, "            if not observed(seq, t, t + 30 * MIN, gap):", "            if False:"),
    ('scorer: silence excluded only when not done', SC, "            if not observed(seq, t, t + 30 * MIN, gap):",
     "            if not done30 and not observed(seq, t, t + 30 * MIN, gap):"),
    ('scorer: stale at +5 counted inexecutable', SC,
     "            if nb is not None and nb['fresh']:   # missing or stale at +5 is UNKNOWN, not inexecutable\n                m['exec_n'] += 1\n                m['exec'] += core.evaluate(duty, nb, nxt, cfg)[0]",
     "            if nxt is not None:\n                m['exec_n'] += 1\n                m['exec'] += bool(nb) and core.evaluate(duty, nb, nxt, cfg)[0]"),
    ('scorer: base rate counts silence', SC, "if need_holds(d, b['name'], s) and observed(seq, s['t_ms'], s['t_ms'] + 30 * MIN, cfg['stale_s'] * 1000):",
     "if need_holds(d, b['name'], s):"),
    ('scorer: --json follows symlinks', SC, "        mayor_io.write_atomic(os.path.join(jdir, os.path.basename(args.json)), ",
     "        open(os.path.join(jdir, os.path.basename(args.json)), 'w').write("),
    ('scorer: eligibility through not required', SC, "            if not through:", "            if False:"),
    ('scorer: unknown-bank in the gap', SC, "            if sh.get('certainty', 'definite') != 'definite':", "            if False:"),
    ('scorer: rejections not in exec denominator', SC, "            m['rejected'] += 1\n            m['exec_n'] += 1", "            m['rejected'] += 1"),
    ('scorer: replay not refused', SC, "    if args.replay_only and not n_replay or not args.replay_only and not n_live:", "    if False:"),
    ('scorer: ratio not against random', SC, "            m['x_random'] = (dc / rr) if dc is not None and rr else None", "            m['x_random'] = dc"),
    # frontier
    ('frontier: timeouts not charged', FR, "                    cost += ledger.charge(worst)", "                    pass"),
    ('frontier: truncated line raises', FR, "                except ValueError:\n                    counts['skipped_lines'] += 1\n                    continue",
     "                except ValueError:\n                    raise"),
    ('frontier: replay mixed with live', FR, "if rep == replay_only and", "if True and"),
    ('frontier: non-JSON 200 raises', FR, "    try:\n        out = json.loads(raw.decode('utf-8', 'replace'))\n    except ValueError:\n        out = None",
     "    out = json.loads(raw.decode('utf-8', 'replace'))"),
    ('frontier: non-JSON 200 not charged', FR, "if e.status is None or e.status == 200:", "if e.status is None:"),
    ('frontier: fields consumed unnormalised', FR,
     "unmet = [u for u in p.get('unmet_needs') if isinstance(u, dict)] if isinstance(p.get('unmet_needs'), list) else []",
     "unmet = p.get('unmet_needs') or []"),
    ('frontier: no request overhead in the estimate', FR, "(request_bytes / 2.0 + OVERHEAD_TOKENS)", "(request_bytes / 2.0)"),
    ('shadow: absent worlds kept', SH, "            if w not in snaps and now - self.world_seen[w] > a.evict_world_h * 3.6e6:", "            if False:"),
    ('shadow: bots evicted on the wall clock under --now-from-data', SH,
     "if st.last_ms is not None and now - st.last_ms > a.evict_bot_h * 3.6e6]:",
     "if st.last_ms is not None and wall - st.last_ms > a.evict_bot_h * 3.6e6]:"),
    ('replay: no output cap', SH, "            if used > args.max_out_mb << 20:", "            if False:"),
    ('scorer: replay filter only for deterministic', SC, "            if bool(rec.get('replay')) != args.replay_only:\n",
     "            if rec.get('engine') == 'deterministic' and bool(rec.get('replay')) != args.replay_only:\n"),
    ('frontier: null content element consumed', FR, "        if not isinstance(b, dict):\n            raise _bad('content element')",
     "        if False:\n            raise _bad('content element')"),
    ('frontier: anthropic text type unchecked', FR, "            if not isinstance(b.get('text'), str):\n                raise _bad('text')",
     "            if False:\n                raise _bad('text')"),
    ('frontier: openai output element unchecked', FR, "        if not isinstance(o, dict):\n            raise _bad('output element')",
     "        if False:\n            raise _bad('output element')"),
    ('frontier: openai content element unchecked', FR, "            if not isinstance(c, dict):\n                raise _bad('content element')",
     "            if False:\n                raise _bad('content element')"),
    ('frontier: non-numeric usage treated as numbers', FR,
     "return vals if all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in vals) else None",
     "return [v if isinstance(v, int) else 0 for v in vals]"),
    ('frontier: error body persisted', FR, "        raise ProviderError(e.code, _error_code(raw)) from None",
     "        raise ProviderError(e.code, raw.decode()) from None"),
    # 10-03 fourth pass: the clock, revisions, GET_WOOD scorer biases
    ('shadow: data clock in live mode', SH, "        if a.now_from_data:\n            now = max(", "        if True:\n            now = max("),
    ('revision not content-derived', C, "    return h.hexdigest()[:12]\n", "    return 'fixed0000000'\n"),
    ('snapshot unstamped', C, "        'mayor_rev': MAYOR_REV,\n", ""),
    ('assignment record unstamped', C, "'engine': 'deterministic', 'mayor_rev': MAYOR_REV, ", "'engine': 'deterministic', "),
    ('frontier record unstamped', FR, "                               mayor_rev=snap.get('mayor_rev'),", "                               mayor_rev=None,"),
    ('scorer: revisions pooled', SC, "    return snap.get('mayor_rev') or 'unstamped'", "    return 'pooled'"),
    ('scorer: legacy world-scope wood read as true for every bot', SC,
     "        if any(s['scope'] != 'bot' for s in mine):\n            return None",
     "        if any(s['scope'] == 'world' for s in mine):\n            return True"),
    ('scorer: --since ignored', SC, "(since is None or t >= since)", "True"),
    ('scorer: --until ignored', SC, "(until is None or t <= until)", "True"),
    ('scorer: x random on uncontested snapshots', SC, "            if not warm and contested(s, duty, cfg):\n", "            if not warm:\n"),
    ('scorer: base rate not restricted to eligible', SC, "                    if core.evaluate(d, b, s, cfg)[0]:\n", "                    if True:\n"),
    ('scorer: shortage relief not an outcome', SC,
     "        return gained(LOGS, base['logs'], seq) >= 1 or any(r[WOOD_SHORT] is False for r in seq)",
     "        return gained(LOGS, base['logs'], seq) >= 1"),
    ('scorer: baselines forget their leases', SC, "        rec, state = core.decide(s, state, cfg, order=order)",
     "        rec, state = core.decide(s, None, cfg, order=order)"),
    ('scorer: deterministic matched to the stateless baseline', SC,
     "    return 'random' if eng.split(':')[0] in STATEFUL else 'random-stateless'", "    return 'random-stateless'"),
    # 10-03 round 2 (offline scorer only; MAYOR_REV unchanged)
    ('scorer: epochs not contiguous (a rollback bridges B)', SC,
     "        if out and out[-1][0] == s['_key']:\n            out[-1][1].append(s)\n",
     "        hit = [run for k, run in out if k == s['_key']]\n        if hit:\n            hit[0].append(s)\n"),
    ('scorer: proposal windows cross epochs', SC,
     "    gap = cfg['stale_s'] * 1000\n    horizon = tel_end if epoch_end is None else min(tel_end, epoch_end)\n",
     "    gap = cfg['stale_s'] * 1000\n    horizon = tel_end\n"),
    ('scorer: base-rate windows cross epochs', SC,
     'left out."""\n    horizon = tel_end if epoch_end is None else min(tel_end, epoch_end)\n',
     'left out."""\n    horizon = tel_end\n'),
    ('scorer: baselines restart at --since', SC, "leased[name], r['state'] = leased_run(ep, cfg_e, order_of, r['state'], r['start'])",
     "leased[name], r['state'] = leased_run([s for s in ep if scored(s)], cfg_e, order_of, r['state'], r['start'])"),
    ('scorer: no warm-up exclusion', SC, "            warm_until = carry['random']['warm']", "            warm_until = None"),
    ('scorer: partition ignores cfg', SC, "return '%s/%s' % (rev_of(snap), cfg_tag(snap))", "return '%s/%s' % (rev_of(snap), 'cfg')"),
    ("scorer: scored with today's defaults", SC, "cfg_e = ep[0]['_cfg']", "cfg_e = dict(core.DEFAULTS)"),
    ('scorer: x base on target-conditioned downstream', SC,
     "cr = m['concord'] / m['concord_n'] if m and m['concord_n'] else None",
     "cr = m['downstream'] / m['downstream_n'] if m and m['downstream_n'] else None"),
    ('contested: duty cap ignored', SC, "    if len(mine) > cfg['cap_per_duty']:\n        return True\n", ""),
    ('contested: world cap ignored', SC, "    if len({c['bot'] for c in feas}) > cfg['cap_per_world']:\n        return True\n", ""),
    ('contested: bot competition ignored', SC, "    if any(per_bot[c['bot']] > 1 for c in mine):\n        return True\n", ""),
    ('contested: target competition ignored', SC, "        if seen.intersection(c['targets']):\n            return True\n", ""),
    # 10-03 round 3 (offline scorer only; MAYOR_REV unchanged)
    ('gate reads x random', SC, "                dx = x_base(R['band'][o].get('deterministic', {}).get(d), R['base_elig'][d])",
     "                dx = (R['res'].get('deterministic', {}).get(d) or {}).get('x_random')"),
    ('gate against the stateless random', SC, "                rx = x_base(R['band'][o].get('random', {}).get(d), R['base_elig'][d])",
     "                rx = (R['res'].get('random-stateless', {}).get(d) or {}).get('x_base_elig')"),
    ('baseline state never carried', SC, "            carried = compat == prev_compat       # identical decide() semantics across the transition",
     "            carried = False"),
    ('baseline state carried across any transition', SC,
     "            carried = compat == prev_compat       # identical decide() semantics across the transition",
     "            carried = prev_compat is not None"),
    ('DECIDE_CFG misses lease_s', SC, "DECIDE_CFG = ('cap_per_world', 'cap_per_duty', 'lease_s', 'cooldown_s', 'full_slots')",
     "DECIDE_CFG = ('cap_per_world', 'cap_per_duty', 'cooldown_s', 'full_slots')"),
    ('band: one offset only', SC, "BAND_OFFSETS_MIN = (0, 5, 10, 15, 20, 25)", "BAND_OFFSETS_MIN = (0,)"),
    ('band: variants not offset', SC, "                r = run_of('random@%d' % o, ep0 + o * MIN)",
     "                r = run_of('random@%d' % o, ep0)"),
    ('band: never initialization-dependent', SC, "    return 'initialization-dependent' if lo < threshold <= hi else",
     "    return 'initialization-dependent' if False else"),
    ('label: contd again', SC, "'downstr', 'stcon', 'xrand',", "'downstr', 'contd', 'xrand',"),
    ('controls: detector with the default cfg', SC, "detector_events(tel, cfg_e, a, min(b + 30 * MIN, horizon))",
     "detector_events(tel, core.DEFAULTS, a, min(b + 30 * MIN, horizon))"),
    ('controls: detector over all telemetry', SC, "detector_events(tel, cfg_e, a, min(b + 30 * MIN, horizon))",
     "detector_events(tel, cfg_e)"),
    ('controls: coverage with the default stale_s', SC, "coverage_hits(tel.get(bn, []), times, cfg_e['stale_s'] * 1000)",
     "coverage_hits(tel.get(bn, []), times, core.DEFAULTS['stale_s'] * 1000)"),
    ('controls: zero judged fleet-wide', SC, "if d in R['det'] and m['concord_n'] and m['concord'] == 0 and R['det'][d] == 0:",
     "if d in R['det'] and m['concord_n'] and m['concord'] == 0 and sum(Q['det'][d] for Q in revs.values()) == 0:"),
    # 10-03 round 4 (offline scorer only; MAYOR_REV unchanged)
    ('carried band run loses its absolute start', SC,
     "                band_props[o], r['state'] = leased_run(ep, cfg_e, random_order, r['state'], r['start'])",
     "                band_props[o], r['state'] = leased_run(ep, cfg_e, random_order, r['state'], None if carried else r['start'])"),
    ('carried band run loses its warm-up deadline', SC, "                band_warm[o] = r['warm']",
     "                band_warm[o] = None if carried else r['warm']"),
    ('band PASSES with undefined offsets', SC, "    if not got or len(got) < len(values):", "    if not got:"),
    ('gate duties back to wood and iron', SC, "GATE_DUTIES = core.DUTIES", "GATE_DUTIES = ('GET_WOOD', 'GET_IRON')"),
    ('gate period not matched (mayor keeps its warm-up proposals)', SC,
     "                            warm_until=band_warm[o], warm_all=True)",
     "                            warm_until=band_warm[o], warm_all=False)"),
    # harness (10-03 Codex review): mutants run only after the unmutated suite is proven green
    ('mutants: no green-baseline gate', 'tests/test_mutants.py', "    require_green(pkg)\n    out = []\n", "    out = []\n"),
]


def apply(root, fname, old, new):
    path = os.path.join(root, fname)
    with open(path) as f:
        src = f.read()
    assert old in src, 'ANCHOR MISSING in %s: %r' % (fname, old)
    assert src.count(old) == 1, 'ANCHOR NOT UNIQUE in %s (%d): %r' % (fname, src.count(old), old)
    with open(path, 'w') as f:
        f.write(src.replace(old, new, 1))


def run_suite(root):
    env = dict(os.environ, MAYOR_IN_MUTANT='1', PYTHONDONTWRITEBYTECODE='1')
    p = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', os.path.join(root, 'tests')],
                       env=env, capture_output=True, text=True, timeout=300, cwd=root)
    broke = sorted(set(re.findall(r'^(?:FAIL|ERROR): (\w+)', p.stderr, re.M)))
    return p.returncode, broke, p.stderr


def mutant_copy(fname, old, new, pkg=PKG):
    d = tempfile.mkdtemp()
    root = os.path.join(d, 'mayor')
    shutil.copytree(pkg, root, ignore=shutil.ignore_patterns('__pycache__'))
    apply(root, fname, old, new)
    return d, root


class BaselineRed(Exception):
    """The UNMUTATED suite is red: every mutant would read as 'killed'. Not an AssertionError on purpose,
    so it can never be mistaken for an anchor failure or a killed mutant."""


def require_green(pkg):
    """Run the whole suite on an unmutated copy of `pkg`; raise BaselineRed unless it is green."""
    d = tempfile.mkdtemp()
    try:
        root = os.path.join(d, 'mayor')
        shutil.copytree(pkg, root, ignore=shutil.ignore_patterns('__pycache__'))
        rc, broke, err = run_suite(root)
    finally:
        shutil.rmtree(d)
    if rc != 0:
        raise BaselineRed('ABORT: the UNMUTATED suite is red (%s), so every mutant would read as killed. '
                          'No mutant was run. Make the suite green first.\n%s' % (', '.join(broke) or 'no test named',
                                                                                  err[-1500:]))


def run_mutants(pkg=PKG, mutants=None):
    """[(name, rc, broken tests)] -- ONLY after the unmutated suite is proven green (BaselineRed otherwise).
    Each mutant runs in a temp copy that is removed in a finally block."""
    require_green(pkg)
    out = []
    for name, fname, old, new in (MUTANTS if mutants is None else mutants):
        d, root = mutant_copy(fname, old, new, pkg)
        try:
            rc, broke, _ = run_suite(root)
        finally:
            shutil.rmtree(d)
        out.append((name, rc, broke))
    return out


class MutantGate(unittest.TestCase):
    """Runs INSIDE mutant runs too (cheap: two tiny synthetic suites, never this one, so no recursion),
    so a mutant that removes the gate is itself killed."""

    def pkg(self, d, want):
        root = os.path.join(d, 'pkg')
        os.makedirs(os.path.join(root, 'tests'))
        with open(os.path.join(root, 'target.py'), 'w') as f:
            f.write('X = 1\n')
        with open(os.path.join(root, 'tests', 'test_t.py'), 'w') as f:
            f.write('import os, sys, unittest\nsys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))\n'
                    'import target\n\nclass T(unittest.TestCase):\n    def test_x(self):\n'
                    '        self.assertEqual(target.X, %d)\n' % want)
        return root

    def test_a_red_suite_aborts_before_any_mutant(self):
        d = tempfile.mkdtemp()
        try:
            mutant = [('x is two', 'target.py', 'X = 1\n', 'X = 2\n')]
            with self.assertRaises(BaselineRed):
                run_mutants(self.pkg(os.path.join(d, 'red'), want=2), mutant)    # red unmutated: abort
            got = run_mutants(self.pkg(os.path.join(d, 'green'), want=1), mutant)
            self.assertEqual([(n, rc != 0, b) for n, rc, b in got], [('x is two', True, ['test_x'])],
                             'control: on a green suite the mutant runs and is killed')
        finally:
            shutil.rmtree(d)


@unittest.skipIf(IN_MUTANT, 'inside a mutant run')
class Mutants(unittest.TestCase):
    def test_the_unmutated_copy_is_green(self):
        d = tempfile.mkdtemp()
        try:
            root = os.path.join(d, 'mayor')
            shutil.copytree(PKG, root, ignore=shutil.ignore_patterns('__pycache__'))
            rc, broke, err = run_suite(root)
            self.assertEqual(rc, 0, 'positive control: the suite is green on an unmutated copy\n' + err[-2000:])
        finally:
            shutil.rmtree(d)

    def test_every_mutant_turns_the_suite_red(self):
        for name, rc, broke in run_mutants():                       # raises BaselineRed (ABORT) on a red suite
            with self.subTest(mutant=name):
                self.assertNotEqual(rc, 0, 'SURVIVED: %s' % name)
                self.assertTrue(broke, 'red without a named failing test: %s' % name)

    def test_anchor_guard_raises(self):
        d = tempfile.mkdtemp()
        try:
            shutil.copytree(PKG, os.path.join(d, 'm'), ignore=shutil.ignore_patterns('__pycache__'))
            with self.assertRaises(AssertionError):
                apply(os.path.join(d, 'm'), C, 'this text is not in the file', 'x')
            with self.assertRaises(AssertionError):
                apply(os.path.join(d, 'm'), C, "'FREE_BAG'", 'x')            # many times: not unique
        finally:
            shutil.rmtree(d)


if __name__ == '__main__' and '--report' in sys.argv:
    try:
        results = run_mutants()
    except BaselineRed as e:
        print(e)
        sys.exit(2)
    dead = 0
    for name, rc, broke in results:
        dead += rc != 0
        print('%-8s %-44s %s' % ('KILLED' if rc else 'SURVIVED', name, ', '.join(broke)))
    print('%d of %d killed (unmutated suite verified green first)' % (dead, len(results)))
    sys.exit(0 if dead == len(results) else 1)
elif __name__ == '__main__':
    unittest.main()
