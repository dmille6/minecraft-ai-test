#!/usr/bin/env python3
"""fieldaudit.py -- RAISE when a field a read script emits CANNOT be non-zero.

WHY THIS EXISTS. Measured 2026-09-23: `depositread.py` read `sk.get('failClass')` for its
whole life while `bots/src/logger.mjs:80` writes the key as `fail_class`. On 842 real deposit
runs, `failClass` was present on 0 rows and `fail_class` on 281. That alone is a broken
instrument. The half that actually shipped is worse: `skill_error` is a **fail_class**, never
a **status**, the script built its counter keys as f"{status}/{fail_class}", and then emitted

    skill_error_share_canary = cls[k]['skill_error'] / runs

`cls` is a defaultdict(Counter), so that lookup returned 0 SILENTLY. The emitted field was a
HARD ZERO BY CONSTRUCTION and a canary gate reading it saw "no problem" forever. No care at
the read could have caught it: the read was correct about a number that could only ever be
one number. So this is the mechanism for that class, in the shape CLAUDE.md asks for -- it
does not ask anyone to remember, it RAISES. `ZeroLooksWrong` is the model.

FOUR OUTCOMES, AND THE LAST TWO ARE NOT THE SAME THING (Codex review, 2026-09-23)

  DEAD          a mechanically PROVEN contract violation: the lookup cannot match the
                container, or the row key is absent from all real telemetry. Raises FieldIsDead.
  ZERO_ALIVE    valid selector, live container, the category simply did not occur in this
                window. A REAL FINDING. Reported, never raised.
  SUSPECT       something is off but the evidence does not prove impossibility -- an empty
                container, a NaN, a name that merely resembles a live key. Reported, and it
                refuses to certify. It is NOT an allegation that the field is dead.
  INCOMPLETE    the read would not run, emitted nothing, or used constructs this audit cannot
                follow. Refuses certification rather than calling silence clean.

NEITHER EXCEPTION IS EVIDENCE FOR A CANARY REVERT. A dead field means the number was never a
number; it says nothing about the bots.

HOW `DEAD` IS PROVEN, MECHANICALLY, NOT BY INSPECTION

A read of a missing key on a Counter returns 0 and leaves no trace, so we give it one. Before
a read script runs, `collections.Counter`/`defaultdict` are replaced by subclasses whose
`__missing__` AND `get()` record the miss and return a TAINTED zero -- an int subclass that
carries its provenance through `/`, `-`, `*`, `sum`, DiD, everything. `readjson.emit` is
replaced by a capture. A field arriving at emit() still tainted was PROVABLY computed from a
key that did not exist; nothing is matched by field name and nothing is guessed from source.

Taint cannot leak into the script's own data: `__setitem__` strips it, so the routine
`counter[k] += 1` (which also misses, on its first increment) stores a clean int and its taint
dies there. Only a READ of a key that is never written survives to emit().

Then the verdict on that miss comes from DIMENSION INFERENCE ON REAL DATA, which is the part
that makes a false raise hard rather than unlikely. For every container, ask the telemetry
which FIELD its keys are actually live values of: a container whose keys are
{success, no_effect, failed} is keyed by `skill.status`; one whose keys are
{skill_error, storage_full} is keyed by `skill.fail_class`. Then

  missed key is live under a DIFFERENT field than the container is keyed by  -> DEAD (proven)
  missed key is live under the SAME field                                   -> ZERO_ALIVE
  missed key is an exact delimiter-separated COMPONENT of live keys         -> DEAD (proven)
  missed key differs from a live key only by the leading '_' convention     -> DEAD (proven)
  the missed key merely appears as a SUBSTRING of a live key                -> SUSPECT

THIS IS WHAT CATCHES THE ORIGINAL BUG. Under the original two faults together, `cls[k]` held
bare statuses, so NO key contained `skill_error` and a sibling-substring rule would have found
nothing. Dimension inference gets it: `skill_error` is a live `skill.fail_class` and the
container is keyed by `skill.status`. `{'unsuccessful': 3}['success']`, by contrast, is NOT
raised on -- nothing establishes that container's dimension, so it is SUSPECT. That asymmetry
is deliberate; this project has reverted three working canaries on its own instruments.

EVERY NEGATIVE CLAIM CARRIES A POSITIVE CONTROL. Each dead verdict prints the live keys the
SAME container answers to with their counts, and the telemetry path and row count where the
missed name IS live. The run-level control (rows, bots, key paths, fields alive) prints
unconditionally, including on a clean run -- a check that has only ever been seen to pass is
not a check. `--selftest` plants nine fixtures, including BOTH original faults together, and
fails if the audit does not raise on each, or if it raises on the genuine zero.

USAGE
    python3 fieldaudit.py                      # audit every emit() caller beside this file
    python3 fieldaudit.py --only depositread
    python3 fieldaudit.py --window 180         # post-window minutes handed to each read
    python3 fieldaudit.py --selftest           # prove it raises on planted dead fields
    python3 fieldaudit.py --json

Exit 0 clean / 3 FieldIsDead / 5 AuditIncomplete / 4 the self-test failed to fail.

SIDE EFFECTS: none by construction, and checked rather than asserted. `readjson.emit` is
captured so no verdict file is written; `builtins.open` is refused for every write mode during
a read's execution (the real emit re-reads the live manifest and would write
~/digest/reads/<run_id>-... using the LIVE run id, which could overwrite a real canary's
evidence -- Codex, and the reason the write guard exists rather than being trusted to the
stub); and the audit snapshots the reads directory before and after and reports any change.

WHAT THIS CANNOT SEE, stated plainly because a clean bill of health from a partial instrument
is this project's most expensive failure:
  - A wrong lookup that HITS an existing key (wrong arm, wrong era, wrong denominator). The
    value is then wrong, not dead, and no key-space method can know it was not intended.
  - An empty upstream bucket reached by `sum(d[k].values())`: the sum of nothing is an
    untainted 0, so the taint chain ends. Counted and reported per script, never attributed.
  - `setdefault`, caught KeyError, comprehension-built dicts, plain (unpatched) dict literals.
  - Observed key space is not POSSIBLE key space. A window is evidence, not a schema.
"""
import argparse
import ast
import builtins
import collections
import datetime as dt
import glob
import io
import json
import math
import operator
import os
import re
import sys
import traceback

SELF_DIR = os.path.dirname(os.path.abspath(__file__))
# lib/ lives in the deploy tree, and /opt is what the canary loop actually runs
# (memory: analysis-lib-lives-in-the-deploy-tree).
for _p in ('/opt/minecraft-ai/scripts', SELF_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)


class FieldIsDead(LookupError):
    """An emitted field PROVEN incapable of being non-zero. Named, with its positive control.

    A LookupError for the same reason ZeroLooksWrong is one: the failure is a key that is not
    there, and the honest response to that is an exception rather than a zero.
    """


class AuditIncomplete(RuntimeError):
    """The audit could not certify these fields. NOT an allegation that they are dead.

    Kept a separate exception from FieldIsDead on purpose: conflating "I proved this is
    broken" with "I could not tell" is how a guard becomes the thing that misleads.
    """


# --------------------------------------------------------------------------- taint

# THE REAL CLASSES, BOUND AT IMPORT. During a run `collections.Counter` IS `AuditCounter`, so
# `collections.Counter.__setitem__(self, ...)` inside the override is infinite recursion -- the
# self-test caught exactly that on its first run. Neither Counter nor defaultdict overrides
# __setitem__ or get, so dict's are the correct implementations to delegate to.
_REAL_COUNTER = collections.Counter
_REAL_DEFAULTDICT = collections.defaultdict


class Prov:
    """Where a tainted zero came from: the container (weakly held, so the report can see the
    key space as it FINISHED), the key that was not in it, and how it was asked for."""

    __slots__ = ('kind', 'key', 'via', 'keys_at_miss', 'ref', 'where', 'frozen')

    def __init__(self, kind, key, container, where, via):
        import weakref
        self.kind, self.key, self.via, self.where = kind, key, via, where
        self.keys_at_miss = len(container)
        self.frozen = None
        try:
            self.ref = weakref.ref(container)
        except TypeError:
            self.ref = lambda: None

    def freeze(self):
        """Snapshot the key space AT EMIT TIME. Without this the container is garbage by the
        time the verdict is written -- the script's globals are dropped when exec returns, the
        weakref dies, and every finding degrades to 'container gone' (self-test, first run).
        Snapshotting at emit is also what bounds the memory: 500 keys, not a whole namespace."""
        if self.frozen is not None:
            return
        c = self.ref()
        if c is None:
            self.frozen = (None, {})
            return
        try:
            ks = list(c.keys())[:500]
            self.frozen = (ks, {k: c[k] for k in ks if not isinstance(c.get(k), (dict, list))})
        except Exception:
            self.frozen = (None, {})

    def final(self):
        if self.frozen is not None:
            return self.frozen
        self.freeze()
        return self.frozen


