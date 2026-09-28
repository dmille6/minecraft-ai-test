"""One definition of which arm a bot is in.

WHY THIS EXISTS. The canary cannot detect a change in items/bot-hour smaller than +217% --
output must roughly triple to be visible -- while decisions/bot-hour is detectable at 17%. The
project can measure how often bots think but not how much they gather, which is the goal.

One pool is ONE MINECRAFT WORLD. So assigning a canary by pool means every comparison carries
the full between-world difference in terrain, ore and water. Pools were measured drifting from
-45% to +77% on one metric in six hours with no code change (2026-09-04), which is exactly the
variance a pool-level contrast cannot escape. Treating 2 of the 5 bots in EVERY world instead
makes each world its own matched comparison and cancels that term.

WHAT WAS ACTUALLY BLOCKING IT, traced 2026-09-23: not the deployment. `canary-tree.sh` takes
BOT NAMES directly -- "Point ONLY the named units at it", `for bot in "$@"` -- and writes a
per-bot drop-in at /etc/systemd/system/mcbot@<bot>.service.d. Bot granularity has been available
the whole time. The blocker is the ANALYSIS layer: every read script assigns arms with

    K = lambda b, era: (('canary' if b.rsplit('-', 1)[0] in CANS else 'control'), era)

which strips a bot's last segment to get its pool, so `hive-a-Alpha` becomes `hive-a` and an
exact bot name in the spec could never match. One line, repeated across the reads.

THE CONTRACT HERE. A pool spec must behave EXACTLY as it does today, because every historical
canary read and every registration depends on it; bot names are additionally accepted. So a
within-world design becomes a change to what the manifest says, not to how a read works.

The isolated arm is the reason both forms must be matched rather than one chosen: `exp.pool`
holds 32 values of which 20 are single bots (`self-isolated-a-Bravo`), so for those the pool IS
the bot name and neither rule alone covers the fleet.
"""


def pool_of(bot):
    """The pool a bot belongs to: its name with the final `-Suffix` removed.

    Deliberately the same derivation the read scripts have always used, so this cannot become a
    second, disagreeing definition of a pool.
    """
    return (bot or '').rsplit('-', 1)[0]


def parse_spec(spec):
    """The manifest's canary field as a set. Accepts a comma-separated string or a sequence."""
    if spec is None:
        return set()
    if isinstance(spec, str):
        return {x.strip() for x in spec.split(',') if x.strip()}
    return {str(x).strip() for x in spec if str(x).strip()}


def arm_of(bot, spec):
    """'canary' or 'control'.

    A bot is canary when the spec names its POOL (today's behaviour, unchanged) or names the BOT
    exactly (new, and what a within-world design needs). Matching both is not laxity: for the
    isolated arm the pool and the bot name are the same string, so either rule alone is wrong
    for part of the fleet.
    """
    cans = parse_spec(spec)
    b = (bot or '').strip()
    return 'canary' if (b in cans or pool_of(b) in cans) else 'control'


def splits_a_world(spec, roster):
    """True when at least one world contains BOTH a canary and a control bot.

    This is the property a read actually needs in order to pair within a world, and it is
    derived from the roster rather than guessed from the shape of the spec. The first version of
    this function tried to infer it from the strings alone and was wrong: it applied pool_of() to
    SPEC entries, where pool_of('hive-a') returns 'hive'. pool_of is only ever meaningful on a
    BOT name -- arm_of applies it to the bot and never to the spec, which is why arm_of is
    correct and that inference was not.
    """
    seen = {}
    for b in roster:
        seen.setdefault(pool_of(b), set()).add(arm_of(b, spec))
    return any(len(arms) > 1 for arms in seen.values())


def split_within_world(roster, per_world, rng):
    """Choose `per_world` bots from EVERY world, as a canary spec of bot names.

    `roster`: iterable of bot names. `rng`: a random.Random, passed in so a draw is reproducible
    from its seed -- an unseeded draw cannot be re-checked afterwards, and this project requires
    that a pool draw be recorded and auditable.

    Raises rather than silently under-treating a world: a design that quietly skipped a world
    would reintroduce the between-world term it exists to remove.
    """
    worlds = {}
    for b in roster:
        worlds.setdefault(pool_of(b), []).append(b)
    thin = {w: len(v) for w, v in worlds.items() if len(v) < per_world}
    if thin:
        raise ValueError(f'cannot take {per_world} bots from every world; these have fewer: {thin}')
    out = []
    for w in sorted(worlds):
        out.extend(rng.sample(sorted(worlds[w]), per_world))
    return sorted(out)
