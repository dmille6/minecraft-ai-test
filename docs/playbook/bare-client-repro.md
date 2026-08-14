# 10 · Bare-client reproduction

## The brief

When a bot misbehaves in the world, the instinct is to dig through our own
code — we wrote it, so the bug must be ours. Weeks of this taught us to ask a
different first question: **does a plain, stock bot do the same thing?**

Spin up the simplest possible client — no memory, no LLM, no skills, just the
raw library — and reproduce the situation. If the bare bot misbehaves too,
the bug lives below us (the library, the protocol, the server), and no amount
of reading our own code would ever have found it. If the bare bot behaves,
*now* the search space is our stack, and it's a much smaller haystack.

This one question routinely converts days of wrong-direction debugging into
an hour of the right kind.

## The deep end

### The scar

Two saves on record. Instance #1's movement failures looked like our bug for
days — until a bare mineflayer bot showed native Paper 1.21.11 rejecting
*any* bot movement at 20 packets/sec; the fix was server-side, nothing in our
stack (see the `instance1-movement-is-protocol` memory: the whole VM rebuild
strategy followed from this repro). The collectblock pathology (pattern 4)
was likewise pinned by demonstrating the leak in the library's own primitives
rather than our wrappers — which is what justified removing the library
instead of endlessly patching around it.

### The rule

For any in-world misbehavior:
1. Reproduce with a bare client before reading your own code.
2. The bisection is binary and cheap: bare-bot-broken → library/server/
   protocol; bare-bot-fine → our stack.
3. Keep the bare client one command away (a checked-in script), because a
   diagnostic that takes setup effort doesn't get run.
4. The repro script *is* the bug report if the fault is upstream — pattern 13
   applies (our collectblock findings are contribution-ready because the
   repro exists).

### Why it's true

An agent stack is layers of other people's code with ours on top, and bugs
distribute across all layers — but our attention doesn't. We debug what we
can see, and we can see our own code. The bare client is an instrument for
making the lower layers visible. It also produces the minimal test case as a
side effect, which is the expensive half of any upstream bug report.

### How it shows up per game

- **Minecraft** (practiced): bare mineflayer bot, stock pathfinder, no
  cognitive stack.
- **TrackMania**: bare = TMInterface driving scripted inputs with no RL, no
  coach. Physics oddity, save-state corruption, or timing drift that
  reproduces there is the tool's, not the training loop's.
- **BAR**: bare = a headless match with stock BARb and an empty gadget that
  only logs. Desyncs, order rejections, or performance cliffs that appear
  there are the engine's or the game's — and with BAR's Lua layer under
  active development (no versioning for our benefit), this check will matter
  *more* than in Minecraft, not less.

### The prediction

In each new platform's first month, at least one multi-day "our harness is
broken" investigation will end at an upstream fault that a bare-client repro
would have identified on day one. The discipline pays for itself the first
time it fires; the script should exist before the first bug does.

### The record

- **2026-08 · Minecraft**: held twice (Paper movement protocol; collectblock
  leak). Both saved the project from fixing the wrong layer.
- *TrackMania: prediction pending.*
- *BAR: prediction pending.*