def _prov_of(*vals):
    for v in vals:
        p = getattr(v, '_prov', None)
        if p is not None:
            return p
    return None


def _taint(value, prov):
    if prov is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return DeadInt(value, prov)
    if isinstance(value, float):
        return DeadFloat(value, prov)
    return value


def _untaint(value):
    if getattr(value, '_prov', None) is None:
        return value
    if isinstance(value, DeadInt):
        return int(value)
    if isinstance(value, DeadFloat):
        return float(value)
    return value


class DeadInt(int):
    """A 0 that came from a key which was not there -- and says so all the way to emit()."""
    def __new__(cls, value, prov):
        self = int.__new__(cls, value)
        self._prov = prov
        return self


class DeadFloat(float):
    def __new__(cls, value, prov):
        self = float.__new__(cls, value)
        self._prov = prov
        return self


def _install_arith():
    """Arithmetic that carries provenance. A share is `dead / runs` and a DiD is a difference
    of differences; taint has to survive both or it never reaches emit()."""
    fwd = {'__add__': operator.add, '__sub__': operator.sub, '__mul__': operator.mul,
           '__truediv__': operator.truediv, '__floordiv__': operator.floordiv,
           '__mod__': operator.mod, '__pow__': operator.pow}
    rev = {'__radd__': operator.add, '__rsub__': operator.sub, '__rmul__': operator.mul,
           '__rtruediv__': operator.truediv, '__rfloordiv__': operator.floordiv}
    for cls, plain in ((DeadInt, int), (DeadFloat, float)):
        for name, op in fwd.items():
            def f(self, other, _op=op, _p=plain):
                try:
                    res = _op(_p(self), _untaint(other))
                except TypeError:
                    return NotImplemented
                return _taint(res, _prov_of(self, other))
            setattr(cls, name, f)
        for name, op in rev.items():
            def g(self, other, _op=op, _p=plain):
                try:
                    res = _op(_untaint(other), _p(self))
                except TypeError:
                    return NotImplemented
                return _taint(res, _prov_of(self, other))
            setattr(cls, name, g)
        for name in ('__neg__', '__pos__', '__abs__'):
            def u(self, _n=name, _p=plain):
                return _taint(getattr(_p, _n)(_p(self)), self._prov)
            setattr(cls, name, u)
        def rnd(self, ndigits=None, _p=plain):
            return _taint(round(_p(self)) if ndigits is None else round(_p(self), ndigits),
                          self._prov)
        setattr(cls, '__round__', rnd)


_install_arith()


# --------------------------------------------------------------------------- containers

class _Ledger:
    def __init__(self):
        self.misses = []
        self.empty_buckets = 0     # a defaultdict miss that created an empty container
        self.enabled = False

    def record(self, prov):
        if len(self.misses) < 50000:
            self.misses.append(prov)
        return prov


LEDGER = _Ledger()


def _caller():
    """file:line of the lookup, for the message only. A wrong frame costs a worse message and
    never a verdict."""
    try:
        f = sys._getframe(2)
        me = os.path.abspath(__file__)
        for _ in range(14):
            if f is None:
                break
            if os.path.abspath(f.f_code.co_filename) != me:
                return '%s:%d' % (os.path.basename(f.f_code.co_filename), f.f_lineno)
            f = f.f_back
    except Exception:
        pass
    return '?'


class AuditCounter(collections.Counter):
    """A Counter that cannot be silent about a key it does not have."""

    def __missing__(self, key):
        if not LEDGER.enabled:
            return 0
        return DeadInt(0, LEDGER.record(Prov('Counter', key, self, _caller(), '[]')))

    def get(self, key, default=None):
        # `get()` DOES NOT CALL __missing__ (documented Python behaviour) -- so a dead lookup
        # written as `c.get('skill_error', 0)` would leave no trace at all. Codex pass 1.
        if key in self:
            return dict.get(self, key)
        if not LEDGER.enabled:
            return default
        prov = LEDGER.record(Prov('Counter', key, self, _caller(), 'get()'))
        return _taint(default, prov) if isinstance(default, (int, float)) else default

    def __setitem__(self, key, value):
        # Taint dies on a write. `c[k] += 1` misses, adds, stores -- ordinary counting, not a
        # dead lookup. Without this the taint spreads and every field reads as dead.
        dict.__setitem__(self, key, _untaint(value))


ROW_HITS = collections.Counter()
ROW_MISSES = collections.Counter()
ROW_SITES = {}


def _split_site(where):
    try:
        f, ln = where.rsplit(':', 1)
        return (f, int(ln))
    except Exception:
        return (where, 0)


class AuditRow(dict):
    """A telemetry row that cannot be silent about a key it does not carry.

    THIS IS CASE (a), DONE AT RUNTIME INSTEAD OF BY GUESSING FROM SOURCE. A normalised row
    carries exactly t/name/detail/fail_class/status/bot/raw (telemetry.py). `depositread.py:27`
    and `immobiledid.py:30` both sort on `r.get('@timestamp', '')` -- a RAW payload key asked of
    a normalised row -- so every key is '' and the sort is a no-op. No AST receiver heuristic is
    needed to know that: the row itself reports the miss, and the row schema is the control.
    """
    _rowkind = 'row'

    def __missing__(self, key):
        if LEDGER.enabled:
            ROW_MISSES[(self._rowkind, key)] += 1
            LEDGER.record(Prov(self._rowkind, key, self, _caller(), '[]'))
        raise KeyError(key)

    def get(self, key, default=None):
        if key in self:
            ROW_HITS[(self._rowkind, key)] += 1
            return dict.get(self, key)
        if not LEDGER.enabled:
            return default
        w = _caller()
        ROW_MISSES[(self._rowkind, key)] += 1
        ROW_SITES.setdefault((self._rowkind, key), set()).add(_split_site(w))
        prov = LEDGER.record(Prov(self._rowkind, key, self, w, 'get()'))
        return _taint(default, prov) if isinstance(default, (int, float)) else default


class AuditRawRow(AuditRow):
    _rowkind = 'raw payload'


class AuditDefaultDict(collections.defaultdict):

    def __missing__(self, key):
        if not LEDGER.enabled or self.default_factory is None:
            return _REAL_DEFAULTDICT.__missing__(self, key)
        prov = LEDGER.record(Prov('defaultdict', key, self, _caller(), '[]'))
        value = self.default_factory()
        self[key] = value
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            # Containers MUST come back by reference or the script's own mutations are lost.
            # An empty bucket created by a lookup is a real false-zero risk that the taint
            # chain cannot follow (sum of nothing is an untainted 0), so count it and say so.
            try:
                if len(value) == 0:
                    LEDGER.empty_buckets += 1
            except TypeError:
                pass
            return value
        return _taint(value, prov)

    def get(self, key, default=None):
        if key in self:
            return dict.get(self, key)
        if not LEDGER.enabled:
            return default
        prov = LEDGER.record(Prov('defaultdict', key, self, _caller(), 'get()'))
        return _taint(default, prov) if isinstance(default, (int, float)) else default

    def __setitem__(self, key, value):
        dict.__setitem__(self, key, _untaint(value))


# --------------------------------------------------------------------------- the universe

def _flatten(obj, prefix, paths, values, depth=0):
    if depth > 4 or not isinstance(obj, dict):
        return
    for k, v in obj.items():
        if not isinstance(k, str):
            continue
        p = (prefix + '.' + k) if prefix else k
        paths[p] += 1
        if isinstance(v, dict):
            _flatten(v, p, paths, values, depth + 1)
        elif isinstance(v, str) and 0 < len(v) <= 64:
            c = values.setdefault(p, collections.Counter())
            if len(c) < 800 or v in c:
                c[v] += 1


_LOAD_CACHE = {}
_REAL_LOAD = None


INSTRUMENT_ROWS = 20000     # stride-sampled, NOT the head: a windowed read filters the head out
SNAP_MIN = 60               # round a requested window UP to this, so seven reads share one walk
MAX_RSS_GB = 6.0            # refuse to keep growing; a guard must not OOM the fleet host


def rss_gb():
    try:
        with open('/proc/self/status') as fh:
            for line in fh:
                if line.startswith('VmRSS:'):
                    return int(line.split()[1]) / (1024.0 * 1024.0)
    except Exception:
        pass
    try:
        import resource
        raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # ru_maxrss IS NOT THE SAME UNIT ON EVERY PLATFORM: Linux reports kibibytes,
        # macOS and the BSDs report BYTES. Dividing by 1024^2 unconditionally overstates
        # by 1024x off Linux, and this guard then refused every run on a Mac -- "using
        # 25.2 GB" against a real 15 MB. The /proc branch above keeps the fleet host
        # right, so the bug only bit the machine where the mutant suites are meant to
        # run; CLAUDE.md requires them OFF the bots host, which is exactly where the
        # tool could not start.
        import sys as _sys
        return raw / 1e9 if _sys.platform == 'darwin' else raw / (1024.0 * 1024.0)
    except Exception:
        return 0.0


