# Backtest-only clock: when LANE_FAKE_NOW is set, datetime.datetime.now()/utcnow() answer that instant, so a read
# script run today computes the windows it computed at the original read. Unset -> this file does nothing.
import os as _os
_F = _os.environ.get('LANE_FAKE_NOW')
if _F:
    import datetime as _d
    _T = _d.datetime.fromisoformat(_F.replace('Z', '+00:00'))
    _Real = _d.datetime

    class _FakeDT(_Real):
        @classmethod
        def now(cls, tz=None):
            t = _T.astimezone(tz) if tz is not None else _T.astimezone().replace(tzinfo=None)
            return cls(t.year, t.month, t.day, t.hour, t.minute, t.second, t.microsecond, t.tzinfo)

        @classmethod
        def utcnow(cls):
            t = _T.astimezone(_d.timezone.utc)
            return cls(t.year, t.month, t.day, t.hour, t.minute, t.second, t.microsecond)

    _d.datetime = _FakeDT
