"""Reading fleet telemetry without confidently reporting a zero that isn't one.

WHY THIS EXISTS

Three times in one day an analysis query of mine answered uniformly negative and
the answer was wrong, in a way indistinguishable from a real negative result:

  1. An RCON probe: `execute if block ...` returns the SENTENCE "That position is
     not loaded" for an unloaded chunk. The check was `"passed" in response`, so
     every point on the map read as "not water" and an entire ocean survey came
     back empty.
  2. A measurement window computed as now-minus-N that landed two minutes in the
     FUTURE. Zero events, no error.
  3. `logEvent({kind: 'water_surface_hold'})` writes `skill.name` as
     `_water_surface_hold`, with a leading underscore. A query for the bare name
     returned 0 while 560 events sat in the files, and a safety feature was
     reported to the lab owner as possibly inert.

The common shape is not three typos. It is that ZERO IS A VALID-LOOKING ANSWER,
so nothing about the result invites a second look. Every other class of mistake
here announces itself; this one is silent and confident.

So the rule this module enforces is: a count of zero is not returned until it has
been checked against what the data actually contains. If a near-miss name exists,
or the window cannot contain events, asking for the count RAISES instead of
answering. A crash is recoverable. A confident zero gets written into a report.

    from telemetry import Events
    ev = Events.load(since_minutes=75, version='b6a4845')
    ev.count('water_surface_hold')     # finds _water_surface_hold, or raises
    ev.rate('_death', bots=40)         # per bot-hour over the ACTUAL span
    ev.names()                         # what is really in there
"""
import json, glob, datetime, difflib


def canon(name):
    """Event names are written `_${kind}`; callers use either form."""
    return name[1:] if name.startswith('_') else name


class ZeroLooksWrong(LookupError):
    """A zero that is probably a query bug rather than a finding."""


class Events:
    def __init__(self, rows, since, until, span):
        self.rows = rows
        self.since, self.until, self.span = since, until, span
        self._by = {}
        for r in rows:
            self._by.setdefault(canon(r['name']), []).append(r)

    @classmethod
    def load(cls, paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=None,
             since=None, until=None, version=None):
        now = datetime.datetime.now(datetime.timezone.utc)
        if since_minutes is not None:
            since = now - datetime.timedelta(minutes=since_minutes)
        rows, newest = [], None
        for f in glob.glob(paths):
            try:
                with open(f, errors='replace') as fh:
                    for line in fh:
                        try:
                            d = json.loads(line)
                        except Exception:
                            continue
                        sk = d.get('skill') or {}
                        n = sk.get('name')
                        if not n:
                            continue
                        try:
                            t = datetime.datetime.fromisoformat(
                                d.get('@timestamp', '').replace('Z', '+00:00'))
                        except Exception:
                            continue
                        if newest is None or t > newest:
                            newest = t
                        if since and t < since:
                            continue
                        if until and t >= until:
                            continue
                        if version and (d.get('code') or {}).get('version', '').split('+')[0] != version:
                            continue
                        rows.append({'t': t, 'name': n, 'detail': sk.get('detail') or '',
                                     'bot': (d.get('bot') or {}), 'raw': d})
            except Exception:
                continue
        # A window that starts after the newest event on disk cannot contain
        # anything, and that is a clock bug, not a finding.
        if since and newest and since > newest:
            raise ZeroLooksWrong(
                f"window starts {since:%H:%M:%S}Z but the newest event on disk is "
                f"{newest:%H:%M:%S}Z — the window is in the future; check the clock, "
                f"not the fleet")
        ts = [r['t'] for r in rows]
        span = (max(ts) - min(ts)).total_seconds() / 3600 if len(ts) > 1 else 0.0
        return cls(rows, since, until, span)

    def names(self):
        return sorted(self._by)

    def count(self, name, allow_zero=False):
        """Count events. Raises if zero looks like a query bug.

        `allow_zero=True` is for the case where absence is the actual question --
        'did this failure kind stop happening'. It must be passed deliberately,
        so that a genuine zero is a claim someone made rather than a default.
        """
        hits = self._by.get(canon(name), [])
        if hits or allow_zero:
            return len(hits)
        near = difflib.get_close_matches(canon(name), self.names(), n=3, cutoff=0.6)
        near = [n for n in near if self._by.get(n)]
        if near:
            raise ZeroLooksWrong(
                f"{name!r} has 0 events, but these exist: " +
                ", ".join(f"{n} ({len(self._by[n])})" for n in near) +
                " — almost certainly the name, not the fleet")
        if not self.rows:
            raise ZeroLooksWrong(
                f"{name!r} has 0 events and so does EVERYTHING — the window or the "
                f"version filter matched nothing at all")
        return 0

    def rate(self, name, bots=40, allow_zero=False):
        """Per bot-hour, over the span the data actually covers."""
        if self.span <= 0:
            return 0.0
        return self.count(name, allow_zero) / (bots * self.span)

    def where(self, name, pred):
        return [r for r in self._by.get(canon(name), []) if pred(r)]
