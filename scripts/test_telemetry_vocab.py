#!/usr/bin/env python3
"""Qualification tests for the typed-vocabulary additions to telemetry.py.

WHY THESE EXIST. On 2026-09-23 `count('dig_unconfirmed')` returned 0 and that 0 was
published as "the instrument has zero emit sites", then used to overturn a correct
finding. Both names are LIVE fail_class values; this library indexed only skill.name.
ZeroLooksWrong could not fire -- the spelling was right and the window was full.

Every test is a known-answer case with its negative control.
Run: python3 scripts/test_telemetry_vocab.py
"""
import os, sys, datetime, traceback

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import telemetry as T

NOW = datetime.datetime.now(datetime.timezone.utc)

def row(name, fail_class=None, bot='hive-b-Comet', version='9b572aa', detail=''):
    sk = {'name': name, 'detail': detail}
    if fail_class: sk['fail_class'] = fail_class
    return {'t': NOW, 'name': name, 'detail': detail,
            'fail_class': fail_class, 'status': None,
            'bot': {'name': bot},
            'raw': {'skill': sk, 'bot': {'name': bot}, 'code': {'version': version}}}

def ev(rows, span=1.0):
    return T.Events(rows, NOW - datetime.timedelta(hours=1), NOW, span)

PASS = FAIL = 0
def check(name, fn):
    global PASS, FAIL
    try:
        fn(); print(f'  PASS  {name}'); PASS += 1
    except Exception as e:
        print(f'  FAIL  {name}: {e}'); traceback.print_exc(); FAIL += 1

# ---- the exact bug of 2026-09-23 -------------------------------------------------
def t_the_bug():
    """count() on a live fail_class must RAISE, not return 0."""
    e = ev([row('gather', fail_class='dig_unconfirmed')])
    try:
        e.count('dig_unconfirmed')
    except T.WrongVocabulary as x:
        assert 'count_class' in str(x), 'the raise must name the right accessor'
        return
    raise AssertionError('count() on a live fail_class returned instead of raising')

def t_the_bug_underscored():
    """logEvent kinds carry a leading underscore; the guard must see through it."""
    e = ev([row('gather', fail_class='arrived_out_of_reach')])
    try:
        e.count('_arrived_out_of_reach')
    except T.WrongVocabulary:
        return
    raise AssertionError('the underscore form must also raise')

def t_count_class_positive():
    e = ev([row('gather', fail_class='dig_unconfirmed'),
            row('gather', fail_class='dig_unconfirmed'),
            row('gather', fail_class='no_path')])
    assert e.count_class('dig_unconfirmed') == 2, e.count_class('dig_unconfirmed')
    assert e.count_class('DIG_UNCONFIRMED') == 2, 'must be case-insensitive'

def t_count_class_reverse_guard():
    """An EVENT KIND asked as a fail_class must raise the other way."""
    e = ev([row('_death'), row('gather', fail_class='no_path')])
    try:
        e.count_class('_death')
    except T.WrongVocabulary as x:
        assert 'count(' in str(x)
        return
    raise AssertionError('an event kind asked as a fail_class must raise')

def t_count_class_near_miss():
    e = ev([row('gather', fail_class='no_safe_target')])
    try:
        e.count_class('no_safe_targets')
    except T.ZeroLooksWrong as x:
        assert 'no_safe_target' in str(x)
        return
    raise AssertionError('a near-miss fail_class must raise ZeroLooksWrong')

def t_count_class_allow_zero():
    e = ev([row('gather', fail_class='no_path')])
    assert e.count_class('never_happens', allow_zero=True) == 0

def t_no_classes_at_all_raises():
    """A window with no fail_class anywhere is itself suspicious."""
    e = ev([row('_affordance_scan')])
    try:
        e.count_class('no_path')
    except T.ZeroLooksWrong as x:
        assert 'EVERY fail_class' in str(x)
        return
    raise AssertionError('a window with no fail_class at all must raise')

def t_classes_listing():
    e = ev([row('gather', fail_class='no_path'), row('gather', fail_class='no_path'),
            row('gather', fail_class='unreachable')])
    got = e.classes()
    assert got[0] == (2, 'no_path'), got
    assert (1, 'unreachable') in got, got

def t_of_class():
    e = ev([row('gather', fail_class='no_path', bot='a'),
            row('gather', fail_class='unreachable', bot='b')])
    rs = e.of_class('no_path')
    assert len(rs) == 1 and rs[0]['bot']['name'] == 'a', rs

# ---- version mixing --------------------------------------------------------------
def t_one_version_ok():
    e = ev([row('gather', version='9b572aa'), row('gather', version='9b572aa')])
    assert e.assert_one_version() == '9b572aa'

def t_mixed_versions_raise():
    e = ev([row('gather', version='9b572aa'), row('gather', version='842e017')])
    try:
        e.assert_one_version()
    except T.VersionsMixed as x:
        assert '9b572aa' in str(x) and '842e017' in str(x)
        return
    raise AssertionError('a window spanning two builds must raise')

# ---- the rate() fix stays fixed --------------------------------------------------
def t_rate_auto_does_not_explode():
    """bots='auto' used to build a set of dicts and raise unhashable type: 'dict'."""
    e = ev([row('_death', bot='a'), row('_death', bot='b')], span=1.0)
    r = e.rate('_death', bots='auto')
    assert abs(r - 1.0) < 1e-9, r

if __name__ == '__main__':
    print('telemetry typed-vocabulary qualification:')
    for nm, fn in [
        ('THE BUG: count() on a live fail_class RAISES WrongVocabulary', t_the_bug),
        ('the _underscored form raises too', t_the_bug_underscored),
        ('count_class finds them, case-insensitively (positive control)', t_count_class_positive),
        ('an event kind asked as a fail_class raises the other way', t_count_class_reverse_guard),
        ('a near-miss fail_class raises ZeroLooksWrong', t_count_class_near_miss),
        ('allow_zero=True still opts out', t_count_class_allow_zero),
        ('a window with NO fail_class at all raises', t_no_classes_at_all_raises),
        ('classes() lists them commonest-first', t_classes_listing),
        ('of_class returns the rows', t_of_class),
        ('one version passes assert_one_version', t_one_version_ok),
        ('two versions RAISE VersionsMixed', t_mixed_versions_raise),
        ("rate(bots='auto') does not raise on dict bots", t_rate_auto_does_not_explode),
    ]:
        check(nm, fn)
    print(f'\n{PASS} passed, {FAIL} failed')
    sys.exit(1 if FAIL else 0)
