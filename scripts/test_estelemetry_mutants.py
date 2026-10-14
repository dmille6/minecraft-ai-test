#!/usr/bin/env python3
"""Mutants of lib/estelemetry.py (killed by scripts/test_estelemetry.py) and of
scripts/host/fleetstatus.py (killed by scripts/test_fleetstatus.py).

Each mutant asserts its anchor is present exactly once (a mutant that silently fails to apply
reads as "killed" -- CLAUDE.md), writes the mutated module to a temp dir, runs the suite against
it via ESTELEMETRY_SRC, and requires (a) a non-zero exit and (b) that the tests named as its
killers are among the failures, so it dies for the intended reason. The unmutated suite must
pass first, or every kill is meaningless.

Run: python3 scripts/test_estelemetry_mutants.py      (exit 1 if any mutant survives)
"""
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'lib', 'estelemetry.py')
SUITE = os.path.join(HERE, 'test_estelemetry.py')
FS_SRC = os.path.join(HERE, 'host', 'fleetstatus.py')
FS_SUITE = os.path.join(HERE, 'test_fleetstatus.py')

FS_MUTANTS = [
    ('fleetstatus: stale-window check removed',
     "    if ev.until - cov['newest'] > STALE_AFTER:",
     "    if False:",
     {'stale_window_refused'}),
    ('fleetstatus: empty-window check removed',
     "    if not ev.total():\n        raise ZeroLooksWrong(f'{ev.since:%m-%d %H:%M}",
     "    if False:\n        raise ZeroLooksWrong(f'{ev.since:%m-%d %H:%M}",
     {'empty_window_refused'}),
    ('fleetstatus: bag snapshot selected by the flattened inventory again',
     "    lat = ev.latest(require='bot.pos.x', fields=['bot.inventory', 'exp.pool'])",
     "    lat = ev.latest(require='bot.inventory', fields=['bot.inventory', 'exp.pool'])",
     {'emptied_bag_is_seen'}),
    ('fleetstatus: drownings summed from pool buckets instead of counted',
     "    out['drownings'] = drown",
     "    out['drownings'] = int(sum(v for k, v in dr.items() if k != '<missing>'))",
     {'report_numbers'}),
    ('fleetstatus: pos row without inventory read as an empty bag',
     "        if not isinstance(inv, dict):",
     "        if False:",
     {'pos_row_without_inventory_is_not_an_empty_bag'}),
    ('fleetstatus: drowning time breakdown no longer reconciled',
     "    if sum(sum(v.values()) for v in h.values()) != drown:",
     "    if False:",
     {'drowning_breakdown_reconciled'}),
]

