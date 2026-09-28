"""THE MANIFEST CONTRACT for a within-world canary.

WHY A WITHIN-WORLD CANARY NEEDS A NEW FIELD AT ALL. One pool is one Minecraft world. Measured
2026-09-23: 86.7% of items/bot-hour variance is within-bot hour-to-hour, world level 4.0%, world
drift 5.2%, so pool-level assignment reaches about 9% of the noise. Treating 2 of the 5 bots in
EVERY world instead takes the items MDE from +146% to +121% at 3h and from +92% to +50% at
24h/arm, and it removes a randomization-resolution floor: with only C(16,2)=120 two-pool
assignments the smallest attainable p is 1/120.

So the treated set is a list of BOT NAMES. `canary_pool` cannot hold it, for a mechanical reason
that is easy to overlook -- `deploy-fleet.sh` selects with

    grep -E "^(${POOL//,/|})-"

It APPENDS A DASH. A bot name in that field matches `hive-a-Alpha-<something>`, which is no bot,
so the deploy would silently target nobody. `looks_like_bot_id` below refuses that shape.

-----------------------------------------------------------------------------------------------
THE PART THAT MATTERS: AN OLDER READER MUST NOT SILENTLY MISREAD A SPLIT CANARY.
-----------------------------------------------------------------------------------------------
Most readers in this tree resolve canary membership from the pool prefix. If a split canary were
declared as `canary_pool: "hive-a,hive-b,..."` with the roster in a NEW field those readers ignore,
every one of them would treat all five bots of each named world as canary. That is not a crash and
not a warning: it is a WRONG ANSWER that looks exactly like a legitimate whole-pool canary. The
three deliberate baselines in each world would be counted as treated, which silently destroys the
contrast the design exists to create, and in the tripper it reads as five POOL_NOT_CANARY
violations and halts the fleet.

Adding a field cannot fix this, because the failure is an older reader NOT reading the new field.
The fix has to live in the field the old reader DOES read. So:

    a split canary writes a SENTINEL into `canary_pool` that cannot prefix-match any bot name.

`split:<run_id>` contains a colon. No bot name contains a colon, so `bot.startswith("split:x-")`
is False for every bot on the fleet. An older reader therefore resolves the canary set to EMPTY
-- never to five bots of a world. Empty is not a plausible-looking wrong answer; it is a state
every consumer already fails on, loudly:

  * `canary_split_ok_n` sees two builds running and zero declared members, so every bot actually
    on the canary build is reported "on a canary build, not in its pool" and the split is REFUSED.
    Fail-closed, naming bots, rather than halting eighty of them for the wrong reason.
  * `classify` returns CANARY_OUTSIDE_POOL for the treated bots -- again naming them.
  * a read script computes a canary arm of n=0, which is an empty contrast, not a biased one.

That is the structural guarantee, and it is a property of the STRING, checkable rather than
promised: `sentinel_is_unmatchable` below asserts it against the roster itself, and the test suite
runs it against the real 80-bot roster. It does not depend on any older reader being updated,
because the older reader's own matching rule is what produces the empty set.

WHY THE SENTINEL IS A NON-EMPTY STRING AND NOT A JSON LIST. Putting the bot names straight into
`canary_pool` as a list was the obvious alternative and it is actively dangerous, because two
consumers read that field as RAW TEXT rather than as JSON:

  * `scripts/fleet-recycle.sh` greps `"canary_pool": *"[^"]\\+"` to decide whether a canary is live
    and refuse to recycle. A JSON list does not match that regex, so the recycle would proceed and
    restart every bot onto $H/src -- dissolving the canary silently. That is a failure this project
    has already had (`recycle-dissolves-canaries`).
  * `scripts/host/analyst.py` calls `.strip()` on the value; a list raises AttributeError.

A non-empty quoted string keeps both of those working exactly as they do today: the recycle guard
still sees a live canary and still refuses. The sentinel therefore protects the canary from the one
consumer that could destroy it, which a list would not.

WHAT THE SENTINEL COSTS, NAMED RATHER THAN HIDDEN. Hiding the pool names from prefix readers also
hides them from the two guards that legitimately want to know WHICH WORLDS are busy --
`scripts/drawrec.sh` (do not draw a world that already has a canary) and `scripts/reseed-pool.sh`
(do not reseed the live canary's world). Those are not prefix matchers on bots; they are world-set
questions, and the answer is `pools_of` below, derived from the roster. Both are wired to it.

A SPLIT DECLARATION MISSING ITS ROSTER IS INVALID, NOT A FALLBACK. If `canary_split` is set and
`canary_roster` is absent or empty, `load` raises. There is deliberately no path that degrades to
the pool prefix, because the degraded read is precisely the whole-pool misinterpretation above --
and with the sentinel in `canary_pool` there is nothing to degrade TO except "no canary at all",
which would leave a deployed canary undeclared. Both outcomes are worse than refusing to start.
"""

