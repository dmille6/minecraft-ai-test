"""Elasticsearch-backed fleet telemetry: the counterpart of lib/telemetry.py for WIDE windows.

WHEN TO USE WHICH (owner decision 2026-10-14, "Yes use the elastic for analysis"):
  * analysis wider than a few hours ............ THIS module (Elasticsearch)
  * canary reads, gates, anything that decides . lib/telemetry.py (the files)

WHY ES IS TRUSTED FOR THIS. docs/reports/es-completeness-2026-10-14.md reconciled every bot-day
of 10-07..10-14 row by row: from 10-08 ES lost 344 of 8,851,670 skill rows and 59 of
1,089,658 llm rows, all in the 23:57-00:00 logrotate copytruncate race, with 0 extras and 0
mapping rejections. Its KNOWN GAPS are encoded below as guards, not as advice:

  1. 2026-10-07 holds filebeat RE-SENDS (4,633 skill + 415 llm duplicate docs after the 05:01Z
     host crash). A window touching that day is REFUSED unless gaps='allow' (counts then carry
     a caveat) or gaps='clip' (the window is moved off the day when it only touches an edge).
  2. NULL AND ABSENT ARE THE SAME IN ES. Filebeat drops null-valued keys, so "field is null"
     cannot be asked here; match={field: None} raises. Use the files for that question.
  3. Every 23:57-00:00 rotation loses ~40-60 skill / ~5-12 llm rows. Results whose window
     crosses one carry a caveat saying how many it crosses.
  4. Nothing before 10-07 was validated; llm 09-08 is missing and 09-09..09-16 was backfilled.
     Those windows carry caveats.

THE ZERO RULE IS THE SAME AS lib/telemetry.py. A zero is not returned until a positive control
says the instrument could have seen a presence: the window itself must hold documents, the
kind must not be a near-miss of a name that IS present (including the `_kind` / `kind`
underscore variant), and every filtered field must actually carry values for that kind.
Otherwise ZeroLooksWrong is raised -- the same exception class as lib/telemetry.py, so one
`except` covers both. `allow_zero=True` is for when absence IS the question.

ONE DIFFERENCE FROM lib/telemetry.py, DELIBERATE: kind names match EXACTLY. telemetry.canon()
folds `_x` into `x`, but both `town_deposit` (the skill) and `_town_deposit` (its event) exist
-- 422 and 420 docs on 10-13/14 -- and folding them double-counts. Here a miss on one form
that exists in the other form raises and names it.

NOTHING PULLS MILLIONS OF DOCS. Counts, by_bot, by_pool, terms and histograms are server-side
aggregations. rows()/where() stream with a point-in-time cursor and refuse (TooManyRows)
before reading if the match exceeds max_rows (default 200,000).

CREDENTIALS. The owner-issued read-only API key at ~/.config/mcai/es-readonly.key (mode 600)
is read at call time and sent only as `Authorization: ApiKey ...`. It is never printed,
logged, cached on disk or put on a command line.

    import sys; sys.path.insert(0, '/path/to/repo/scripts')
    from lib.estelemetry import EsEvents
    ev = EsEvents.load('skill', since_minutes=24 * 60)
    ev.count('_death')                           # zero-guarded, carries .caveats
    ev.count('gather', status='success')
    ev.by_pool('_death', match={'skill.fail_class': 'drowning'})
    ev.histogram('_death', interval='1h', split='exp.pool')
    ev.rate('_death', bots='auto')               # per bot-hour; bots= is REQUIRED
    ev.latest(require='bot.pos.x', fields=['bot.inventory', 'exp.pool'])   # NOT bot.inventory: see latest()
"""
import base64
import datetime as dt
import difflib
import json
import os
import stat
import urllib.error
import urllib.parse
import urllib.request

try:                                    # the SAME class lib/telemetry.py raises
    from lib.telemetry import ZeroLooksWrong
except Exception:                       # pragma: no cover - imported without the package path
    try:
        from telemetry import ZeroLooksWrong
    except Exception:
        class ZeroLooksWrong(LookupError):
            """A zero that is probably a query bug rather than a finding."""

ES_URL = os.environ.get('MCAI_ES_URL', 'http://10.0.0.186:9200')
KEY_FILE = os.environ.get('MCAI_ES_KEYFILE', '~/.config/mcai/es-readonly.key')

STREAMS = {
    'skill': {'index': 'mcai-skill-agents', 'kind': 'skill.name', 'status': 'skill.status'},
    'llm': {'index': 'mcai-llm-agents', 'kind': 'trigger', 'status': 'outcome.status'},
}

