# 14 · Refused, not unwilling

## The brief

When an agent doesn't do the obvious thing, the story that comes to mind is
that it didn't want to — the model is weak, the prompt is bad, it ignored the
instruction. That story is cheap and it is usually wrong. There are two ways
an action can fail to happen, and only one of them is visible from the
outside: the agent never proposed it, or the agent proposed it and something
in your own stack said no.

**Count the attempts before you believe the agent chose not to.**

The refusals are the part you built, so they are the part you can fix — but
they are also the part that does not appear in any success rate computed from
actions that *ran*. An agent that tries the right thing sixty times an hour
and is refused sixty times looks, in the logs, exactly like an agent that
never thought of it.

The second half is where those refusals come from. Every guard you write is
calibrated against the agent you have today: a constant, a radius, a symmetric
`Math.abs`, a "nobody would ever be up there" threshold. Those are not rules
about the world; they are snapshots of where your agents happened to be when
you wrote them. The moment an agent goes somewhere new, the guard keeps firing
with total confidence and refuses the one action that would save it.

## The deep end

### The scar

Three bots pillared to y=320 — the overworld build limit — and sat there for
nine hours. Every health check was green. The reflex layer diagnosed them
correctly (`stranded_high`, 59 times each in two hours) and the observation was
eventually fixed to say so in plain language: *"you must DESCEND."* They still
appeared to do nothing about it.

The instinct was to blame the model, and the first written diagnosis said
exactly that: *"even with a true observation and a legal action, it mostly
isn't acting on it."* That claim came from counting proposals of one verb.

Counting **all** descent attempts — `mine` downward, `goto` at the ground,
`home`, `explore` — told the opposite story:

    1,257 decisions by stranded bots over six hours
      164 DESCENT ATTEMPTS  (13% of everything they did)
        0 permitted

Five guards were refusing them, and each one was correct in the situation it
was written for:

1. `mine` admission rejected any `y > 120`. A constant standing in for "don't
   ask to mine into the sky", written when every bot was near the surface.
   Above y=120 it forbade the only action that helps.
2. `goto`'s elevation guard used `Math.abs(dy) > 40`. Its own comment names
   the case it was built for — *"the model repeatedly chose y=140 while
   standing at y=70"* — which is **up**. Written symmetrically, it refused
   every attempt to aim at the ground: *"y=73 is 247 blocks from your y=320."*
3. The exit contract demanded 8 scaffold blocks against a climb it had itself
   computed as zero, because `debt = max(0, seaLevel - y)` is 0 above sea
   level as well as at it. The refusal contradicted itself in one sentence.
4. `mine` refused to dig into a void below. **Correct, and unchanged** — it
   was a 250-block fall.
5. Nothing in the skill set could place a block underfoot going down. `place`
   searches the eight horizontal neighbours; `surface` places underfoot but
   only upward.

Four were fixed, the fifth was satisfied rather than bypassed, and the bot
that had not moved in nine hours descended within minutes — while an
identically-stranded bot on the unpatched build stayed exactly where it was.

The same shape had already appeared elsewhere in the same week and was not
recognised as a pattern until this: 45.8% of all decisions were `aborted`
before any skill ran, and every success rate the lab had computed came from
skill logs, which contain only the actions that got through.

### The rule

1. **Before diagnosing non-compliance, count attempts, not verbs.** An agent
   can express one intention through several actions. Counting the verb you
   expected instead of the *intention* you care about produces a confident and
   inverted answer.
2. **Refusals are outcomes and must be logged as such.** If a proposal is
   rejected before execution, it belongs in the same taxonomy as a failure. A
   success rate computed over executed actions silently conditions on your own
   gate letting the action through.
3. **Audit every guard for a frame of reference.** A hard constant, a fixed
   radius, or a `Math.abs` over a signed quantity encodes an assumption about
   where the agent is. Write the predicate in terms the agent carries with it
   — its own position, its own debt, its own inventory — so the rule means the
   same thing everywhere.
4. **Asymmetric situations need asymmetric guards.** Up and down, in and out,
   toward and away are rarely alike. `Math.abs` is the tell: it says the two
   directions are the same case, which they almost never are.
5. **When several correct guards compose into a trap, none of them will look
   wrong.** Each will have a good comment explaining a real incident. The trap
   is only visible from the agent's side, by counting what it tried.

### Why it's true

Guards are written in response to incidents, which means they are always
calibrated on the past distribution of agent states. Competent agents move the
distribution — that is what competence looks like — so guard quality decays
exactly as the agent improves. Meanwhile every guard is individually
defensible, so review never catches the composition; there is no line to
object to.

And the asymmetry of visibility does the rest. A refusal is cheap for the
system and invisible in the metrics that get computed, while the agent pays
the whole cost. Nothing in a green dashboard distinguishes an agent that never
tried from one that tried constantly and was told no.

### How it shows up per game

- **Minecraft** (practiced): altitude, depth, and distance guards. Anything
  keyed to sea level, the build limit, or "how far a bot would sensibly go."
- **TrackMania**: input and racing-line validity checks calibrated on the
  first tracks. A steering or braking constraint tuned on a flat circuit will
  refuse the correct input on a banked wall-ride, and the student will look
  like it can't learn the section when it is being prevented from trying.
- **BAR**: order-legality and build-placement filters. A "unit would never be
  ordered there" rule written from early games will veto the flanking move
  that wins later ones — and RTS orders are rejected silently and in bulk, so
  the attempt count is the *only* way to see it.

### The prediction

In every platform, the first serious "the agent won't do X" investigation will
find that the agent proposed X and the stack refused it, and the refusal will
come from a guard whose comment describes a real incident from an earlier
phase of the project. The attempt count will be non-zero on the first day
anyone bothers to compute it.

### The record

- **2026-08 · Minecraft**: held. Three bots stranded nine hours at the build
  limit; 164 refused descent attempts, 13% of their decisions; five guards, of
  which four carried a frame of reference that had stopped being true. Also
  held at fleet scale the same week: 45.8% of all decisions aborted before
  execution, absent from every success rate the lab had computed.
- *TrackMania: prediction pending.*
- *BAR: prediction pending.*