#: `canary_split`'s only accepted value. A tag rather than a boolean so the reason a manifest is
#: split is recorded in the manifest, and so an unknown design name is a refusal rather than a
#: truthy value silently accepted as this one.
SPLIT_WITHIN_WORLD = 'within-world'

#: The colon is the whole mechanism -- see the module docstring. It is not cosmetic, and
#: `sentinel_is_unmatchable` is the check that keeps it honest if anyone edits this.
SENTINEL_PREFIX = 'split:'


class InvalidManifest(ValueError):
    """The declaration cannot be interpreted. Never downgraded to a warning.

    A canary whose membership is ambiguous has no control group, so every number it produces is
    uninterpretable. Refusing at declaration time costs a deploy; guessing costs the trial and
    is not detectable afterwards.
    """


def pool_of(bot):
    """A bot's pool: its name with the final `-Suffix` removed.

    Imported from lib.arms in callers that have it; duplicated here only as a lazy import below so
    this module can be loaded by the deploy path without pulling the analysis library in. There is
    exactly one definition and it is arms.pool_of.
    """
    from arms import pool_of as _p
    return _p(bot)


def split_sentinel(run_id):
    """The `canary_pool` value a split canary declares.

    Derived from the run_id, not a constant, so two sentinels are distinguishable in a journal and
    in the openloop ledger -- the same reason `canary_split_ok_n` refuses two canaries that share
    a build string: a value that cannot be attributed to a run cannot carry a verdict.
    """
    rid = str(run_id or '').strip()
    if not rid:
        raise InvalidManifest('a split canary needs a run_id to build its sentinel from')
    if ',' in rid:
        # canary_pool is comma-split by every reader; a comma here would produce two sentinels,
        # one of which is a fragment.
        raise InvalidManifest(f'run_id may not contain a comma: {rid!r}')
    return SENTINEL_PREFIX + rid


def is_sentinel(pool):
    """True when this `canary_pool` value is a split sentinel rather than a pool list."""
    return isinstance(pool, str) and pool.strip().startswith(SENTINEL_PREFIX)


def looks_like_bot_id(entry):
    """True when a `canary_pool` entry is a BOT name rather than a pool name.

    The fleet's bots are `<pool>-<Suffix>` with a capitalised suffix (Alpha, Bravo, Comet, Delta,
    Echo) and its pools are lowercase throughout (`hive-a`, `board-c`, `self-isolated-a` -- note
    that one has three segments, so counting segments does not work and the case of the LAST
    segment is what separates them).

    This is a naming convention and not a law, so it is a refusal aimed at one specific mistake --
    pasting a drawn roster into `canary_pool`, where the deploy's appended dash would match nobody
    -- and not a general validator. A bot named in lowercase would slip past it; the roster
    membership checks below do not depend on this function.
    """
    e = str(entry or '').strip()
    if not e:
        return False
    last = e.rsplit('-', 1)[-1]
    return bool(last) and last[0].isupper()


def parse_pool_list(pool):
    """`canary_pool` as a list of pool names. Comma-separated, blanks dropped.

    Byte-identical in effect to the split every existing reader does inline, so this cannot become
    a second disagreeing definition.
    """
    return [p.strip() for p in str(pool or '').split(',') if p.strip()]