def check_rss(where):
    r = rss_gb()
    if r > MAX_RSS_GB:
        raise AuditIncomplete(
            'this audit is using %.1f GB after %s, over the %.1f GB ceiling. REFUSING to '
            'continue rather than risk the OOM killer choosing a bot process (telemetry.py '
            'records two such kills on 2026-09-02). Narrow --window, or raise --max-rss-gb '
            'deliberately.' % (r, where, MAX_RSS_GB))
    return r


def load_cached(paths, since_minutes):
    """Memoised: auditing seven reads costs ONE walk, not seven. Returns a fresh Events over a
    copied row list, because the reads do `ev.rows.extend(...)` for rotation.

    A stride sample of the rows comes back INSTRUMENTED, so a lookup of a key no row carries
    is witnessed rather than inferred. Sampled rather than wholesale because the memory is the
    real risk to this guard's survival -- telemetry.py records two OOM kills on 2026-09-02, and
    a kernel choosing a bot process over this one would be a guard that damages the fleet.
    """
    from lib.telemetry import Events
    # SNAP UP so the seven reads share one walk instead of asking for 390, 400 and 450 minutes.
    # A SUPERSET IS SAFE HERE and a subset would not be: every read filters rows to its own
    # window (`if d < -PRE or d > W: continue`), so extra rows are discarded by the read itself,
    # and no read calls assert_one_version (checked), so a wider window cannot trip a version
    # assert. What it does change is the row count a read PRINTS, which is why the audit says so.
    if since_minutes is not None and SNAP_MIN:
        since_minutes = int(math.ceil(float(since_minutes) / SNAP_MIN) * SNAP_MIN)
    key = (paths, since_minutes)
    if key not in _LOAD_CACHE:
        # ONE resident walk. Without the eviction the cache held every window at once and the
        # first real run reached 8.98 GB.
        _LOAD_CACHE.clear()
        import gc
        gc.collect()
        _LOAD_CACHE[key] = _REAL_LOAD(Events, paths=paths, since_minutes=since_minutes)
        check_rss('a %d-minute walk' % since_minutes)
    b = _LOAD_CACHE[key]
    rows = list(b.rows)
    if rows and LEDGER.enabled:
        stride = max(1, len(rows) // INSTRUMENT_ROWS)
        for i in range(0, len(rows), stride):
            r = AuditRow(rows[i])
            raw = dict.get(r, 'raw')       # not r.get: the audit must not record its own hits
            if isinstance(raw, dict):
                dict.__setitem__(r, 'raw', AuditRawRow(raw))
            rows[i] = r
    return Events(rows, b.since, b.until, b.span)


def install_loader_cache():
    global _REAL_LOAD
    from lib.telemetry import Events
    if _REAL_LOAD is not None:
        return
    raw = Events.load.__func__

    def real(cls, paths=None, since_minutes=None, since=None, until=None, version=None):
        return raw(cls, paths=paths, since_minutes=since_minutes, since=since, until=until,
                   version=version)
    _REAL_LOAD = real

    def cached(cls, paths='/var/log/mcai/*/skill-*.jsonl*', since_minutes=None, since=None,
               until=None, version=None):
        if since is None and until is None and version is None and since_minutes is not None:
            return load_cached(paths, since_minutes)
        return real(cls, paths=paths, since_minutes=since_minutes, since=since, until=until,
                    version=version)
    Events.load = classmethod(cached)


def build_universe(window_min, paths_glob='/var/log/mcai/*/skill-*.jsonl'):
    """One blessed full walk. `Events.load` only -- never a hand-rolled query (CLAUDE.md:
    hand-rolled queries produced two wrong findings in one day)."""
    ev = load_cached(paths_glob, window_min)
    paths, values = collections.Counter(), {}
    for r in ev.rows:
        _flatten(r['raw'], '', paths, values, 0)
    leaf = collections.Counter()
    for p, n in paths.items():
        leaf[p.rsplit('.', 1)[-1]] += n
    # value -> [(path, count)], the dimension index. This is the whole basis of the DEAD
    # verdict, and it is built from real rows rather than from anybody's idea of the schema.
    where = {}
    for p, c in values.items():
        for v, n in c.items():
            where.setdefault(v, []).append((p, n))
    for v in where:
        where[v].sort(key=lambda x: -x[1])
    details = [r['detail'] for r in ev.rows if r.get('detail')]
    return {'paths': paths, 'leaf': leaf, 'values': values, 'where': where,
            'rows': len(ev.rows), 'bots': len(ev.bots()), 'window_min': window_min,
            'span_h': ev.span, 'details': details,
            'kinds': collections.Counter(r['name'] for r in ev.rows)}


def same_vocabulary(p_a, p_b, universe, min_shared=3, frac=0.10):
    """Do two telemetry paths draw on the SAME vocabulary? `bot.held` and `skill.args.item` both
    hold item names and overlap heavily; `skill.status` and `skill.fail_class` share nothing. A
    key missing from one path of an overlapping pair proves nothing at all."""
    a = set(universe['values'].get(p_a) or ())
    b = set(universe['values'].get(p_b) or ())
    if not a or not b:
        return False
    shared = a & b
    return len(shared) >= min_shared or len(shared) >= frac * min(len(a), len(b))


def dimension_of(keys, universe):
    """Which telemetry field this container's keys are live values of, from data.

    Returns (path, matched, total, examples) or (None, ...). Requires at least two distinct
    keys matched and a clear majority, because one coincidental match is not a dimension.
    """
    strs = [k for k in keys if isinstance(k, str) and k]
    if len(strs) < 2:
        return None, 0, len(strs), []
    votes = collections.Counter()
    for k in strs:
        for p, _n in universe['where'].get(k, ())[:4]:
            votes[p] += 1
    if not votes:
        return None, 0, len(strs), []
    path, matched = votes.most_common(1)[0]
    if matched < 2 or matched < 0.6 * len(strs):
        return None, matched, len(strs), []
    ex = [k for k in strs if any(p == path for p, _ in universe['where'].get(k, ()))][:5]
    return path, matched, len(strs), ex


# --------------------------------------------------------------------------- verdicts

_SPLIT = re.compile(r'[/|:,>+]+')
DEAD = ('DEAD_WRONG_DIMENSION', 'DEAD_COMPOSITE_KEY', 'DEAD_UNDERSCORE_CONVENTION',
        'DEAD_WRONG_ROW_KEY')
SUSPECT = ('SUSPECT_SUBSTRING', 'SUSPECT_EMPTY_CONTAINER', 'SUSPECT_NOT_A_NUMBER',
           'PROSE_LITERAL_NEVER_MATCHES', 'MASKED_DEAD_LOOKUP')


def _components(keys, key):
    """Live keys of which `key` is an exact delimiter-separated component, or a tuple member.
    `'success'` against `{'success/skill_error': 7}` is this, and it is not a guess."""
    out = []
    for k in keys:
        if k == key:
            continue
        if isinstance(k, tuple):
            if any(str(x) == str(key) for x in k):
                out.append(k)
        elif isinstance(k, str) and any(p == key for p in _SPLIT.split(k) if p):
            out.append(k)
    return out


def _underscore(keys, key):
    ks = str(key)
    return [k for k in keys
            if isinstance(k, str) and k != key and k.lstrip('_') == ks.lstrip('_')]


def _substrings(keys, key):
    ks = str(key)
    return [k for k in keys if isinstance(k, str) and k != key and ks and ks in k]


def _isnan(v):
    try:
        return isinstance(v, float) and math.isnan(v)
    except Exception:
        return False


def classify(value, universe):
    """One emitted value -> one verdict. The only inputs to a DEAD verdict are the taint (a key
    that was not there, provably reaching this field) and real telemetry. Source text is never
    consulted here, and the field's NAME is never matched against anything."""
    prov = getattr(value, '_prov', None)
    if _isnan(value):
        return {'verdict': 'SUSPECT_NOT_A_NUMBER', 'value': 'NaN',
                'note': 'NaN is neither zero nor a number; a gate comparing it is always false'}
    falsy = value is None or (isinstance(value, (int, float)) and value == 0) \
        or (isinstance(value, (dict, list, tuple, set, str)) and len(value) == 0)
    if prov is None:
        return {'verdict': 'ZERO_ALIVE' if falsy else 'ALIVE', 'value': _plain(value),
                'note': ('computed from live containers; genuinely zero in this window'
                         if falsy else '')}
    keys, counts = prov.final()
    ctl = {'key': _plain(prov.key), 'where': prov.where, 'via': prov.via}
    if not falsy:
        # A dead lookup summed with a live one. Worth naming, never worth raising: the field
        # CAN be non-zero, which is the question this script asks.
        return dict(ctl, verdict='ALIVE', value=_plain(value),
                    note='a missing key (%r) fed this, but the value is non-zero'
                    % (prov.key,))
    if keys is None:
        return dict(ctl, verdict='SUSPECT_SUBSTRING', value=_plain(value), control=[],
                    control_why='container-gone',
                    note='the container was collected before the report could read it')
    if len(keys) == 0:
        # NOT proof. The filter that fills it may legitimately have matched nothing (Codex).
        return dict(ctl, verdict='SUSPECT_EMPTY_CONTAINER', value=_plain(value), control=[],
                    control_why='none-available',
                    note=('the %s this field indexes was never populated by ANY key. That is '
                          'either an absent instrument or a window in which nothing matched, '
                          'and this audit cannot tell which' % prov.kind))
    live = sorted(((k, counts.get(k, 0)) for k in keys), key=lambda x: -x[1])[:5]
    dim, matched, total, _ex = dimension_of(keys, universe)
    mine = universe['where'].get(str(prov.key)) or []
    if dim and mine:
        mypaths = [p for p, _n in mine]
        if dim not in mypaths and universe['leaf'].get(str(prov.key)):
            # The name is also used as a KEY somewhere in telemetry (an item name under
            # bot.inventory, say). Then it belongs to a vocabulary of names, not to one field,
            # and "it is a value of a different path" is an accident of the window.
            return dict(ctl, verdict='ZERO_ALIVE', value=_plain(value),
                        control=[(_plain(k), n) for k, n in live],
                        control_why='name-is-also-a-live-key-elsewhere',
                        note=('%r is absent from this %s, but it is a live KEY on %d rows of '
                              'real telemetry, so it is a name from a shared vocabulary rather '
                              'than the wrong dimension -- NOT proven dead'
                              % (prov.key, prov.kind, universe['leaf'][str(prov.key)])))
        if dim not in mypaths and any(same_vocabulary(dim, p, universe) for p in mypaths):
            return dict(ctl, verdict='ZERO_ALIVE', value=_plain(value),
                        control=[(_plain(k), n) for k, n in live],
                        control_why='overlapping-vocabulary-%s' % dim,
                        note=('%r is a value of %s while this %s is keyed by %s -- but those '
                              'two paths share a vocabulary, so the key CAN occur here and a '
                              'zero is not proof' % (prov.key, mypaths[0], prov.kind, dim)))
        if dim not in mypaths:
            return dict(ctl, verdict='DEAD_WRONG_DIMENSION', value=_plain(value),
                        control=[(_plain(k), n) for k, n in live],
                        control_why='container-is-keyed-by-%s' % dim,
                        note=('%r is a live value of %s (%d rows) but this %s is keyed by %s '
                              '(%d of %d keys are live %s values). A %s name asked of a %s '
                              'container can never match'
                              % (prov.key, mine[0][0], mine[0][1], prov.kind, dim, matched,
                                 total, dim, mine[0][0].rsplit('.', 1)[-1],
                                 dim.rsplit('.', 1)[-1])))
        return dict(ctl, verdict='ZERO_ALIVE', value=_plain(value),
                    control=[(_plain(k), n) for k, n in live],
                    control_why='same-dimension-%s' % dim,
                    note=('%r is a valid %s that did not occur in this window -- a finding, '
                          'not a bug' % (prov.key, dim)))
    comp = _components(keys, prov.key)
    if comp:
        cc = sorted(((k, counts.get(k, 0)) for k in comp), key=lambda x: -x[1])[:4]
        return dict(ctl, verdict='DEAD_COMPOSITE_KEY', value=_plain(value),
                    control=[(_plain(k), n) for k, n in cc],
                    control_why='composite-keys-contain-it-as-a-component',
                    note=('%r is an exact component of %d live key(s) in this %s but never a '
                          'key itself -- a bare name indexing a composite key space'
                          % (prov.key, len(comp), prov.kind)))
    und = _underscore(keys, prov.key)
    if und:
        uu = sorted(((k, counts.get(k, 0)) for k in und), key=lambda x: -x[1])[:4]
        return dict(ctl, verdict='DEAD_UNDERSCORE_CONVENTION', value=_plain(value),
                    control=[(_plain(k), n) for k, n in uu],
                    control_why='same-name-modulo-leading-underscore',
                    note=("%r differs from a live key only by the logEvent '_' convention "
                          '(logEvent kind x is skill.name _x)' % (prov.key,)))
    sub = _substrings(keys, prov.key)
    if sub:
        return dict(ctl, verdict='SUSPECT_SUBSTRING', value=_plain(value),
                    control=[(_plain(k), counts.get(k, 0)) for k in sub[:4]],
                    control_why='resembles-a-live-key',
                    note=('%r is a substring of a live key but not a component of one. '
                          'Resemblance is not proof -- reported, not raised' % (prov.key,)))
    return dict(ctl, verdict='ZERO_ALIVE', value=_plain(value),
                control=[(_plain(k), n) for k, n in live],
                control_why='key-absent-from-a-live-container',
                note=('%r is absent from a populated %s and its name is not a live value '
                      'anywhere in this window -- consistent with a genuine zero, NOT proven '
                      'dead' % (prov.key, prov.kind)))


def _plain(v):
    if isinstance(v, tuple):
        return '(' + ', '.join(str(x) for x in v) + ')'
    if isinstance(v, DeadInt):
        return int(v)
    if isinstance(v, DeadFloat):
        return float(v)
    if isinstance(v, dict):
        return {str(k): _plain(x) for k, x in list(v.items())[:12]}
    return v


# ------------------------------------------------------- case (a): the row key, from data

def row_key_literals(path):
    """String literals used as a key: `x['k']` and `x.get('k')`, with the receiver text. Source
    reading, used ONLY to ask real data a question -- never to reach a verdict alone."""
    try:
        tree = ast.parse(open(path).read())
    except Exception:
        return {}
    out = {}
    for node in ast.walk(tree):
        lit = recv = None
        if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant) \
                and isinstance(node.slice.value, str):
            lit, recv = node.slice.value, node.value
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                and node.func.attr == 'get' and node.args \
                and isinstance(node.args[0], ast.Constant) \
                and isinstance(node.args[0].value, str):
            lit, recv = node.args[0].value, node.func.value
        if lit:
            try:
                rtxt = ast.unparse(recv)
            except Exception:
                rtxt = '?'
            out.setdefault(lit, (node.lineno, rtxt))
    return out