# (start, end, streams, action, text). action 'refuse' -> gaps='raise' refuses the window.
KNOWN_GAPS = (
    ('2026-10-07T00:00:00Z', '2026-10-08T00:00:00Z', ('skill', 'llm'), 'refuse',
     '2026-10-07 holds filebeat re-sends after the 05:01Z host crash (4,633 skill + 415 llm '
     'duplicate docs; exact doubles 00:00-05:01 on placebo-a-Comet, isolated-c-Echo, llm '
     'placebo-b-Bravo; partial extras at 05:00-05:01 and 11:55). Exclude the day, or use the files.'),
    ('2026-09-08T00:00:00Z', '2026-09-09T00:00:00Z', ('llm',), 'caveat',
     'llm 2026-09-08 is MISSING from ES (strict-mapping rejection of llm.args_cleaned; '
     'unrecoverable).'),
    ('2026-09-09T00:00:00Z', '2026-09-17T00:00:00Z', ('llm',), 'caveat',
     'llm 2026-09-09..09-16 was BACKFILLED from rotated files (infra/elk/llm-backfill.py), '
     'not shipped live; never reconciled.'),
    ('2000-01-01T00:00:00Z', '2026-10-07T00:00:00Z', ('skill', 'llm'), 'caveat',
     'before 2026-10-07 ES completeness was NOT validated (docs/reports/es-completeness-2026-10-14.md '
     'covers 10-07..10-14); run scripts/host/escheck/run.sh while the files still exist.'),
)
VALIDATED_UNTIL = '2026-10-14T18:46:00Z'
ROTATION_LOSS = {'skill': '~40-60', 'llm': '~5-12'}
INGEST_LAG_S = 240        # max observed ES lag 2026-10-14 was 201 s (llm); p90 ~35 s
MAX_ROWS = 200_000
MISSING = '<missing>'
DETAIL_CAVEAT = ("detail_contains is a TOKEN phrase match on analysed text, not a substring search: "
                 "'water' does not match water_bucket or underwater (the files' `'water' in detail` would).")


class EsError(RuntimeError):
    pass


class ReplayWindow(ValueError):
    """The window touches a day ES is known to hold duplicate docs for."""


class TooManyRows(MemoryError):
    """rows()/where() would pull more documents than max_rows; aggregate instead."""


class Count(int):
    """An int that remembers what it was measured over."""
    def __new__(cls, value, caveats=(), control=None):
        o = int.__new__(cls, value)
        o.caveats = list(caveats)
        o.control = control or {}
        return o


class Agg(dict):
    """A dict result (bucket -> count) that carries the window's caveats."""
    def __init__(self, data=(), caveats=(), control=None):
        super().__init__(data)
        self.caveats = list(caveats)
        self.control = control or {}


# ------------------------------------------------------------------------------- transport
def _auth_header():
    path = os.path.expanduser(KEY_FILE)
    try:
        st = os.stat(path)
    except FileNotFoundError:
        raise EsError(f'{path} does not exist (the read-only API key; run on 10.0.0.31)')
    if st.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise EsError(f'{path} is readable by group/other; refusing to use it (expected mode 600)')
    with open(path) as fh:
        raw = fh.read().strip()
    if not raw:
        raise EsError(f'{path} is empty')
    if ':' in raw:                       # id:api_key on disk -> base64 for the header
        raw = base64.b64encode(raw.encode()).decode()
    return 'ApiKey ' + raw