def sentinel_is_unmatchable(pool, roster):
    """The structural guarantee, as a check: no bot in `roster` prefix-matches `pool`.

    This runs the OLD reader's own rule -- `bot.startswith(p + "-")`, copied from
    `version_split.in_canary_pool`'s string branch -- against the bots that are actually treated.
    Returning True means an older reader resolves this canary to the empty set and fails closed.

    Deliberately not `assert 'split:' in pool`: that would test the spelling of the sentinel, and
    the property we need is about what MATCHES. If someone replaces the colon with a dash this
    still catches it, because `split-<run>-` could then prefix-match a bot in a pool named
    `split-<run>`.
    """
    entries = parse_pool_list(pool)
    return not any(b.startswith(p + '-') or b == p for b in roster for p in entries)


class Declaration(object):
    """What the manifest declares, resolved.

    `canary_members` is the object every membership check should be given: a `Roster` (exact
    membership) for a split canary, and the untouched `canary_pool` STRING for a legacy one. That
    is the whole point of the Roster type -- a reader cannot accidentally treat one as the other,
    because a frozenset and a string fail differently rather than both being truthy and iterable
    over the wrong units.
    """

    __slots__ = ('run_id', 'base_sha', 'canary_sha', 'canary_pool', 'canary_members',
                 'split', 'roster', 'raw')

    def __init__(self, run_id, base_sha, canary_sha, canary_pool, canary_members,
                 split, roster, raw):
        self.run_id = run_id
        self.base_sha = base_sha
        self.canary_sha = canary_sha
        self.canary_pool = canary_pool
        self.canary_members = canary_members
        self.split = split
        self.roster = roster
        self.raw = raw

    @property
    def is_split(self):
        return bool(self.split)

    @property
    def has_canary(self):
        return bool(self.canary_sha) and bool(self.canary_members)

    @property
    def pools(self):
        """The worlds this canary touches.

        DERIVED from the roster for a split canary, never stored. A stored pool list beside a
        stored roster is two facts that can disagree, and this project has already paid for that
        shape: `srcDigest` vs `CODE_VERSION`, and the manifest vs the per-bot env files.
        """
        if self.is_split:
            return sorted({pool_of(b) for b in self.roster})
        return parse_pool_list(self.canary_pool)

    def expected_version(self, bot, base_version, canary_version):
        """Which full `sha+digest` this bot should be reporting."""
        from version_split import in_canary_pool
        return canary_version if in_canary_pool(bot, self.canary_members) else base_version

    def describe(self):
        if not self.has_canary:
            return 'no canary declared'
        if self.is_split:
            return (f'{self.split} canary {self.canary_sha}: {len(self.roster)} bot(s) '
                    f'across {len(self.pools)} world(s) -- {",".join(sorted(self.roster))}')
        return f'canary {self.canary_sha} on pool(s) {",".join(self.pools)}'