def masked_lookups(path):
    """{(lineno, literal)} for lookups whose deadness a live branch already covers: any
    `.get(lit)`/`[lit]` that is a NON-FIRST operand of an `or` chain, or that carries a truthy
    default. Those cannot make a field zero, so they are reported and never raised."""
    try:
        tree = ast.parse(open(path).read())
    except Exception:
        return set()
    out = set()

    def lits(node):
        found = set()
        for n in ast.walk(node):
            if isinstance(n, ast.Subscript) and isinstance(n.slice, ast.Constant) \
                    and isinstance(n.slice.value, str):
                found.add((n.lineno, n.slice.value))
            elif isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) \
                    and n.func.attr == 'get' and n.args \
                    and isinstance(n.args[0], ast.Constant) \
                    and isinstance(n.args[0].value, str):
                found.add((n.lineno, n.args[0].value))
                if len(n.args) > 1 and isinstance(n.args[1], ast.Constant) \
                        and n.args[1].value not in (None, 0, '', False):
                    out.add((n.lineno, n.args[0].value))
        return found

    def is_live_alternative(node):
        # `x or ''` has NO live alternative -- that is the pre-fix depositread, and it shipped.
        # `x or y.get(...)` does. A falsy constant is a default, not a second instrument.
        if isinstance(node, ast.Constant):
            return bool(node.value)
        return not (isinstance(node, (ast.Dict, ast.List, ast.Tuple)) and not
                    getattr(node, 'elts', getattr(node, 'keys', [1])))

    for n in ast.walk(tree):
        if isinstance(n, ast.BoolOp) and isinstance(n.op, ast.Or) and len(n.values) > 1:
            # POSITION DOES NOT MATTER. lavaread.py:41 reads the dead `outcome` FIRST and the
            # live `skill` second; the expression is covered either way. What matters is
            # whether ANOTHER operand is a live alternative rather than a falsy default.
            for i, operand in enumerate(n.values):
                if any(is_live_alternative(o) for j, o in enumerate(n.values) if j != i):
                    out |= lits(operand)
        # A truthy default masks the miss wherever it appears, not only inside an `or`.
        elif isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) \
                and n.func.attr == 'get' and len(n.args) > 1 \
                and isinstance(n.args[0], ast.Constant) and isinstance(n.args[0].value, str) \
                and isinstance(n.args[1], ast.Constant) \
                and n.args[1].value not in (None, 0, '', False):
            out.add((n.lineno, n.args[0].value))
    return out


