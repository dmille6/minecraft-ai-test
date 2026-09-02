"""Reading fleet telemetry without confidently reporting a zero that isn't one.

NEVER SEEK. A FULL WALK OF THE ENTIRE FLEET HISTORY IS ~4 SECONDS.

Measured 2026-08-28: 84 files, 7.4 GB, 4,774,009 lines, **4.2 seconds** to read
end to end. There has never been a performance reason to do anything else, and
`load()` below reads every file whole.

This is written at the top because the temptation is real and it cost two days.
Ad-hoc queries during the water investigation all seeked to the last few
megabytes of each log "to stay fast". That truncates the OLDEST window as files
grow, and the oldest window is always the baseline. The same pre-freeze drowning
count read 42, then 33, then 65 on a full walk -- the baseline was being
undercounted by half while everything after it was compared against a shrinking
number. Two days were spent reporting that a change had made drowning 48-64%
worse. On the full data it was neutral.

Note the shape of the mistake: the cost of a full walk was never measured. It
was assumed, an optimisation was applied against that assumption, and the price
was a silent bias in the direction that flatters recent changes. An
unmeasured optimisation is a guess with consequences.

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
    ev.rate('_death', bots='auto')     # per bot-hour over the ACTUAL span
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

    def rate(self, name, bots=None, allow_zero=False):
        """Per bot-hour, over the span the data actually covers.

        `bots` IS REQUIRED, AND THAT IS THE POINT. It used to default to 40.
        The fleet became 80 on 2026-08-25 and the default silently kept
        reporting every rate at twice its true value -- a wrong blessed path,
        which is worse than no blessed path, because it is the helper people are
        told to trust instead of hand-rolling.

        Pass `bots='auto'` to count the distinct bots that actually appear in
        the loaded window. That is usually what you mean, and unlike a constant
        it cannot drift away from the fleet.
        """
        if self.span <= 0:
            return 0.0
        if bots is None:
            raise TypeError(
                "rate() needs bots=N (or bots='auto'). It used to default to 40 "
                "against an 80-bot fleet and reported every rate at 2x.")
        if bots == 'auto':
            bots = len({r.get('bot') for r in self.rows if r.get('bot')}) or 1
        return self.count(name, allow_zero) / (bots * self.span)

    def of(self, name, allow_zero=False):
        """Every row for an event kind, name-canonicalised and zero-guarded.

        THIS EXISTS BECAUSE I BYPASSED MY OWN GUARD. count() canonicalises, but
        the first analysis written on top of this module iterated `ev.rows`
        directly and compared `r['name'] != 'water_surface_hold_ended'` -- the
        bare name against the stored `_water_surface_hold_ended`. Every group
        came back empty, and it was the FOURTH time in two days that the
        `_${kind}` convention produced a silent, confident zero.

        A guard with a documented bypass is not a guard. Iterate this, not rows.
        """
        self.count(name, allow_zero)          # raises if the zero looks wrong
        return list(self._by.get(canon(name), []))

    def by_bot(self, name=None, allow_zero=False):
        """Rows grouped per bot and time-ordered, for 'what happened next' work."""
        rows = self.of(name, allow_zero) if name else self.rows
        out = {}
        for r in rows:
            out.setdefault((r['bot'] or {}).get('name'), []).append(r)
        for v in out.values():
            v.sort(key=lambda r: r['t'])
        return out

    def is_kind(self, row, name):
        """Compare a row's kind without tripping over the leading underscore."""
        return canon(row['name']) == canon(name)

    def where(self, name, pred):
        return [r for r in self.of(name) if pred(r)]