def load(man):
    """Resolve a manifest dict into a `Declaration`, or raise `InvalidManifest`.

    Every refusal below is a state in which membership is ambiguous. None of them are recoverable
    by guessing, which is why none of them warn.
    """
    from version_split import Roster

    if not isinstance(man, dict):
        raise InvalidManifest(f'manifest is {type(man).__name__}, not an object')

    run_id = (man.get('run_id') or '').strip()
    base = (man.get('declared_code_version') or '').strip()
    csha = (man.get('canary_code_version') or '').strip()
    pool = man.get('canary_pool') or ''
    pool = pool.strip() if isinstance(pool, str) else pool
    split = (man.get('canary_split') or '').strip() if man.get('canary_split') else ''
    raw_roster = man.get('canary_roster')

    if raw_roster is None:
        roster = []
    elif isinstance(raw_roster, str):
        roster = [b.strip() for b in raw_roster.split(',') if b.strip()]
    else:
        roster = [str(b).strip() for b in raw_roster if str(b).strip()]

    # ---- the two halves of a canary must arrive together, split or not -------------------
    if csha and not (pool or roster):
        raise InvalidManifest(
            f'canary_code_version {csha} is declared with no membership: '
            'a canary whose members are unknown has no control group')
    if (pool or roster) and not csha:
        raise InvalidManifest(
            'canary membership is declared with no canary_code_version: the bots would be '
            'measured against an unnamed build')

    # ---- A SPLIT TAG WITHOUT A ROSTER IS INVALID, NOT A FALLBACK -------------------------
    if split:
        if split != SPLIT_WITHIN_WORLD:
            raise InvalidManifest(
                f'unknown canary_split {split!r}; the only accepted value is '
                f'{SPLIT_WITHIN_WORLD!r}')
        if not roster:
            raise InvalidManifest(
                'canary_split is set but canary_roster is empty -- REFUSED rather than falling '
                'back to the pool prefix, because that fallback IS the whole-pool '
                'misinterpretation this design exists to make impossible')
        if not is_sentinel(pool):
            raise InvalidManifest(
                f'a split canary must declare canary_pool as {SENTINEL_PREFIX}<run_id> so that '
                f'a reader which only knows pool prefixes resolves it to the empty set; '
                f'got {pool!r}')
        if run_id and pool != split_sentinel(run_id):
            raise InvalidManifest(
                f'canary_pool {pool!r} does not match this run: expected '
                f'{split_sentinel(run_id)!r}. A sentinel that names another run cannot carry '
                'this run\'s verdict')
        if not sentinel_is_unmatchable(pool, roster):
            # The guarantee is checked, not trusted. If this ever raises, an older reader would
            # have resolved this canary to a NON-EMPTY wrong set.
            raise InvalidManifest(
                f'canary_pool {pool!r} prefix-matches a declared bot; an older reader would '
                'silently read this split canary as a whole-pool one')
    elif roster:
        # A roster with no tag is the ambiguous case: a reader cannot tell whether the author
        # meant an exact roster or left a stale field behind, and the two differ by three bots
        # per world.
        raise InvalidManifest(
            'canary_roster is set but canary_split is not; membership would be ambiguous. '
            f'Declare canary_split={SPLIT_WITHIN_WORLD!r}')
    elif is_sentinel(pool):
        raise InvalidManifest(
            f'canary_pool {pool!r} is a split sentinel but canary_split is not set; '
            'no reader can resolve its membership')

    # ---- canary_pool may never carry bot IDs -------------------------------------------
    # deploy-fleet.sh appends a dash, so a bot name here targets nobody and the canary deploys
    # to an empty set while reporting success.
    bad = [e for e in parse_pool_list(pool) if looks_like_bot_id(e)]
    if bad:
        raise InvalidManifest(
            f'canary_pool carries bot ID(s) {bad}: the deploy selects with a trailing dash, so '
            'these match no bot. Declare them in canary_roster with '
            f'canary_split={SPLIT_WITHIN_WORLD!r}')

    dup = sorted({b for b in roster if roster.count(b) > 1})
    if dup:
        raise InvalidManifest(f'canary_roster repeats {dup}')

    members = Roster(roster) if split else pool
    return Declaration(run_id=run_id, base_sha=base, canary_sha=csha, canary_pool=pool,
                       canary_members=members, split=split, roster=sorted(roster), raw=man)


def members_of(man):
    """The membership spec to hand `in_canary_pool` -- a `Roster` for a split canary, the
    `canary_pool` STRING for a legacy one.

    THE HYDRATION STEP, and the reason a split canary could not work before it existed. `Roster` is
    a Python type with no JSON encoding, so a value that came out of `json.load` can only ever be a
    str, a list or None -- `in_canary_pool`'s Roster branch was unreachable from any consumer that
    reads the manifest from disk, which is all of them. Every reader that wants exact membership
    calls this instead of `man.get('canary_pool')`.

    Raises `InvalidManifest` rather than returning something usable-looking, so a caller cannot get
    a silently degraded answer. A guard that can halt the fleet should go BLIND on an
    uninterpretable declaration, not confident.
    """
    return load(man).canary_members


def pools_of(man):
    """The WORLDS a declaration touches, for the guards that ask a world-set question.

    For a legacy declaration this is `canary_pool` split on commas -- unchanged. For a split
    declaration it is derived from the roster, which is why the sentinel does not blind
    `drawrec.sh` or `reseed-pool.sh`: they stop pattern-matching the field and ask this instead.
    """
    return load(man).pools