def variants(name):
    out = {re.sub(r'(?<!^)(?=[A-Z])', '_', name).lower(), name.lower(), name.lstrip('_'),
           '_' + name}
    parts = name.split('_')
    out.add(parts[0] + ''.join(p.title() for p in parts[1:]))
    out.discard(name)
    return {v for v in out if v}


def wrong_row_keys(path, universe, masked=frozenset()):
    """A literal that is absent from EVERY real row while a spelling variant of it is present.
    `failClass` vs `fail_class` is exactly this, and the evidence is row counts.

    Scoped hard to keep it honest: the literal must be absent as a key AND as a value, the
    variant must be present as a KEY (not a value), and the receiver must look like a row
    object rather than a local dict -- a local counter indexed by 'ok' is not an instrument.
    """
    leaf, vocab = universe['leaf'], universe['where']
    out = []
    for lit, (line, recv) in sorted(row_key_literals(path).items()):
        if lit in leaf or lit in vocab:
            continue
        if not re.search(r"\b(r|row|d|sk|raw|bot|rec|ev|e)\b|\['raw'\]|\['skill'\]|\['bot'\]",
                         recv or ''):
            continue
        for v in sorted(variants(lit)):
            if leaf.get(v, 0) > 0:
                out.append({'verdict': ('MASKED_DEAD_LOOKUP' if (line, lit) in masked
                                        else 'DEAD_WRONG_ROW_KEY'),
                            'field': '(row key %r)' % lit,
                            'key': lit, 'where': '%s:%d' % (os.path.basename(path), line),
                            'recv': recv, 'control': [(v, leaf[v])],
                            'control_why': 'the-variant-is-live-as-a-row-key',
                            'note': ('%s[%r] -- %r is a key on 0 real rows while %r is a key '
                                     'on %d. The key name, not the fleet'
                                     % (recv, lit, lit, v, leaf[v]))})
                break
    return out


# ------------------------------------------------- prose predicates, verified against details
# THE LARGEST DEAD-FIELD RISK IN THESE SCRIPTS IS NOT A CONTAINER KEY (independent review,
# 2026-09-23). It is `'fell' in det`, `'drown' in det`, `'sealed' in det`, `startswith('you are
# carrying')`, `re.search(r'blocks (\d+)', det)` -- a sentence the bot source can reword at any
# time, feeding a gate. A key-space witness is blind to every one of them. But real telemetry is
# not: a literal that matches 0 of N real detail strings cannot make its field non-zero, and
# that is a measurement, not an opinion.

def prose_literals(path):
    """(literal, lineno, how) for every literal tested against a detail string."""
    try:
        tree = ast.parse(open(path).read())
    except Exception:
        return []
    def isdet(node):
        try:
            t = ast.unparse(node)
        except Exception:
            return False
        return bool(re.search(r"\b(det|detail|msg|txt|s)\b|\['detail'\]", t))
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Compare) and len(n.ops) == 1 and isinstance(n.ops[0], ast.In) \
                and isinstance(n.left, ast.Constant) and isinstance(n.left.value, str) \
                and isdet(n.comparators[0]):
            out.append((n.left.value, n.lineno, 'in'))
        elif isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) \
                and n.func.attr in ('startswith', 'endswith') and isdet(n.func.value):
            for arg in n.args[:1]:
                vals = [arg] if isinstance(arg, ast.Constant) else \
                    (arg.elts if isinstance(arg, ast.Tuple) else [])
                for c in vals:
                    if isinstance(c, ast.Constant) and isinstance(c.value, str):
                        out.append((c.value, n.lineno, n.func.attr))
        elif isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) \
                and n.func.attr in ('search', 'match', 'findall') and n.args \
                and isinstance(n.args[0], ast.Constant) \
                and isinstance(n.args[0].value, str) and len(n.args) > 1 and isdet(n.args[1]):
            out.append((n.args[0].value, n.lineno, 're.' + n.func.attr))
    return out


def prose_findings(path, universe):
    """Count each detail literal against every real detail string in the window."""
    lits = prose_literals(path)
    if not lits:
        return [], []
    details = universe['details']
    hits, dead = [], []
    for lit, line, how in lits:
        if how.startswith('re.'):
            try:
                rx = re.compile(lit)
                n = sum(1 for d in details if rx.search(d))
            except re.error:
                continue
        elif how == 'startswith':
            n = sum(1 for d in details if d.startswith(lit))
        elif how == 'endswith':
            n = sum(1 for d in details if d.endswith(lit))
        else:
            n = sum(1 for d in details if lit in d)
        (hits if n else dead).append({'literal': lit, 'how': how, 'matches': n,
                                      'where': '%s:%d' % (os.path.basename(path), line)})
    out = []
    for d in dead:
        out.append({'verdict': 'PROSE_LITERAL_NEVER_MATCHES',
                    'field': '(prose %r)' % d['literal'],
                    'key': d['literal'], 'where': d['where'], 'via': d['how'],
                    'control': [(h['literal'], h['matches']) for h in
                                sorted(hits, key=lambda x: -x['matches'])[:3]],
                    'control_why': 'same-method-same-corpus-these-literals-DID-match',
                    'note': ('%r (%s) matches 0 of %d real detail strings in this window. If '
                             'it is one branch of an OR the field is still alive; if it is the '
                             'only predicate behind a field, that field is a hard zero. This '
                             'audit does not trace which, so it reports and does not raise'
                             % (d['literal'], d['how'], len(details)))})
    return out, hits


# ------------------------------------------------------- case (a): row keys, seen at runtime

def row_key_findings(universe, masked=frozenset(), sites=None):
    """A key read from a row that NO instrumented row carried. Positive control: the keys the
    same rows answered to, with hit counts."""
    out = []
    for (kind, key), miss in sorted(ROW_MISSES.items(), key=lambda x: -x[1]):
        if ROW_HITS.get((kind, key), 0):
            continue
        ctl = [(k[1], n) for k, n in ROW_HITS.most_common(6) if k[0] == kind][:4]
        if not ctl:
            continue          # no control available on that row kind -- refuse to claim
        where_lines = sorted((sites or {}).get((kind, key), ()))
        masked_here = bool(where_lines) and all(
            (ln, key) in masked for _f, ln in where_lines)
        extra = ''
        if kind == 'row' and universe['leaf'].get(key):
            extra = (' It IS a key on the RAW payload (%d rows), so this is the normalised row '
                     'being asked a raw-payload question.' % universe['leaf'][key])
        loc = ', '.join('%s:%d' % (f, ln) for f, ln in where_lines) or 'unknown line'
        out.append({'verdict': ('MASKED_DEAD_LOOKUP' if masked_here else 'DEAD_WRONG_ROW_KEY'),
                    'field': '(%s key %r)' % (kind, key),
                    'key': key, 'where': '%s, read %d times' % (loc, miss),
                    'via': '%s.get()' % kind,
                    'control': ctl, 'control_why': 'keys-the-same-rows-DID-carry',
                    'note': ('%r was read %d times from the %s and was present 0 times.%s%s'
                             % (key, miss, kind, extra,
                                ('  A LIVE BRANCH IS TRIED FIRST at %s, so this dead lookup '
                                 'cannot make a field zero -- reported, not raised.' % loc)
                                if masked_here else ''))})
    return out


# --------------------------------------------------------------------------- running a read

class Capture:
    def __init__(self):
        self.calls = []

    def emit(self, name, window_min, fields, **kw):
        # NOTHING IS WRITTEN. The real emit re-reads the LIVE manifest and writes
        # ~/digest/reads/<run_id>-<read>-<W>.json under the live run id, so an audit that let
        # it through could overwrite a real canary's evidence with dry-run numbers.
        for v in (fields or {}).values():
            p = getattr(v, '_prov', None)
            if p is not None:
                p.freeze()
        self.calls.append({'read': name, 'window_min': window_min, 'fields': dict(fields)})
        return '<fieldaudit: not written>'


class WriteRefused(PermissionError):
    pass


def _guarded_open(real_open, allow_dir, log):
    def opener(file, mode='r', *a, **kw):
        if any(c in str(mode) for c in 'waxt+') and not str(mode).strip() in ('r', 'rb', 'rt'):
            if any(c in str(mode) for c in 'wax+'):
                p = os.path.abspath(str(file))
                if not (allow_dir and p.startswith(allow_dir)):
                    log.append((p, str(mode)))
                    raise WriteRefused('fieldaudit refuses a write to %s (mode %r): an audit '
                                       'must not leave anything behind' % (p, mode))
        return real_open(file, mode, *a, **kw)
    return opener


