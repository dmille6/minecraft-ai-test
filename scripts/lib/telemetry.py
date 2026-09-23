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
import json
import sys, glob, gzip, os, datetime, difflib


def canon(name):
    """Event names are written `_${kind}`; callers use either form."""
    return name[1:] if name.startswith('_') else name



def open_log(path):
    """Open a telemetry file whether or not logrotate has compressed it.

    THE FULL-WALK RULE DEPENDS ON THIS. `/var/log/mcai` had no logrotate entry
    and reached 16 GB; a full walk that took 4.2s when this module was written
    took over 8 MINUTES on 2026-09-02. Rotation fixes the cost, but rotation also
    renames history to `skill-<bot>.jsonl-20260902.gz`, which the old default
    glob `skill-*.jsonl` does NOT match.

    That would have been the worse bug: every caller would still say "full walk",
    every query would still return rows, and the baseline would have quietly
    vanished -- the exact failure mode the seek-to-the-tail rule exists to stop,
    arriving through a filename instead of an offset. Hence the trailing `*` on
    the default glob and this opener.

    Elasticsearch remains the authoritative archive (mcai-skill-agents back to
    2026-08-05); these files are the local walk, and they must stay complete.
    """
    if path.endswith('.gz'):
        return gzip.open(path, 'rt', errors='replace')
    return open(path, errors='replace')


def predates_window(path, since):
    """True when `path` provably holds no row at or after `since`.

    A rotated file cannot contain rows newer than its own mtime, so this is the
    one place that decides whether a file is in scope. Both the size estimate
    and the walk call it, which is the point: when they used separate copies of
    this rule the estimate counted files the walk would never open, and the cap
    refused windows that were in fact tiny.

    mtime, not the `-YYYYMMDD` in the name: it is exact rather than a
    day-granularity guess, and it is right for the live file too (still being
    appended, so never skipped). An unreadable mtime is never a skip -- the
    walk would rather pay for a file than silently drop one.
    """
    if since is None:
        return False
    try:
        mt = datetime.datetime.fromtimestamp(os.path.getmtime(path),
                                             datetime.timezone.utc)
    except OSError:
        return False
    return mt < since


MAX_WALK_BYTES = 6 * 2**30   # ~6 GB of raw telemetry; see the guard in load()


class WalkTooWide(MemoryError):
    """A walk large enough to OOM the host it runs on."""


class ZeroLooksWrong(LookupError):
    """A zero that is probably a query bug rather than a finding."""


class WrongVocabulary(LookupError):
    """A name asked of the wrong field: an event KIND queried as a failure CLASS, or
    the reverse. This is not a near-miss spelling -- the name exists, in the other
    vocabulary, and answering 0 would be a confident lie.

    MEASURED 2026-09-23: `dig_unconfirmed` and `arrived_out_of_reach` are live
    fail_class values (skills.mjs:1238, digreach.mjs:175, written to `fail_class` by
    logger.mjs:80). `count()` returned 0 for both because this library indexed only
    `skill.name`, and that 0 was published as "the instruments are dead" and used to
    overturn a correct finding. ZeroLooksWrong could not fire: the spelling was right
    and the window was full.
    """


class NotAnInstrument(LookupError):
    """A name this build either cannot emit, or can emit and never did.

    Either way it is not a zero. `count_class` returning 0 silently is how
    "the instrument is dead" and "the instrument is live so the zero is data" were
    BOTH published about the same two names within one hour on 2026-09-23. The
    honest answer needs the build's own source, which is what lib/vocabulary.py reads.
    """


class VersionsMixed(LookupError):
    """One window, more than one deployed code version, and no version= filter.

    Deploys mid-window are routine here (three fleet-wide deploys on 2026-09-22
    alone), and a rate computed across a version boundary belongs to neither build.
    """