#: `worlds_touched` returns this when a declaration names a split canary whose roster it cannot
#: see -- an old ledger row, written before the roster was recorded alongside the sentinel. It is
#: not "no worlds": a within-world canary touches EVERY world, so a caller that cannot resolve the
#: roster must treat all of them as busy. Returning [] there would make the two guards that ask
#: this question fail OPEN, and one of them (reseed-pool.sh) deletes a world.
ALL_WORLDS = '*'


def worlds_touched(row):
    """The worlds a declaration or a ledger row involves, for guards that ask a world-set question.

    Takes a manifest OR a `_canary-decisions.jsonl` row, which carries `canary_pool` verbatim and,
    since this change, `canary_roster` beside it. Never raises: these callers are protective guards
    and an exception in one of them is the same as it not running.

    Returns a sorted list of pool names, or `[ALL_WORLDS]` when a split canary's membership cannot
    be resolved from what was passed.
    """
    if not isinstance(row, dict):
        return []
    roster = row.get('canary_roster') or []
    if isinstance(roster, str):
        roster = [b.strip() for b in roster.split(',') if b.strip()]
    pool = row.get('canary_pool') or ''
    if roster:
        return sorted({pool_of(str(b).strip()) for b in roster if str(b).strip()})
    if is_sentinel(pool):
        return [ALL_WORLDS]
    return parse_pool_list(pool)


def declare(run_id, base_sha, canary_sha=None, pool=None, roster=None, notes='',
            declared_at=None):
    """Build the manifest dict for a declaration. The single writer of the canary fields.

    Three shapes, and no fourth:
      * no canary        -- canary_sha None: the canary fields are None and the split tag absent.
      * a legacy pool    -- `pool` given: byte-identical to what deploy-fleet.sh has always
                            written, so an existing declaration is unchanged.
      * a within-world   -- `roster` given: the sentinel goes in canary_pool, the bots in
                            canary_roster, and canary_split records the design.

    The result is passed through `load` before it is returned, so a manifest this function writes
    cannot be one `load` would refuse. That closes the gap where a writer and its validator
    disagree -- the shape that let a canary ship inert on 2026-09-18.
    """
    import datetime
    if pool and roster:
        raise InvalidManifest('declare a pool or a roster, not both: a canary has one membership')
    man = {
        'trial': 'instance-1',
        'run_id': run_id,
        'declared_code_version': base_sha,
        'declared_at': declared_at or (datetime.datetime.now(datetime.timezone.utc)
                                       .strftime('%Y-%m-%dT%H:%M:%S.%f') + 'Z'),
        'canary_pool': None,
        'canary_code_version': None,
        'notes': notes,
    }
    if roster:
        bots = sorted({str(b).strip() for b in roster if str(b).strip()})
        if not canary_sha:
            raise InvalidManifest('a roster needs a canary_code_version')
        man['canary_pool'] = split_sentinel(run_id)
        man['canary_code_version'] = canary_sha
        man['canary_split'] = SPLIT_WITHIN_WORLD
        man['canary_roster'] = bots
    elif pool:
        if not canary_sha:
            raise InvalidManifest('a pool needs a canary_code_version')
        man['canary_pool'] = pool
        man['canary_code_version'] = canary_sha
    elif canary_sha:
        raise InvalidManifest('a canary_code_version needs a pool or a roster')
    load(man)                       # refuse to emit anything the loader would refuse
    return man


def cleared(man):
    """The manifest with every canary field cleared -- teardown step 2.

    Removes `canary_split` and `canary_roster` as well as the two legacy fields. Leaving the tag
    behind with the pool cleared would make `load` raise on a fleet with no canary at all, which
    turns a finished teardown into an unreadable manifest; leaving the ROSTER behind would leave
    the bots that were treated named as if they still were.
    """
    out = dict(man)
    out['canary_pool'] = None
    out['canary_code_version'] = None
    out.pop('canary_split', None)
    out.pop('canary_roster', None)
    load(out)
    return out