def run_script(path, window, dryrun=None):
    """Execute a read script with instrumented containers, a captured emit and a write guard."""
    cap = Capture()
    fake = type(sys)('readjson')
    fake.emit = cap.emit
    writes = []
    saved = {'C': collections.Counter, 'D': collections.defaultdict, 'argv': sys.argv[:],
             'rj': sys.modules.get('readjson'), 'out': sys.stdout,
             'open': builtins.open, 'dry': os.environ.get('CANARY_DRYRUN')}
    LEDGER.__init__()
    err = None
    out = io.StringIO()
    try:
        collections.Counter = AuditCounter
        collections.defaultdict = AuditDefaultDict
        sys.modules['readjson'] = fake
        if saved['rj'] is not None:
            saved['rj_emit'] = getattr(saved['rj'], 'emit', None)
            saved['rj'].emit = cap.emit          # belt and braces: an already-imported module
        sys.argv = [path, str(window)]
        if dryrun:
            os.environ['CANARY_DRYRUN'] = dryrun
        builtins.open = _guarded_open(saved['open'], None, writes)
        sys.stdout = out
        LEDGER.enabled = True
        g = {'__name__': '__main__', '__file__': path, '__builtins__': builtins}
        with saved['open'](path) as fh:
            src = fh.read()
        exec(compile(src, path, 'exec'), g)
    except SystemExit as e:
        err = 'SystemExit: %s' % (e.code,)
    except AuditIncomplete:
        # The memory ceiling must NOT be swallowed as "this read failed". It is the audit
        # refusing to continue, and it has to reach the operator.
        raise
    except BaseException:
        err = traceback.format_exc(limit=8)
    finally:
        LEDGER.enabled = False
        collections.Counter = saved['C']
        collections.defaultdict = saved['D']
        sys.argv = saved['argv']
        sys.stdout = saved['out']
        builtins.open = saved['open']
        if saved['rj'] is None:
            sys.modules.pop('readjson', None)
        else:
            sys.modules['readjson'] = saved['rj']
            if saved.get('rj_emit') is not None:
                saved['rj'].emit = saved['rj_emit']
        if saved['dry'] is None:
            os.environ.pop('CANARY_DRYRUN', None)
        else:
            os.environ['CANARY_DRYRUN'] = saved['dry']
    return {'cap': cap, 'error': err, 'stdout': out.getvalue(), 'writes': writes,
            'misses': len(LEDGER.misses), 'empty_buckets': LEDGER.empty_buckets}


# --------------------------------------------------------------------------- consumption

CRITICAL = ('primary', 'own_line', 'exposure', 'mechanism', 'change_row', 'friction',
            'linkage')


def consumed_fields(reg_dir):
    """Which emitted fields the gate reads, keyed by (read, field) -- never by field name
    alone, because two reads can emit the same name (Codex). Roles carried through so a dead
    `primary` outranks a dead `watch`."""
    out = {}
    for f in sorted(glob.glob(os.path.join(os.path.expanduser(reg_dir), '*.json'))):
        try:
            r = json.load(open(f))
        except Exception:
            continue
        run = os.path.basename(f)[:-5]

        def add(d, role):
            if isinstance(d, dict) and d.get('field'):
                out.setdefault((d.get('read'), d['field']), []).append(
                    (run, role, d.get('on_fail') or ''))
        add(r.get('primary'), 'primary')
        add(r.get('exposure'), 'exposure')
        add(r.get('mechanism_check'), 'mechanism')
        for k, role in (('own_lines', 'own_line'), ('watch', 'watch'),
                        ('change_rows', 'change_row'), ('friction', 'friction'),
                        ('linkage_extra', 'linkage')):
            for d in (r.get(k) or []):
                add(d, role)
    return out


# --------------------------------------------------------------------------- audit + report

def audit(paths, window, universe, reg, dryrun=None):
    results = []
    for p in paths:
        ROW_HITS.clear()
        ROW_MISSES.clear()
        ROW_SITES.clear()
        masked = masked_lookups(p)
        t0 = dt.datetime.now()
        r = run_script(p, window, dryrun=dryrun)
        secs = (dt.datetime.now() - t0).total_seconds()
        prose, prose_ok = prose_findings(p, universe)
        entry = {'script': p, 'name': os.path.basename(p)[:-3], 'error': r['error'],
                 'misses': r['misses'], 'empty_buckets': r['empty_buckets'],
                 'writes': r['writes'], 'emits': [], 'prose_alive': prose_ok,
                 'seconds': round(secs, 1), 'rss_gb': round(rss_gb(), 2),
                 'row_key_findings': (row_key_findings(universe, masked, ROW_SITES)
                                      + wrong_row_keys(p, universe, masked) + prose)}
        for call in r['cap'].calls:
            fields = []
            for fname, fval in call['fields'].items():
                v = classify(fval, universe)
                v['field'] = fname
                cons = reg.get((call['read'], fname)) or []
                v['consumed_by'] = cons
                v['critical'] = any(role in CRITICAL for _r, role, _o in cons)
                fields.append(v)
            entry['emits'].append({'read': call['read'], 'window_min': call['window_min'],
                                   'fields': fields})
        if not r['cap'].calls and not r['error']:
            entry['no_emission'] = True     # exit 0 and no fields is not a clean read
        results.append(entry)
    return results


def tally(results):
    dead, suspect, incomplete, alive, zero = [], [], [], 0, 0
    for e in results:
        for f in e['row_key_findings']:
            if f['verdict'] in DEAD:
                dead.append((e['name'], f))
            else:
                suspect.append((e['name'], f))
        if e['error']:
            incomplete.append((e['name'], 'did not run: %s'
                               % e['error'].strip().splitlines()[-1][:160]))
        if e.get('no_emission'):
            incomplete.append((e['name'], 'ran to completion and emitted NO fields -- the '
                                          'gate would read nothing'))
        if e['writes']:
            incomplete.append((e['name'], 'attempted %d file write(s), refused: %s'
                               % (len(e['writes']), e['writes'][0][0])))
        if e['empty_buckets']:
            incomplete.append((e['name'], '%d empty bucket(s) created by a lookup; the sum of '
                                          'an empty bucket is an untainted 0 this audit cannot '
                                          'attribute' % e['empty_buckets']))
        for em in e['emits']:
            for f in em['fields']:
                if f['verdict'] in DEAD:
                    dead.append((e['name'], f))
                elif f['verdict'] in SUSPECT:
                    suspect.append((e['name'], f))
                elif f['verdict'] == 'ALIVE':
                    alive += 1
                else:
                    zero += 1
    return dead, suspect, incomplete, alive, zero


def render(results, universe, window, reads_dir_delta):
    w = sys.stdout.write
    dead, suspect, incomplete, alive, zero = tally(results)
    w('fieldaudit %s -- window %d min\n'
      % (dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), window))
    # POSITIVE CONTROL FIRST AND ALWAYS, including on a clean run: a report that says only
    # "clean" is indistinguishable from an instrument that could not see anything.
    w('POSITIVE CONTROL: %d real rows / %d bots / %.1f h span / %d distinct key paths / '
      '%d distinct values indexed\n'
      % (universe['rows'], universe['bots'], universe['span_h'], len(universe['paths']),
         len(universe['where'])))
    w('  live row keys: %s\n'
      % ', '.join('%s=%d' % (k, universe['leaf'][k]) for k in
                  ('name', 'status', 'fail_class', 'detail', 'pos', 'inventory', 'version')
                  if universe['leaf'].get(k)))
    for p in ('skill.status', 'skill.fail_class'):
        c = universe['values'].get(p)
        if c:
            w('  %s vocabulary: %s\n'
              % (p, ', '.join('%s=%d' % (k, n) for k, n in c.most_common(6))))
    w('  fields: ALIVE %d, genuine zero %d, DEAD %d, SUSPECT %d, incomplete notes %d\n'
      % (alive, zero, len(dead), len(suspect), len(incomplete)))
    w('  reads dir unchanged by this audit: %s\n' % ('yes' if not reads_dir_delta else
                                                     'NO -- %s' % reads_dir_delta))
    for e in results:
        w('\n=== %s\n' % e['name'])
        if e['error']:
            w('  DID NOT RUN (not certified): %s\n' % e['error'].strip().splitlines()[-1][:200])
        w('  read-misses %d, empty buckets created %d, writes refused %d, %.1fs, %.1f GB\n'
          % (e['misses'], e['empty_buckets'], len(e['writes']), e.get('seconds', 0),
             e.get('rss_gb', 0)))
        if e.get('prose_alive'):
            w('  prose literals that DO match real details: %s\n'
              % ', '.join('%r=%d' % (h['literal'], h['matches'])
                          for h in sorted(e['prose_alive'], key=lambda x: -x['matches'])[:6]))
        for f in e['row_key_findings']:
            w('  [%s] %s\n           %s\n           POSITIVE CONTROL (%s): %s\n'
              % (f['verdict'], f['where'], f['note'], f['control_why'],
                 ', '.join('%s on %d rows' % (k, n) for k, n in f['control'])))
        for em in e['emits']:
            order = {v: i for i, v in enumerate(DEAD + SUSPECT + ('ZERO_ALIVE', 'ALIVE'))}
            for f in sorted(em['fields'], key=lambda x: order.get(x['verdict'], 99)):
                mark = ' **GATE:%s**' % ','.join(r for _n, r, _o in f['consumed_by']) \
                    if f['consumed_by'] else ''
                if f['verdict'] in ('ALIVE',):
                    w('  [alive]  %-32s = %s%s\n' % (f['field'], _short(f['value']), mark))
                elif f['verdict'] == 'ZERO_ALIVE':
                    w('  [zero]   %-32s = %s%s\n           %s\n'
                      % (f['field'], _short(f['value']), mark, f['note']))
                else:
                    w('  [%s] %s%s\n' % (f['verdict'], f['field'], mark))
                    w('           value %s; lookup %r via %s at %s\n'
                      % (_short(f['value']), f.get('key'), f.get('via'), f.get('where')))
                    w('           %s\n' % f['note'])
                    w('           POSITIVE CONTROL (%s): %s\n'
                      % (f.get('control_why'),
                         ', '.join('%s=%s' % (k, n) for k, n in (f.get('control') or []))
                         or 'none available'))
    if suspect:
        w('\nSUSPECT (reported, NOT proven dead, NOT evidence for a revert):\n')
        for name, f in suspect:
            w('  %s.%s %s -- %s\n' % (name, f['field'], f['verdict'], f['note'][:150]))
    if incomplete:
        w('\nNOT CERTIFIED:\n')
        for name, why in incomplete:
            w('  %s: %s\n' % (name, why))
    return dead, suspect, incomplete