MUTANTS = [
    ('zero guard removed from count()',
     "        control = self._zero(kind, status, fail_class, match, detail_contains)\n        if detail_contains:",
     "        control = {}\n        if detail_contains:",
     {'zero_typo_kind_raises', 'zero_empty_window_raises', 'zero_typo_value_raises'}),
    ('empty-window positive control removed',
     "        if total == 0:\n            newest = self._newest()",
     "        if False:\n            newest = self._newest()",
     {'zero_empty_window_raises', 'zero_future_window_raises'}),
    ('underscore variant no longer offered as a near-miss',
     "    near = [alt] if alt in names else []",
     "    near = []",
     {'zero_underscore_variant_named_even_when_crowded'}),
    ('field-carries-no-values check removed',
     "            if not present:\n                raise ZeroLooksWrong(",
     "            if False:\n                raise ZeroLooksWrong(",
     {'zero_field_absent_for_kind_raises'}),
    ('replay day no longer refused',
     "                raise ReplayWindow(f'window {_iso(since)}..{_iso(until)} touches a known ES gap: {text} '",
     "                caveats.append(text); continue\n                raise ReplayWindow(f'window {_iso(since)}..{_iso(until)} touches a known ES gap: {text} '",
     {'replay_refused'}),
    ('rows() size check removed',
     "            if n > max_rows:\n                raise TooManyRows(",
     "            if False:\n                raise TooManyRows(",
     {'rows_refuse_eagerly'}),
    ('grouping-field positive control removed from terms()',
     "            self._field_seen(field, kind, allow_zero)\n        if not out and not allow_zero:",
     "            pass\n        if not out and not allow_zero:",
     {'terms_unknown_field_raises'}),
    ('row cap no longer enforced while streaming',
     "                    if seen > n:\n                        raise EsError(",
     "                    if False:\n                        raise EsError(",
     {'rows_stream_never_exceeds_its_count'}),
    ('short read no longer detected',
     "        if seen != n:\n            raise EsError(",
     "        if False:\n            raise EsError(",
     {'rows_short_read_raises'}),
    ('key no longer scrubbed from HTTP errors',
     "        raise EsError(_scrub(f'{path}: HTTP {e.code}: {e.read().decode(errors=\"replace\")}', auth)[:400]) from None",
     "        raise EsError(f'{path}: HTTP {e.code}: {e.read().decode(errors=\"replace\")}'[:400]) from None",
     {'key_mode_refused_and_never_echoed'}),
    ('detail_contains zero accepted silently',
     "        if detail_contains:\n            raise ZeroLooksWrong(",
     "        if False:\n            raise ZeroLooksWrong(",
     {'detail_contains_is_a_token_phrase'}),
    ('terms completeness check removed (other + error bound)',
     "        if t.get('sum_other_doc_count') or t.get('doc_count_error_upper_bound'):",
     "        if False:",
     {'terms_error_bound_raises', 'nested_error_bound_raises', 'terms_truncation_raises'}),
    ('truncate BEFORE scrubbing again',
     "        raise EsError(_scrub(f'{path}: HTTP {e.code}: {e.read().decode(errors=\"replace\")}', auth)[:400]) from None",
     "        raise EsError(_scrub(f'{path}: HTTP {e.code}: {e.read().decode(errors=\"replace\")[:300]}', auth)) from None",
     {'scrub_before_truncate'}),
    ('detail zero rule only in count()',
     "        if filters.get('detail_contains'):\n            raise ZeroLooksWrong(",
     "        if False:\n            raise ZeroLooksWrong(",
     {'detail_zero_rule_in_every_api'}),
    ('quiet-window field check (mapping) removed',
     "            if not self._mapped(field):",
     "            if False:",
     {'quiet_window_field_check'}),
]


def run(src_dir, suite=SUITE, var='ESTELEMETRY_SRC'):
    env = dict(os.environ, **{var: src_dir})
    p = subprocess.run([sys.executable, suite], capture_output=True, text=True, env=env, timeout=300)
    failed = set(re.findall(r'^  FAIL  (\w+):', p.stdout, re.M))
    return p.returncode, failed, p.stdout


def main():
    rc, failed, out = run(os.path.join(HERE, 'lib'))
    if rc != 0:
        print(out)
        print('UNMUTATED SUITE FAILS -- mutant kills would mean nothing')
        return 1
    rc, failed, out = run(os.path.join(HERE, 'host'), FS_SUITE, 'FLEETSTATUS_SRC')
    if rc != 0:
        print(out)
        print('UNMUTATED fleetstatus SUITE FAILS')
        return 1
    print('  unmutated suites: pass')
    survivors = 0
    plan = [(m, SRC, 'estelemetry.py', SUITE, 'ESTELEMETRY_SRC') for m in MUTANTS]
    plan += [(m, FS_SRC, 'fleetstatus.py', FS_SUITE, 'FLEETSTATUS_SRC') for m in FS_MUTANTS]
    for (name, old, new, killers), target, fname, suite, var in plan:
        src = open(target).read()
        n = src.count(old)
        assert n == 1, f'ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE (%d)" % n} for mutant {name!r}'
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, fname), 'w') as fh:
                fh.write(src.replace(old, new))
            rc, failed, out = run(d, suite, var)
        hit = killers & failed
        if rc != 0 and hit == killers:
            print(f'  KILLED   {name}  (by {sorted(hit)})')
        else:
            survivors += 1
            print(f'  SURVIVED {name}: rc={rc}, failed={sorted(failed)}, expected killers={sorted(killers)}')
    print(f'{len(plan) - survivors}/{len(plan)} mutants killed')
    return 1 if survivors else 0


if __name__ == '__main__':
    sys.exit(main())
