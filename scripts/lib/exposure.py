"""One definition of a bot-hour.

THE PROBLEM THIS EXISTS FOR, quoted from docs/TODO-block2-shakedown.md where it was written
down and then not fixed:

    Four scripts compute exposure four incompatible ways, none convertible to another, so
    **no two reports have ever been comparable**.

      canary-baseline.py   (last_ts - first_ts) x bots_seen
      freeze-verdict.py    wall window x bots that DIED          (fixed 2026-08-29)
      water-report.py      hardcoded 40 x span of the MEASURED EVENTS only
      canary-report.py     5-minute buckets in which the bot moved >= 8 blocks

Two of those are contaminated by the outcome under test, which is the worse failure: the
divisor for a death rate was casualties, and the divisor for a mobility change is movement.
A change that moves bots more therefore changes its own denominator, and the rate it is
judged on moves whether or not the thing being measured did.

Two are simply stale. water-report printed every rate 2x too high against an 80-bot fleet,
and verdict.py computed a canary death rate against TEN hardcoded bots where the canary had
twenty (fixed 2026-09-23). CLAUDE.md records the same defect a third time in Events.rate(),
which "used to default to 40 against an 80-bot fleet"; the fix there was to delete the
default rather than correct the number, and that is the principle here.

THE RULE, and it is the whole point:

    A bot contributes time whenever it logged ANYTHING.
    Never a constant, never a roster it was not observed in, and NEVER a filtered
    subset of events -- because the moment exposure depends on which events you kept,
    the denominator moves with the thing being measured.

So `bot_hours()` takes ALL rows for the window and is deliberately given no way to filter
them. A caller that wants a rate filters the NUMERATOR and passes the whole population here.

WHY PER-BOT SPANS rather than wall-clock x bot count. A bot that crashed at minute 10 of a
180-minute window did not contribute 3 hours, and counting it as though it did understates
every rate -- which for a death rate is the dangerous direction. The span estimator counts
from a bot's first logged row to its last, so a bot that stopped stops accruing. It slightly
UNDERstates exposure (a bot with one row contributes nothing, and idle time after the last
row is not counted), which OVERstates a rate: conservative for a gate that reverts, and the
error is named rather than hidden. It is also what immobiledid.py already emits, so the
scheduled reads and the death poll cannot disagree about the denominator of one window.
"""
import datetime as dt


class NoExposure(RuntimeError):
    """A zero denominator is an instrument failure, not a quiet fleet.

    Raised rather than returned, on the model of telemetry.ZeroLooksWrong, because every
    caller that divides by this would otherwise produce inf or a silent 0.0 and report it.
    """


def _ts(r):
    v = r.get('@timestamp') or (r.get('t') if isinstance(r.get('t'), str) else None)
    if isinstance(r.get('t'), dt.datetime):
        return r['t']
    if not v:
        return None
    try:
        return dt.datetime.fromisoformat(str(v).replace('Z', '+00:00'))
    except ValueError:
        return None


def _bot(r):
    b = r.get('bot')
    if isinstance(b, dict):
        return b.get('name')
    return b if isinstance(b, str) else None


def bot_hours(rows, since=None, until=None, key=None, allow_zero=False):
    """(hours, n_bots, per_bot) over ALL rows given.

    `rows`      every row in the window, unfiltered. Filtering is the caller's job and
                belongs to the numerator.
    `since`/`until`  optional closed bounds (datetime or ISO string).
    `key`       optional f(row) -> group; returns {group: (hours, n_bots, per_bot)}.
    `allow_zero` pass True only when you have already shown the query finds something.
    """
    since, until = _coerce(since), _coerce(until)
    if key is None:
        return _one(rows, since, until, allow_zero, 'all rows')
    groups = {}
    for r in rows:
        groups.setdefault(key(r), []).append(r)
    return {g: _one(rs, since, until, True, g) for g, rs in groups.items()}


def _coerce(v):
    if v is None or isinstance(v, dt.datetime):
        return v
    return dt.datetime.fromisoformat(str(v).replace('Z', '+00:00'))


def _one(rows, since, until, allow_zero, what):
    span = {}
    n_rows = 0
    for r in rows:
        t, b = _ts(r), _bot(r)
        if t is None or not b:
            continue
        if since and t < since:
            continue
        if until and t > until:
            continue
        n_rows += 1
        lo, hi = span.get(b, (t, t))
        span[b] = (min(lo, t), max(hi, t))
    hours = sum((hi - lo).total_seconds() for lo, hi in span.values()) / 3600.0
    per_bot = {b: (hi - lo).total_seconds() / 3600.0 for b, (lo, hi) in span.items()}
    if hours <= 0 and not allow_zero:
        raise NoExposure(
            f'zero bot-hours for {what} over {n_rows} in-window rows and {len(span)} bots. '
            f'A fleet that logged rows accrued time; a zero here is a window, a timestamp '
            f'field or a bot field read wrongly, not an idle fleet. Pass allow_zero=True '
            f'only after showing the same query finds something.')
    return hours, len(span), per_bot


def rate(numerator, rows, since=None, until=None, allow_zero=False):
    """A rate per bot-hour, with its denominator, as one value you cannot print apart.

    Returns (rate, hours, n_bots) so that CLAUDE.md's rule -- say the denominator before you
    say the number -- is satisfied by the type rather than by anyone remembering.
    """
    h, n, _ = bot_hours(rows, since, until, allow_zero=allow_zero)
    return (numerator / h if h else float('nan')), h, n


class Spans:
    """Streaming accumulator, for readers that walk a log and cannot hold every row.

    It exists so that "one definition of a bot-hour" survives contact with the scripts that
    stream. The arithmetic is identical to bot_hours(); the difference is only that rows
    arrive one at a time. A caller MUST feed it every row it sees, before any event filter --
    feeding it filtered rows reproduces exactly the water-report defect this module was
    written to end.
    """

    def __init__(self):
        self._span = {}

    def add(self, group, bot, t):
        if not bot or t is None:
            return
        k = (group, bot)
        lo, hi = self._span.get(k, (t, t))
        self._span[k] = (min(lo, t), max(hi, t))

    def hours(self, group, allow_zero=False):
        sel = [(lo, hi) for (g, _b), (lo, hi) in self._span.items() if g == group]
        h = sum((hi - lo).total_seconds() for lo, hi in sel) / 3600.0
        if h <= 0 and not allow_zero:
            raise NoExposure(f'zero bot-hours for {group!r} over {len(sel)} bots')
        return h

    def bots(self, group):
        return len({b for (g, b) in self._span if g == group})

    def groups(self):
        return sorted({g for (g, _b) in self._span})