def _short(v):
    s = json.dumps(v, default=str) if isinstance(v, (dict, list)) else str(v)
    return s if len(s) <= 64 else s[:61] + '...'


def dead_lines(dead):
    out = []
    for name, f in dead:
        ctl = ', '.join('%s=%s' % (k, n) for k, n in (f.get('control') or [])) or 'none'
        out.append('%s.%s: %s -- lookup %r at %s; positive control (%s): %s%s'
                   % (name, f.get('field'), f['verdict'], f.get('key'), f.get('where'),
                      f.get('control_why'), ctl,
                      '  [CONSUMED BY THE GATE]' if f.get('critical') else ''))
    return out


# --------------------------------------------------------------------------- self-test
# Nine planted fixtures. The first reproduces BOTH original faults together, which is the case
# a sibling-substring rule would have missed (Codex pass 1) and the only one that proves this
# audit would have caught the bug that shipped.

FIXTURES = {
    # 1. THE ORIGINAL BUG, both faults: the wrong row key collapses every outcome to a bare
    #    status, and then a fail_class name is asked of that status-keyed container.
    'orig_both_faults': ('''
from collections import Counter, defaultdict
from readjson import emit
rows = [{'skill': {'status': s, 'fail_class': f}} for s, f in
        [('success', None)] * 40 + [('no_effect', 'skill_error')] * 9 +
        [('failed', 'storage_full')] * 6]
cls = defaultdict(Counter); runs = Counter()
for r in rows:
    sk = r['skill']; st = sk.get('status') or '?'; fc = sk.get('failClass') or ''
    runs['canary'] += 1; cls['canary'][f"{st}{('/' + fc) if fc else ''}"] += 1
emit('fx1', 30, {'skill_error_share': cls['canary']['skill_error'] / runs['canary'],
                 'runs': runs['canary']})
''', {'skill_error_share': 'DEAD_WRONG_DIMENSION', 'runs': 'ALIVE'}),

    # 2. Only the composite fault: the key space IS composite, so the component witness fires.
    'composite_only': ('''
from collections import Counter, defaultdict
from readjson import emit
cls = defaultdict(Counter); runs = Counter()
for i in range(60):
    st = 'success' if i % 4 else 'no_effect'
    fc = 'skill_error' if i % 4 == 0 else ''
    runs['c'] += 1; cls['c'][st + (('/' + fc) if fc else '')] += 1
emit('fx2', 30, {'skill_error_share': cls['c']['skill_error'] / runs['c'],
                 'success_share': cls['c']['success'] / runs['c']})
''', {'skill_error_share': 'DEAD_COMPOSITE_KEY', 'success_share': 'ALIVE'}),

    # 3. A valid category that simply did not occur, beside a live sibling. MUST NOT raise.
    'genuine_zero': ('''
from collections import Counter, defaultdict
from readjson import emit
fcls = defaultdict(Counter)
for i in range(40):
    fcls['c']['skill_error' if i % 2 else 'storage_full'] += 1
emit('fx3', 30, {'never_happened': fcls['c']['deposit_item_missing'],
                 'did_happen': fcls['c']['skill_error']})
''', {'never_happened': 'ZERO_ALIVE', 'did_happen': 'ALIVE'}),

    # 4. The logEvent underscore convention.
    'underscore': ('''
from collections import Counter
from readjson import emit
k = Counter()
for i in range(30): k['_tool_broke'] += 1
emit('fx4', 30, {'broke': k['tool_broke'], 'broke_right': k['_tool_broke']})
''', {'broke': 'DEAD_UNDERSCORE_CONVENTION', 'broke_right': 'ALIVE'}),

    # 5. `.get(key, 0)`, which never calls __missing__.
    'get_default': ('''
from collections import Counter, defaultdict
from readjson import emit
cls = defaultdict(Counter)
for i in range(30): cls['c']['success/skill_error' if i % 3 else 'success'] += 1
emit('fx5', 30, {'via_get': cls['c'].get('skill_error', 0) / 30.0})
''', {'via_get': 'DEAD_COMPOSITE_KEY'}),

    # 6. A dead numerator surviving a DiD: the taint must cross two subtractions.
    'did_chain': ('''
from collections import Counter, defaultdict
from readjson import emit
c = defaultdict(Counter)
for arm in ('canary', 'control'):
    for era in ('pre', 'post'):
        for i in range(20): c[(arm, era)]['no_effect/skill_error' if i % 2 else 'success'] += 1
def rate(k): return c[k]['skill_error'] / 10.0
did = (rate(('canary', 'post')) - rate(('canary', 'pre'))) - \\
      (rate(('control', 'post')) - rate(('control', 'pre')))
emit('fx6', 30, {'did': did})
''', {'did': 'DEAD_COMPOSITE_KEY'}),

    # 7. An empty container: SUSPECT, never DEAD -- the filter may legitimately match nothing.
    'empty_container': ('''
from collections import Counter
from readjson import emit
empty = Counter()
emit('fx7', 30, {'from_empty': empty['anything']})
''', {'from_empty': 'SUSPECT_EMPTY_CONTAINER'}),

    # 8. A mere resemblance: SUSPECT, never DEAD. {'unsuccessful': n}['success'] (Codex).
    'resemblance': ('''
from collections import Counter
from readjson import emit
c = Counter()
for i in range(20): c['unsuccessfully_finished'] += 1
emit('fx8', 30, {'looks_close': c['success']})
''', {'looks_close': 'SUSPECT_SUBSTRING'}),

    # 9. An unrelated diagnostic miss beside a healthy emitted zero: must NOT be blamed.
    'unrelated_miss': ('''
from collections import Counter, defaultdict
from readjson import emit
c = defaultdict(Counter); real = Counter()
for i in range(30): c['c']['success/skill_error'] += 1
_diag = c['c']['skill_error']          # a print-only miss, never emitted
emit('fx9', 30, {'honest_zero': len([x for x in range(10) if x > 99]), 'live': real['x'] + 7})
''', {'honest_zero': 'ZERO_ALIVE', 'live': 'ALIVE'}),
}

# The self-test's own positive control: these fixtures reference names that must be live in the
# universe for dimension inference to have anything to work with. Without it, fixture 1 would
# "pass" for the wrong reason on an empty universe.
SELFTEST_NEEDS = {'skill.status': ('success', 'no_effect', 'failed'),
                  'skill.fail_class': ('skill_error', 'storage_full')}


MASK_FIXTURE = """x = sk.get('fail_class') or sk.get('failClass') or ''
y = sk.get('failClass') or ''
z = r.get('@timestamp', '')
w = (r['raw'].get('skill') or {}).get('status') or (r['raw'].get('outcome') or {}).get('status')
v = sk.get('failClass', 'dflt')
u = (r['raw'].get('outcome') or {}).get('s') or (r['raw'].get('skill') or {}).get('s')
"""