def check_reply(path, d):
    """A PARTIAL ANSWER IS NOT AN ANSWER (the guards scripts/lib/es.py earned)."""
    if isinstance(d, dict):
        if 'error' in d:
            e = d['error']
            raise EsError(f'{path}: {e.get("reason") if isinstance(e, dict) else e}')
        if d.get('timed_out'):
            raise EsError(f'{path}: TIMED OUT -- partial result, not a count')
        sh = d.get('_shards') or {}
        if sh.get('failed'):
            raise EsError(f'{path}: {sh["failed"]} of {sh.get("total")} shards FAILED')
        if d.get('terminated_early'):
            raise EsError(f'{path}: terminated_early')
    return d


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """urllib copies headers set with add_header -- Authorization included -- onto a redirect,
    even to another host. The cluster never redirects, so any 3xx is refused."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # the target URL is deliberately NOT echoed: it is server-controlled text
        raise EsError(f'refusing HTTP {code} redirect: the API key would follow it')


_OPENER = urllib.request.build_opener(_NoRedirect)


def _scrub(text, auth):
    """Remove the key (base64 header value and its decoded id:key form) from error text."""
    tok = auth.split(' ', 1)[1]
    out = text.replace(tok, '<redacted>')
    try:
        dec = base64.b64decode(tok).decode()
        for part in [dec] + dec.split(':'):
            if len(part) >= 8:
                out = out.replace(part, '<redacted>')
    except Exception:
        pass
    return out


def http(method, path, body=None, timeout=120):
    """Plain http: the cluster at 10.0.0.186 serves no TLS. The key never leaves this function
    except in the Authorization header, and is scrubbed from every error message."""
    url = f'{ES_URL}/{path.lstrip("/")}'
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    auth = _auth_header()
    req.add_header('Authorization', auth)
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    # SCRUB FIRST, TRUNCATE AFTER: cutting first can leave half a key that no longer matches
    # the scrub (a reviewer reproduced that), so every message is scrubbed whole.
    try:
        with _OPENER.open(req, timeout=timeout) as r:
            txt = r.read().decode()
    except urllib.error.HTTPError as e:
        raise EsError(_scrub(f'{path}: HTTP {e.code}: {e.read().decode(errors="replace")}', auth)[:400]) from None
    except Exception as e:                       # URLError, our redirect refusal, timeouts
        raise EsError(_scrub(f'{path}: {getattr(e, "reason", e)}', auth)[:400]) from None
    try:
        d = json.loads(txt)
    except Exception:
        raise EsError(_scrub(f'non-JSON reply from {path}: {txt}', auth)[:300]) from None
    try:
        return check_reply(path, d)
    except EsError as e:
        raise EsError(_scrub(str(e), auth)[:400]) from None


# ------------------------------------------------------------------------------- helpers
def _iso(t):
    return t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:23] + 'Z'


def _parse(t):
    if t is None or isinstance(t, dt.datetime):
        return t
    return dt.datetime.fromisoformat(str(t).replace('Z', '+00:00')).astimezone(dt.timezone.utc)


def rotations_crossed(since, until):
    """How many 23:57-00:00 rotation windows [since, until) overlaps."""
    n = 0
    d = since.date() - dt.timedelta(days=1)
    while dt.datetime.combine(d, dt.time(23, 57), dt.timezone.utc) < until:
        lo = dt.datetime.combine(d, dt.time(23, 57), dt.timezone.utc)
        hi = lo + dt.timedelta(minutes=4)    # losses observed 23:57:xx .. 00:00:0x
        if lo < until and hi > since:
            n += 1
        d += dt.timedelta(days=1)
    return n


def gaps_for(stream, since, until):
    out = []
    for lo, hi, streams, action, text in KNOWN_GAPS:
        lo, hi = _parse(lo), _parse(hi)
        if stream in streams and lo < until and hi > since:
            out.append((lo, hi, action, text))
    return out


def _nearby(name, names):
    """Near-misses of `name` among names that are PRESENT, underscore variant first."""
    alt = name[1:] if name.startswith('_') else '_' + name
    near = [alt] if alt in names else []
    near += [n for n in difflib.get_close_matches(name, list(names), n=4, cutoff=0.6) if n not in near]
    return [n for n in near if n != name][:4]


# ------------------------------------------------------------------------------- the reader
class EsEvents:
    def __init__(self, stream, since, until, pools=None, bots=None, version=None, caveats=(),
                 client=None, now=None):
        if stream not in STREAMS:
            raise ValueError(f'stream must be one of {sorted(STREAMS)}')
        self.stream = stream
        self.cfg = STREAMS[stream]
        self.since, self.until = since, until
        self.pools = list(pools) if pools else None
        self.bots = list(bots) if bots else None
        self.version = version
        self.caveats = list(caveats)
        self._client = client or http
        self._now = now
        self._cache = {}

    @classmethod
    def load(cls, stream='skill', since_minutes=None, since=None, until=None, pools=None,
             bots=None, version=None, gaps='raise', client=None, now=None):
        """A LAZY handle on a half-open window [since, until): nothing is fetched here.

        gaps: 'raise' (default) refuses a window touching a known replay day; 'clip' moves
        the window off it when it only touches an edge; 'allow' proceeds with a caveat.
        """
        now = _parse(now) if now else dt.datetime.now(dt.timezone.utc)
        until = _parse(until) or now
        if since_minutes is not None:
            if since is not None:
                raise ValueError('pass since OR since_minutes, not both')
            since = until - dt.timedelta(minutes=since_minutes)
        since = _parse(since)
        if since is None:
            raise ValueError('a window needs since= or since_minutes=')
        if since >= until:
            raise ValueError(f'empty window: since {_iso(since)} >= until {_iso(until)}')
        if gaps not in ('raise', 'clip', 'allow'):
            raise ValueError("gaps must be 'raise', 'clip' or 'allow'")
        caveats = []
        for lo, hi, action, text in gaps_for(stream, since, until):
            if action != 'refuse':
                caveats.append(text)
                continue
            if gaps == 'allow':
                caveats.append('INCLUDES A REPLAY DAY: ' + text)
            elif gaps == 'clip' and lo <= since < hi <= until:
                caveats.append(f'window start moved from {_iso(since)} to {_iso(hi)}: ' + text)
                since = hi
            elif gaps == 'clip' and since <= lo < until <= hi:
                caveats.append(f'window end moved from {_iso(until)} to {_iso(lo)}: ' + text)
                until = lo
            else:
                raise ReplayWindow(f'window {_iso(since)}..{_iso(until)} touches a known ES gap: {text} '
                                   f"Pass gaps='clip' or gaps='allow' if you mean it.")
            if since >= until:
                raise ReplayWindow(f'the window lies entirely inside a known ES gap: {text}')
        if until > _parse(VALIDATED_UNTIL):
            caveats.append(f'after {VALIDATED_UNTIL} completeness is assumed, not reconciled: an unclean '
                           f'filebeat restart re-sends (as on 10-07) and an unmapped field (llm.brain) rejects '
                           f'whole docs -- check the filebeat dropped counter (scripts/host/escheck/fbjournal.py).')
        n = rotations_crossed(since, until)
        if n:
            caveats.append(f'window crosses {n} log rotation(s) (23:57-00:00Z): ES is missing '
                           f'{ROTATION_LOSS[stream]} {stream} rows per rotation (copytruncate race).')
        if until > now - dt.timedelta(seconds=INGEST_LAG_S):
            caveats.append(f'window ends within {INGEST_LAG_S} s of now: ingest lag (median ~6 s, '
                           f'max ~3 min observed) can leave the newest minutes short.')
        return cls(stream, since, until, pools, bots, version, caveats, client, now)

    # -- query building -----------------------------------------------------------------
    def _filters(self, kind=None, status=None, fail_class=None, match=None, detail_contains=None):
        f = [{'range': {'@timestamp': {'gte': _iso(self.since), 'lt': _iso(self.until),
                                       'format': 'strict_date_optional_time'}}}]
        if self.pools:
            f.append({'terms': {'exp.pool': self.pools}})
        if self.bots:
            f.append({'terms': {'bot.name': self.bots}})
        if self.version:
            f.append({'bool': {'should': [{'term': {'code.version': self.version}},
                                          {'prefix': {'code.version': self.version + '+'}}],
                               'minimum_should_match': 1}})
        if kind is not None:
            f.append({'term': {self.cfg['kind']: kind}})
        for field, value in self._match(status, fail_class, match).items():
            f.append({'terms' if isinstance(value, (list, tuple)) else 'term': {field: value}})
        if detail_contains:
            if self.stream != 'skill':
                raise ValueError('detail_contains is skill.detail; llm rows have outcome.detail -- use match')
            # ANALYSED phrase match (standard analyzer): case-insensitive; punctuation splits
            # tokens, so 'usable=19' matches the adjacent tokens usable,19 and 'sable=19' does
            # NOT match. It is not a substring search -- use where() with a predicate for that.
            f.append({'match_phrase': {'skill.detail': detail_contains}})
        return f

    def _match(self, status=None, fail_class=None, match=None):
        m = dict(match or {})
        if status is not None:
            m[self.cfg['status']] = status
        if fail_class is not None:
            if self.stream != 'skill':
                raise ValueError('fail_class exists only on the skill stream')
            m['skill.fail_class'] = fail_class
        for field, value in m.items():
            if value is None:
                raise ValueError(
                    f'match {field}=None: ES cannot tell null from absent (filebeat drops null-valued '
                    f'keys). Ask the files (lib/telemetry.py) whether a field is null.')
        return m

    def _query(self, **kw):
        return {'bool': {'filter': self._filters(**kw)}}

    def _search(self, body):
        return self._client('POST', f'{self.cfg["index"]}/_search', body)

    def _count(self, query):
        return self._client('POST', f'{self.cfg["index"]}/_count', {'query': query})['count']

    @staticmethod
    def _complete(t, what):
        """A terms answer is whole only if nothing fell outside the returned buckets AND no shard
        could have under-counted a bucket. Applied to EVERY terms aggregation, nested ones too."""
        if t.get('sum_other_doc_count') or t.get('doc_count_error_upper_bound'):
            raise EsError(f'{what}: terms truncated (other={t.get("sum_other_doc_count")}, '
                          f'error bound={t.get("doc_count_error_upper_bound")}); raise size')
        return t

    def _terms(self, field, query, size=5000, missing=None):
        t = {'field': field, 'size': size}
        if missing is not None:
            t['missing'] = missing           # docs WITHOUT the field get their own bucket, so sums reconcile
        try:
            r = self._search({'size': 0, 'query': query, 'aggs': {'t': {'terms': t}}})
        except EsError as e:
            if missing is not None:
                raise EsError(f'{e} -- terms()/by_*() group KEYWORD fields only (the <missing> bucket '
                              f'needs a string-compatible field)') from None
            raise
        t = self._complete(r['aggregations']['t'], f'terms on {field}')
        return {b['key']: b['doc_count'] for b in t['buckets']}

    # -- the zero guard -----------------------------------------------------------------------
    def total(self):
        if 'total' not in self._cache:
            self._cache['total'] = self._count(self._query())
        return self._cache['total']

    def names(self):
        """{kind: docs} actually present in the window (with the pool/bot/version filters)."""
        if 'names' not in self._cache:
            self._cache['names'] = self._terms(self.cfg['kind'], self._query())
        return self._cache['names']

    def _newest(self):
        r = self._search({'size': 0, 'aggs': {'mx': {'max': {'field': '@timestamp'}}}})
        v = r['aggregations']['mx'].get('value_as_string')
        return _parse(v) if v else None

    def _field_seen(self, field, kind=None, allow_zero=False):
        """Positive control for a GROUPING or SEARCH field: some document in the window (of this
        kind, when the kind is present) must carry it, or an empty answer means nothing.
        `exists` on a flattened/object field is true only if a LEAF is indexed: an empty {} is
        not seen -- which is why snapshot selection uses an indexed marker (see latest()).
        A misspelt FIELD is never a finding, so this runs even with allow_zero -- unless the whole
        window is empty and the caller said absence is the question."""
        if allow_zero and not self.total():
            return
        if kind is not None and not self.names().get(kind):
            # The kind is absent here (a quiet window), so no document of it can vouch for the
            # field, and other kinds would vouch for the wrong population. Ask the MAPPING instead:
            # a field no backing index declares is a typo whatever the window holds.
            if not self._mapped(field):
                raise ZeroLooksWrong(f'{field!r} is not mapped in {self.cfg["index"]}: a typo, not an absence')
            return
        f = self._filters() + [{'exists': {'field': field}}]
        if kind is not None:
            f.append({'term': {self.cfg['kind']: kind}})
        if not self._count({'bool': {'filter': f}}):
            where = f'kind={kind!r}' if kind is not None and self.names().get(kind) else 'the window'
            raise ZeroLooksWrong(f'{field!r} is carried by NO document of {where}: an empty grouping '
                                 f'or search on it is the field, not the fleet (typo? always null?)')

    def _mapped(self, field):
        """Is `field` declared in any backing index? A leaf UNDER a flattened field (e.g.
        bot.inventory.cobblestone) is not listed by _field_caps, so a quiet-window grouping on one
        raises a false 'typo' -- loudly, never as a wrong number."""
        q = urllib.parse.quote(field, safe='.')
        r = self._client('GET', f'{self.cfg["index"]}/_field_caps?fields={q}', None)
        return bool((r.get('fields') or {}).get(field))

    def _zero(self, kind, status=None, fail_class=None, match=None, detail_contains=None):
        """Called on every zero before it is returned. Raises unless a positive control shows
        the same query could have seen a presence; returns the control it used."""
        total = self.total()
        if total == 0:
            newest = self._newest()
            if newest is not None and self.since > newest:
                raise ZeroLooksWrong(f'window starts {_iso(self.since)} but the newest document in '
                                     f'{self.cfg["index"]} is {_iso(newest)}: the window is in the '
                                     f'future; check the clock, not the fleet')
            raise ZeroLooksWrong(f'{kind!r}: 0, and so is EVERYTHING -- the window / pools={self.pools} / '
                                 f'bots={self.bots} / version={self.version} matched no documents at all')
        control = {'window_docs': total}
        if kind is not None:
            names = self.names()
            kind_docs = names.get(kind, 0)
            control['kind_docs'] = kind_docs
            if kind_docs == 0:
                near = _nearby(kind, names)
                if near:
                    raise ZeroLooksWrong(f'{kind!r} has 0 docs, but these exist: ' +
                                         ', '.join(f'{n} ({names[n]})' for n in near) +
                                         ' -- almost certainly the name, not the fleet')
                return control
        base = self._query(kind=kind)
        for field, value in self._match(status, fail_class, match).items():
            present = self._terms(field, base)
            control[f'{field} values'] = len(present)
            if not present:
                raise ZeroLooksWrong(f'{field} carries NO values for kind={kind!r} in this window, so '
                                     f'"{field}={value!r}: 0" cannot be a finding -- wrong field for this kind?')
            for v in (value if isinstance(value, (list, tuple)) else [value]):
                if v not in present:
                    near = _nearby(str(v), {str(k): n for k, n in present.items()})
                    if near:
                        raise ZeroLooksWrong(f'{field}={v!r} has 0 docs, but these exist: ' +
                                             ', '.join(near) + ' -- almost certainly the value')
        if detail_contains:
            self._field_seen('skill.detail', kind)
            control['detail_contains'] = 'analysed phrase match (tokens, case-insensitive), not substring'
        return control

    # -- counts ---------------------------------------------------------------------------------
    def count(self, kind, status=None, fail_class=None, match=None, detail_contains=None,
              allow_zero=False):
        n = self._count(self._query(kind=kind, status=status, fail_class=fail_class,
                                    match=match, detail_contains=detail_contains))
        cav = self.caveats + ([DETAIL_CAVEAT] if detail_contains else [])
        if n or allow_zero:
            return Count(n, cav)
        control = self._zero(kind, status, fail_class, match, detail_contains)
        if detail_contains:
            raise ZeroLooksWrong(f'detail_contains={detail_contains!r}: 0. ' + DETAIL_CAVEAT +
                                 ' Confirm with where(kind, lambda r: ... in detail) or pass allow_zero=True.')
        return Count(0, self.caveats, control)

    def bots_present(self):
        return sorted(self._terms('bot.name', self._query()))

    def span_hours(self):
        """Hours between the first and last document in the window (as lib/telemetry.py)."""
        r = self._search({'size': 0, 'query': self._query(),
                          'aggs': {'s': {'stats': {'field': '@timestamp'}}}})
        s = r['aggregations']['s']
        if not s.get('count'):
            return 0.0
        return (s['max'] - s['min']) / 3_600_000

    def newest_in_window(self):
        r = self._search({'size': 0, 'query': self._query(),
                          'aggs': {'mx': {'max': {'field': '@timestamp'}}}})
        v = r['aggregations']['mx'].get('value_as_string')
        return _parse(v) if v else None

    def coverage(self):
        """Who was actually there: {'bot_hours': the sum, over (bot, hour) pairs with >= 1 doc, of
        that hour's overlap with the window (an edge hour counts only the part inside it) -- the
        honest denominator for per-bot-hour rates when bots come and go -- 'empty_hours': whole hours
        of the window with NO document from anyone (an ingest stall or a fleet outage), and
        'newest': the newest document in the window.}"""
        r = self._search({'size': 0, 'query': self._query(), 'aggs': {'h': {
            'date_histogram': {'field': '@timestamp', 'fixed_interval': '1h', 'min_doc_count': 0,
                               'extended_bounds': {'min': _iso(self.since), 'max': _iso(self.until)}},
            'aggs': {'b': {'terms': {'field': 'bot.name', 'size': 1000}}}}}})
        pairs, empty = 0.0, []
        first_full = self.since.replace(minute=0, second=0, microsecond=0)
        if first_full < self.since:
            first_full += dt.timedelta(hours=1)
        for b in r['aggregations']['h']['buckets']:
            self._complete(b['b'], 'coverage(): bot terms')
            start = _parse(b['key_as_string'])
            lo, hi = max(start, self.since), min(start + dt.timedelta(hours=1), self.until)
            pairs += len(b['b']['buckets']) * max(0.0, (hi - lo).total_seconds() / 3600)
            if not b['doc_count'] and first_full <= start and start + dt.timedelta(hours=1) <= self.until:
                empty.append(b['key_as_string'][:13])
        # a stall shorter than an hour hides inside a non-empty hour: look at 10-minute buckets too
        r10 = self._search({'size': 0, 'query': self._query(), 'aggs': {'g': {'date_histogram': {
            'field': '@timestamp', 'fixed_interval': '10m', 'min_doc_count': 0,
            'extended_bounds': {'min': _iso(self.since), 'max': _iso(self.until)}}}}})
        gaps = []
        for b in r10['aggregations']['g']['buckets']:
            start = _parse(b['key_as_string'])
            if not b['doc_count'] and start >= self.since and start + dt.timedelta(minutes=10) <= self.until:
                gaps.append(b['key_as_string'][:16])
        return {'bot_hours': round(pairs, 3), 'empty_hours': empty, 'empty_10min': gaps,
                'newest': self.newest_in_window()}

    def rate(self, kind, bots=None, allow_zero=False, **filters):
        """Per bot-hour over the span the data covers. `bots` IS REQUIRED: it used to default
        to 40 against an 80-bot fleet in lib/telemetry.py and doubled every rate.
        bots='auto' counts the distinct bot.name values present in the window."""
        if bots is None:
            raise TypeError("rate() needs bots=N (or bots='auto'); a fleet-size default doubled "
                            "every rate once")
        span = self.span_hours()
        if span <= 0:
            raise ZeroLooksWrong('the window holds at most one document, so a rate has no span')
        if bots == 'auto':
            bots = len(self.bots_present())
        return self.count(kind, allow_zero=allow_zero, **filters) / (bots * span)

    # -- grouped aggregations ------------------------------------------------------------------
    def terms(self, field, kind=None, size=5000, allow_zero=False, **filters):
        """{value: docs} for any keyword field, server-side. Documents lacking the field are
        counted under MISSING ('<missing>'), so sum(values) == count(kind, **filters) always."""
        out = self._terms(field, self._query(kind=kind, **filters), size, missing=MISSING)
        if not out or set(out) == {MISSING}:
            self._field_seen(field, kind, allow_zero)
        if not out and not allow_zero:
            return Agg({}, self._cav(filters), self._empty(kind, filters))
        return Agg(out, self._cav(filters))

    def _cav(self, filters):
        return self.caveats + ([DETAIL_CAVEAT] if filters.get('detail_contains') else [])

    def _empty(self, kind, filters):
        """The zero rule for every API, not just count(): run the positive controls, and refuse a
        token-phrase zero outright (it is the one filter whose miss looks exactly like absence)."""
        control = self._zero(kind, **filters)
        if filters.get('detail_contains'):
            raise ZeroLooksWrong(f'detail_contains={filters["detail_contains"]!r}: nothing. ' + DETAIL_CAVEAT +
                                 ' Confirm with where() or pass allow_zero=True.')
        return control

    def by_bot(self, kind=None, allow_zero=False, **filters):
        """{bot: docs}. (lib/telemetry.by_bot returns ROWS per bot; here it is counts --
        use rows() and group them if you need the rows.)"""
        return self.terms('bot.name', kind, allow_zero=allow_zero, **filters)

    def by_pool(self, kind=None, allow_zero=False, **filters):
        return self.terms('exp.pool', kind, allow_zero=allow_zero, **filters)

    def histogram(self, kind=None, interval='1h', split=None, allow_zero=False, **filters):
        """{bucket_start_iso: docs} or, with split=field, {bucket: {value: docs}}."""
        h = {'date_histogram': {'field': '@timestamp', 'fixed_interval': interval, 'min_doc_count': 1}}
        if split:
            self._field_seen(split, kind, allow_zero)
            h['aggs'] = {'s': {'terms': {'field': split, 'size': 1000, 'missing': MISSING}}}
        r = self._search({'size': 0, 'query': self._query(kind=kind, **filters), 'aggs': {'h': h}})
        out = {}
        for b in r['aggregations']['h']['buckets']:
            if split:
                s = self._complete(b['s'], f'histogram split on {split} in {b["key_as_string"]}')
                out[b['key_as_string']] = {x['key']: x['doc_count'] for x in s['buckets']}
            else:
                out[b['key_as_string']] = b['doc_count']
        if not out and not allow_zero:
            return Agg({}, self._cav(filters), self._empty(kind, filters))
        return Agg(out, self._cav(filters))

    def latest(self, per='bot.name', require=None, fields=None, kind=None, allow_zero=False):
        """{per-value: newest _source} -- e.g. the latest state snapshot per bot.

        `require` must be an INDEXED LEAF that marks the documents you want. Do NOT pass a
        flattened or object field such as bot.inventory: `exists` on it is false for an empty {},
        so a bot that just emptied its bag would show its previous, fuller snapshot instead. For
        the bot state snapshot use 'bot.pos.x' (on the skill stream it is present on exactly the
        rows that carry bot.inventory: 108,719 = 108,719 over 3 h on 10-14)."""
        self._field_seen(per, None, allow_zero)
        q = self._query(kind=kind)
        if require:
            q['bool']['filter'].append({'exists': {'field': require}})
        th = {'size': 1, 'sort': [{'@timestamp': 'desc'}]}
        if fields:
            th['_source'] = sorted(set(fields) | {'@timestamp', per})
        r = self._search({'size': 0, 'query': q, 'aggs': {'p': {
            'terms': {'field': per, 'size': 5000}, 'aggs': {'top': {'top_hits': th}}}}})
        p = self._complete(r['aggregations']['p'], f'latest(): terms on {per}')
        out = {b['key']: b['top']['hits']['hits'][0]['_source'] for b in p['buckets']}
        if not out and not allow_zero:
            control = self._empty(kind, {})
            if require:
                raise ZeroLooksWrong(f'latest(): {control.get("window_docs")} docs in the window but none '
                                     f'carries {require!r} -- wrong field name, or it is always null')
            return Agg({}, self.caveats, control)
        return Agg(out, self.caveats)

    # -- rows (bounded) -------------------------------------------------------------------------
    def rows(self, kind=None, fields=None, max_rows=MAX_ROWS, page=5000, allow_zero=False, **filters):
        """An iterator of `_source` dicts in @timestamp order, read from ONE point-in-time snapshot.
        The PIT is opened and counted HERE, eagerly, so TooManyRows is raised before any row is
        read, and the count is of the same snapshot that is streamed (documents arriving later
        cannot slip past max_rows). The cap is enforced again while streaming. Rows are plain
        dicts and carry no caveats: read self.caveats (and DETAIL_CAVEAT when filtering on
        detail_contains) yourself. For a SUBSTRING question ('water' in detail, matching
        water_bucket) do not pre-filter with detail_contains, which drops those rows before your
        predicate sees them: use where(kind, lambda r: 'water' in r['skill'].get('detail', ''))."""
        q = self._query(kind=kind, **filters)
        pit = self._client('POST', f'{self.cfg["index"]}/_pit?keep_alive=2m', None)['id']
        try:
            r = self._client('POST', '_search', {'size': 0, 'query': q, 'track_total_hits': True,
                                                 'pit': {'id': pit, 'keep_alive': '2m'}})
            n = r['hits']['total']['value']
            pit = r.get('pit_id', pit)
            if n > max_rows:
                raise TooManyRows(f'{n:,} documents match; max_rows={max_rows:,}. Use count/terms/'
                                  f'histogram (server-side), narrow the window, or raise max_rows deliberately.')
            if n == 0 and not allow_zero:
                self._empty(kind, filters)
        except BaseException:
            self._close(pit)
            raise
        if n == 0:
            self._close(pit)
            return iter(())
        return self._stream(q, n, fields, page, pit)

    def _close(self, pit):
        try:
            self._client('DELETE', '_pit', {'id': pit})
        except Exception:
            pass

    def _stream(self, q, n, fields, page, pit):
        after, seen = None, 0
        try:
            while True:
                body = {'size': page, 'query': q, 'pit': {'id': pit, 'keep_alive': '2m'},
                        'sort': [{'@timestamp': 'asc'}, {'_shard_doc': 'asc'}], 'track_total_hits': False}
                if fields:
                    body['_source'] = list(fields)
                if after:
                    body['search_after'] = after
                r = self._client('POST', '_search', body)
                pit = r.get('pit_id', pit)
                hits = r['hits']['hits']
                if not hits:
                    break
                for h in hits:
                    seen += 1
                    if seen > n:
                        raise EsError(f'rows(): the snapshot yielded more than the {n:,} it counted')
                    yield h['_source']
                after = hits[-1]['sort']
        finally:
            self._close(pit)
        if seen != n:
            raise EsError(f'rows(): streamed {seen:,} of {n:,} counted documents -- not a complete read')

    def where(self, kind, pred, fields=None, max_rows=MAX_ROWS, allow_zero=False, **filters):
        """Rows of `kind` for which pred(row) is true (client-side predicate, bounded read)."""
        return [r for r in self.rows(kind, fields=fields, max_rows=max_rows, allow_zero=allow_zero, **filters)
                if pred(r)]