class Events:
    def __init__(self, rows, since, until, span):
        self.rows = rows
        self.since, self.until, self.span = since, until, span
        self._by = {}
        self._byclass = {}
        for r in rows:
            self._by.setdefault(canon(r['name']), []).append(r)
            fc = r.get('fail_class')
            if fc:
                self._byclass.setdefault(str(fc).lower(), []).append(r)

    @classmethod
    def load(cls, paths='/var/log/mcai/*/skill-*.jsonl*', since_minutes=None,
             since=None, until=None, version=None):
        now = datetime.datetime.now(datetime.timezone.utc)
        if since_minutes is not None:
            since = now - datetime.timedelta(minutes=since_minutes)
        # A NAIVE BOUND IS A SILENT WINDOW, NOT A LOUD ONE. Compared against an
        # aware mtime it raises TypeError in the estimate, and inside the walk's
        # per-row try it would be SWALLOWED -- an empty result that looks like a
        # finding. Refuse it at the door instead (Codex pass 1).
        for nm, v in (('since', since), ('until', until)):
            if isinstance(v, datetime.datetime) and v.tzinfo is None:
                raise ValueError('%s must be timezone-aware; a naive bound reads as an empty '
                                 'window rather than an error' % nm)
        # REFUSE A WALK THAT WOULD OOM THE HOST.
        #
        # These files live on the FLEET host. `Events.load()` holds every row in
        # RAM, and Python objects run ~10x the raw JSON, so a wide window over
        # rotated history is tens of GB. Measured 2026-09-02: two such loads were
        # OOM-killed (exit 137). Killing python is survivable; the kernel picking
        # a bot process instead is not, and an analysis query must never be able
        # to take the fleet down.
        #
        # Compressed files are counted at an assumed 25x, which is conservative
        # for this data (16 GB -> 634 MB measured, ~26x). Raising the cap is not
        # the fix -- Elasticsearch holds the full archive and is where a wide
        # window belongs.
        # THE ESTIMATE MUST COVER THE SAME FILES THE WALK WILL READ.
        #
        # It used to sum the WHOLE glob, window or not, while the walk below
        # skipped every file whose mtime predates `since`. The two disagreed,
        # and the disagreement grew with each rotation: measured 2026-09-18,
        # 1124 rotated generations totalling 0.44 GB were counted at 25x for an
        # estimate of 11.4 GB against 1.9 GB actually on disk, so EVERY call
        # raised -- `since_minutes=30` included. The advice in the message
        # ("narrow the window") could not work, because narrowing the window did
        # not change the number. fallread, deathread, canary-report and
        # verdict.py's evidence objects all died with it, mid-canary-season.
        #
        # Both sides now ask `predates_window()`, so they cannot drift apart
        # again. Skipping only ever drops files that provably hold no row in the
        # window, so the walk stays FULL for the window asked for -- the
        # property the full-walk rule is actually about.
        # ONE glob, frozen, for both the estimate and the walk. They used to
        # glob independently, so a file could be absent when priced and present
        # when read -- the estimate authorising a walk it had never seen. The
        # shared predicate alone does not fix that; a shared LIST does.
        files = [f for f in sorted(glob.glob(paths)) if not predates_window(f, since)]
        est = 0
        for f in files:
            try:
                sz = os.path.getsize(f)
                est += sz * 25 if f.endswith('.gz') else sz
            except OSError:
                pass
        if est > MAX_WALK_BYTES:
            raise WalkTooWide(
                'this walk would read ~%.1f GB of telemetry into memory, over the '
                '%.1f GB cap. Narrow the window with since_minutes=, or query '
                'Elasticsearch (mcai-skill-agents) for anything wider than a few '
                'days -- it is the authoritative archive.'
                % (est / 2**30, MAX_WALK_BYTES / 2**30))

        rows, newest, read_chars = [], None, 0
        bad_lines, unreadable = 0, []
        for f in files:
            # A ROTATED FILE CANNOT CONTAIN ROWS NEWER THAN ITS OWN MTIME.
            #
            # Without this the walk decompresses all 14 rotated generations to
            # answer a 30-minute question: measured 130s for 26k rows, against
            # the 4.2s this module's docstring still advertises. That gap is how
            # the full-walk rule stops being followed.
            #
            # mtime, not the `-YYYYMMDD` in the name: it is exact rather than a
            # day-granularity guess, and it is right for the live file too (still
            # being appended, so never skipped). Skipping only ever removes files
            # that provably predate the window, so the walk stays FULL for the
            # window asked for -- which is the property that matters.
            try:
                with open_log(f) as fh:
                    for line in fh:
                        try:
                            # THE BUDGET THE ESTIMATE ONLY GUESSES AT. The 25x
                            # multiplier prices a compressed file before it is
                            # opened; this counts what is actually decompressed
                            # and stops. It bounds appends that landed after the
                            # estimate, a rotation that is not compressed at all
                            # (logrotate here uses delaycompress), and any window
                            # whose real expansion beats the guess (Codex pass 1).
                            #
                            # Characters, not bytes: this telemetry is effectively
                            # ASCII, so the two agree closely, and encoding every
                            # line to count exactly would cost more than the guard
                            # is worth. A safety net, not an accountant.
                            read_chars += len(line)
                            if read_chars > MAX_WALK_BYTES:
                                raise WalkTooWide(
                                    'this walk has already decompressed ~%.1f GB, over the %.1f GB '
                                    'cap, and stopped at %s. Narrow the window with since_minutes=, '
                                    'or query Elasticsearch (mcai-skill-agents).'
                                    % (read_chars / 2**30, MAX_WALK_BYTES / 2**30, f))
                            d = json.loads(line)
                            sk = d.get('skill') or {}
                            n = sk.get('name')
                            if not n:
                                continue
                            t = datetime.datetime.fromisoformat(
                                d.get('@timestamp', '').replace('Z', '+00:00'))
                            if newest is None or t > newest:
                                newest = t
                            if since and t < since:
                                continue
                            if until and t >= until:
                                continue
                            if version and (d.get('code') or {}).get('version', '').split('+')[0] != version:
                                continue
                            rows.append({'t': t, 'name': n, 'detail': sk.get('detail') or '',
                                         'fail_class': sk.get('fail_class') or None,
                                         'status': sk.get('status') or None,
                                         'bot': (d.get('bot') or {}), 'raw': d})
                        except WalkTooWide:
                            raise
                        except Exception:
                            # ONE BAD LINE IS A BAD LINE, NOT THE END OF THE FILE.
                            # The file-level handler below used to catch anything
                            # thrown mid-file -- a JSON array where an object was
                            # expected, a row with an unparsable timestamp -- and
                            # `continue` to the NEXT FILE, discarding every
                            # remaining row in this one. Reproduced by Codex pass
                            # 2: valid row / [] / valid row returned ONE row. A
                            # short walk that looks complete is this project's
                            # most expensive bug, so a line now costs a line.
                            bad_lines += 1
                            continue
            except WalkTooWide:
                # THE BUDGET IS NOT A FILE ERROR. This handler exists so one
                # unreadable generation cannot kill a walk; letting it swallow
                # the cap would turn 'too much data' into a short, quiet,
                # plausible-looking result -- the exact shape of finding this
                # project keeps having to retract.
                raise
            except Exception as e:
                # Could not be opened or decompressed at all. Still not silent:
                # the walk says what it could not read, so 'complete' is a
                # claim the caller can check rather than assume.
                unreadable.append('%s (%s)' % (os.path.basename(f), type(e).__name__))
                continue

        # WHAT THE WALK COULD NOT READ IS PART OF THE RESULT.
        if unreadable or bad_lines:
            sys.stderr.write(
                'telemetry: walk incomplete -- %d unreadable file(s)%s, %d unparsable line(s)\n'
                % (len(unreadable), (': ' + ', '.join(unreadable[:4])) if unreadable else '',
                   bad_lines))

        # ROTATION DURING THE WALK LOOKS EXACTLY LIKE A QUIET SHORT RESULT.
        # logrotate here uses copytruncate: if it fires between the glob and the
        # open, the live file is read truncated and the generation carrying the
        # missing rows never appears in the frozen list. Re-glob and say so
        # (Codex pass 2). Reported, not raised -- one rotation must not kill an
        # operator's read, but it must never pass for a complete one.
        appeared = [f for f in glob.glob(paths)
                    if f not in set(files) and not predates_window(f, since)]
        if appeared:
            sys.stderr.write('telemetry: %d in-window file(s) appeared DURING the walk '
                             '(rotation?): %s -- re-run the read\n'
                             % (len(appeared), ', '.join(os.path.basename(x) for x in appeared[:4])))

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
        if canon(name).lstrip('_') in self._byclass or canon(name) in self._byclass:
            k = canon(name) if canon(name) in self._byclass else canon(name).lstrip('_')
            raise WrongVocabulary(
                f"{name!r} has 0 EVENTS but {len(self._byclass[k])} rows carry it as a "
                f"fail_class — use count_class({name!r}), not count(). Returning 0 here "
                f"is how 'the instrument is dead' gets published about a live one.")
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
            bots = len(self.bots()) or 1
        return self.count(name, allow_zero) / (bots * self.span)

    def bots(self):
        """The distinct bot NAMES in the loaded window.

        `bot` on a normalised row is the log's whole `bot` object (name, pos,
        inventory...), not a string. `rate(bots='auto')` used to put those dicts
        in a set and raised `unhashable type: 'dict'` on the fleet host
        (2026-09-16) -- the blessed helper for a rate could not compute one.
        """
        out = set()
        for r in self.rows:
            b = r.get('bot')
            n = b.get('name') if isinstance(b, dict) else b
            if n:
                out.add(n)
        return out

    def classes(self):
        """Every fail_class present in the window, with counts, commonest first.

        There is no equivalent of this for prose. 42 of 65 analysis scripts regex
        `detail` because this vocabulary had no index; the field was always there.
        """
        return sorted(((len(v), k) for k, v in self._byclass.items()), reverse=True)

    def count_class(self, fail_class, allow_zero=False):
        """Rows whose skill.fail_class is this, zero-guarded like count().

        The guard is the same shape and exists for the same reason: a 0 from a live
        instrument is this project's most expensive failure.
        """
        k = str(fail_class).lower()
        hits = self._byclass.get(k, [])
        if hits or allow_zero:
            return len(hits)
        if canon(fail_class) in self._by:
            raise WrongVocabulary(
                f"{fail_class!r} is 0 as a fail_class but {len(self._by[canon(fail_class)])} "
                f"rows carry it as an EVENT KIND — use count({fail_class!r}).")
        near = difflib.get_close_matches(k, list(self._byclass), n=3, cutoff=0.6)
        near = [n for n in near if self._byclass.get(n)]
        if near:
            raise ZeroLooksWrong(
                f"fail_class {fail_class!r} has 0 rows, but these exist: " +
                ", ".join(f"{n} ({len(self._byclass[n])})" for n in near) +
                " — almost certainly the name, not the fleet")
        if not self._byclass:
            raise ZeroLooksWrong(
                f"fail_class {fail_class!r} has 0 rows and so does EVERY fail_class — "
                f"nothing in this window records one, which is itself suspicious")
        known = self._can_emit()
        if known is not None:
            if k in known:
                raise NotAnInstrument(
                    f"fail_class {fail_class!r} has 0 rows, but the DEPLOYED build can "
                    f"emit it — a live code path that never fired in this window. That is "
                    f"a finding, not a zero. Pass allow_zero=True and say which you mean.")
            raise NotAnInstrument(
                f"fail_class {fail_class!r} has 0 rows and the deployed build CANNOT emit "
                f"it at all — wrong name, or a name from a different build.")
        return 0

    def _can_emit(self):
        """The fail_class vocabulary of the build in this window, or None if unknowable.

        Deliberately fails SOFT to None (never raises, never blocks a read) because an
        instrument that breaks the analysis it guards gets deleted. When it cannot
        answer, count_class keeps its old behaviour.
        """
        if getattr(self, '_emitcache', 'x') != 'x':
            return self._emitcache
        self._emitcache = None
        try:
            import os
            import vocabulary
            vs = [v for v in self.versions() if v and v != '?']
            repo = os.environ.get('MCAI_REPO', '/opt/minecraft-ai')
            if len(vs) == 1:
                self._emitcache = vocabulary.extract(repo, vs[0])['fail_class']
        except Exception:
            self._emitcache = None
        return self._emitcache

    def of_class(self, fail_class, allow_zero=False):
        """Every row for a fail_class, guarded. The `of()` of the typed vocabulary."""
        self.count_class(fail_class, allow_zero)
        return list(self._byclass.get(str(fail_class).lower(), []))

    def versions(self):
        """Distinct deployed code versions in the window, with row counts."""
        out = {}
        for r in self.rows:
            v = ((r['raw'].get('code') or {}).get('version') or '?')
            out[v] = out.get(v, 0) + 1
        return out

    def assert_one_version(self):
        """RAISE if the window straddles a deploy and no version= filter was used.

        A rate averaged across a version boundary belongs to neither build. Three
        fleet-wide deploys landed on 2026-09-22 alone, so this is the common case,
        not the edge case.
        """
        vs = self.versions()
        if len(vs) > 1:
            raise VersionsMixed(
                "this window spans " + str(len(vs)) + " code versions (" +
                ", ".join(f"{k}:{n}" for k, n in sorted(vs.items(), key=lambda x: -x[1])) +
                ") — pass version=<sha> to load(), or call versions() and split the read")
        return next(iter(vs), None)

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