def selftest_mask():
    """The masked-fallback rule, in BOTH directions. It must call leafread's second-branch
    `failClass` masked and the pre-fix depositread's sole-source `failClass` not masked -- if it
    cannot tell those apart it either hides the bug that shipped or cries wolf about a harmless
    defensive read."""
    import tempfile
    d = tempfile.mkdtemp(prefix='fieldaudit-mask-')
    f = os.path.join(d, 'm.py')
    with open(f, 'w') as fh:
        fh.write(MASK_FIXTURE)
    got = masked_lookups(f)
    want = [((1, 'failClass'), True, 'second branch of an or -- masked'),
            ((2, 'failClass'), False, 'sole source (the bug that shipped) -- NOT masked'),
            ((3, '@timestamp'), False, 'sole expression -- NOT masked'),
            ((4, 'outcome'), True, 'second branch of an or -- masked'),
            ((5, 'failClass'), True, 'truthy default -- masked'),
            ((6, 'outcome'), True, 'FIRST branch, live alternative second -- masked'),
            ((6, 'skill'), True, 'second branch, live alternative first -- masked')]
    ok = True
    for key, exp, why in want:
        if ((key in got) != exp):
            print('SELFTEST FAIL: mask(%s) -> %s, expected %s (%s)'
                  % (key, key in got, exp, why))
            ok = False
        else:
            print('selftest ok: mask %-26s -> %-5s  %s' % (str(key), key in got, why))
    try:
        os.unlink(f)
    except OSError:
        pass
    return ok


def selftest(universe, keep=False):
    """Plant known-dead fields and require the audit to raise on each. A check that has never
    been seen to fail is not a check (CLAUDE.md), so this is the check's own mutant."""
    import tempfile
    ok = selftest_mask()
    missing = []
    for path, names in SELFTEST_NEEDS.items():
        c = universe['values'].get(path) or {}
        for n in names:
            if n not in c:
                missing.append('%s=%s' % (path, n))
    if missing:
        print('SELFTEST PRECONDITION FAILED: the universe does not contain %s, so dimension '
              'inference has nothing to infer from and fixture 1 could pass for the wrong '
              'reason. Run this where real telemetry is readable, or widen --universe-min.'
              % ', '.join(missing[:6]))
        return False
    print('selftest precondition ok: %s'
          % '; '.join('%s has %s' % (p, ','.join(n)) for p, n in SELFTEST_NEEDS.items()))
    d = tempfile.mkdtemp(prefix='fieldaudit-selftest-')
    paths, expect = [], {}
    for name, (src, exp) in FIXTURES.items():
        p = os.path.join(d, 'fx_%s.py' % name)
        with open(p, 'w') as fh:
            fh.write(src)
        paths.append(p)
        for f, v in exp.items():
            expect[(os.path.basename(p)[:-3], f)] = v
    res = audit(paths, 30, universe, {})
    got = {}
    for e in res:
        if e['error']:
            print('SELFTEST FAIL: fixture %s did not run: %s'
                  % (e['name'], e['error'].strip().splitlines()[-1]))
            ok = False
        for em in e['emits']:
            for f in em['fields']:
                got[(e['name'], f['field'])] = f
    for key, want in sorted(expect.items()):
        f = got.get(key)
        vg = f['verdict'] if f else None
        if vg != want:
            print('SELFTEST FAIL: %s.%s -> %s, expected %s'
                  % (key[0], key[1], vg, want))
            ok = False
            continue
        # Assert the ATTRIBUTION and the WITNESS, not merely that something raised (Codex).
        if want in DEAD:
            if f.get('key') is None or not f.get('control'):
                print('SELFTEST FAIL: %s.%s is %s but carries no positive control'
                      % (key[0], key[1], want))
                ok = False
                continue
            print('selftest ok: %-24s -> %-28s control %s'
                  % ('%s.%s' % (key[0].replace('fx_', ''), key[1]), want,
                     ', '.join('%s=%s' % (k, n) for k, n in f['control'][:2])))
        else:
            print('selftest ok: %-24s -> %s'
                  % ('%s.%s' % (key[0].replace('fx_', ''), key[1]), want))
    dead, suspect, incomplete, _a, _z = tally(res)
    names = ' '.join(dead_lines(dead))
    for must in ('skill_error_share', 'broke', 'via_get', 'did'):
        if must not in names:
            print('SELFTEST FAIL: planted dead field %r never reached the raise list' % must)
            ok = False
    for mustnot in ('never_happened', 'honest_zero', 'looks_close', 'from_empty'):
        if mustnot in names:
            print('SELFTEST FAIL: %r reached the raise list -- A FALSE RAISE' % mustnot)
            ok = False
    if not keep:
        for p in paths:
            try:
                os.unlink(p)
            except OSError:
                pass
    print('SELFTEST %s -- %d planted dead fields raise, %d suspects and %d genuine zeros do '
          'not' % ('PASSED' if ok else 'FAILED', len(dead), len(suspect),
                   sum(1 for e in res for em in e['emits'] for f in em['fields']
                       if f['verdict'] == 'ZERO_ALIVE')))
    return ok


# --------------------------------------------------------------------------- main

def default_targets(d):
    out = []
    for p in sorted(glob.glob(os.path.join(d, '*.py'))):
        if os.path.basename(p) in ('fieldaudit.py', 'readjson.py'):
            continue
        try:
            src = open(p).read()
        except Exception:
            continue
        if re.search(r'from readjson import emit', src):
            out.append(p)
    return out


def snapshot(d):
    try:
        return {os.path.basename(f): os.path.getmtime(f)
                for f in glob.glob(os.path.join(os.path.expanduser(d), '*'))}
    except Exception:
        return {}


def main():
    global MAX_RSS_GB, SNAP_MIN
    ap = argparse.ArgumentParser(description='raise when an emitted read field cannot be '
                                             'non-zero')
    ap.add_argument('--dir', default=SELF_DIR)
    ap.add_argument('--only', default='')
    ap.add_argument('--window', type=int, default=60,
                    help='post-window minutes handed to each read')
    ap.add_argument('--universe-min', type=int, default=0,
                    help='minutes of telemetry for the key/value universe (0 = window + 240)')
    ap.add_argument('--registrations', default='~/mcai-analysis/registrations')
    ap.add_argument('--reads-dir', default='~/digest/reads')
    ap.add_argument('--dryrun', default=None, help='CANARY_DRYRUN pool:sha:iso for the reads')
    ap.add_argument('--max-rss-gb', type=float, default=6.0)
    ap.add_argument('--snap-min', type=int, default=60,
                    help='round each read\'s requested window up to this many minutes so the '
                         'reads share one walk; 0 disables')
    ap.add_argument('--selftest', action='store_true')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()

    MAX_RSS_GB, SNAP_MIN = a.max_rss_gb, a.snap_min
    install_loader_cache()
    universe = build_universe(a.universe_min or (a.window + 240))

    if a.selftest:
        sys.exit(0 if selftest(universe) else 4)

    targets = default_targets(a.dir)
    if a.only:
        want = {x.strip() for x in a.only.split(',') if x.strip()}
        targets = [p for p in targets if os.path.basename(p)[:-3] in want]
    if not targets:
        raise AuditIncomplete('no read scripts found under %s -- an audit that audits nothing '
                              'is not a clean audit' % a.dir)
    before = snapshot(a.reads_dir)
    reg = consumed_fields(a.registrations)
    results = audit(targets, a.window, universe, reg, dryrun=a.dryrun)
    after = snapshot(a.reads_dir)
    delta = sorted(set(after) - set(before)) + \
        sorted(k for k in before if k in after and before[k] != after[k])

    if a.json:
        print(json.dumps({'universe': {k: universe[k] for k in
                                       ('rows', 'bots', 'span_h', 'window_min')},
                          'reads_dir_delta': delta, 'results': results}, default=str, indent=1))
        dead, suspect, incomplete, _a, _z = tally(results)
    else:
        dead, suspect, incomplete = render(results, universe, a.window, delta)

    if delta:
        incomplete.append(('fieldaudit', 'the reads directory CHANGED during the audit: %s'
                           % ', '.join(delta[:5])))
    if dead:
        raise FieldIsDead('%d emitted field(s) cannot be non-zero:\n  %s'
                          % (len(dead), '\n  '.join(dead_lines(dead))))
    if incomplete or suspect:
        raise AuditIncomplete(
            'no field was PROVEN dead, and %d could not be certified. This is not an '
            'allegation that anything is broken:\n  %s'
            % (len(incomplete) + len(suspect),
               '\n  '.join(['%s: %s' % (n, w) for n, w in incomplete] +
                           ['%s.%s %s' % (n, f['field'], f['verdict']) for n, f in suspect])))
    print('\nCLEAN: every emitted field is capable of being non-zero, or is a genuine zero '
          'with its container live and its dimension confirmed against real telemetry.')


if __name__ == '__main__':
    try:
        main()
    except FieldIsDead as e:
        sys.stderr.write('\nFieldIsDead: %s\n' % e)
        sys.exit(3)
    except AuditIncomplete as e:
        sys.stderr.write('\nAuditIncomplete: %s\n' % e)
        sys.exit(5)
