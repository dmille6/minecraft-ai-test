# 8 · Two-clock freshness

## The brief

Small communities before the internet ran on news that traveled at walking
speed — and they understood something we had to rediscover: information has
two ages. When was the thing *seen*, and when were you *told*?

Both matter, differently. Whether a warning is still *true* depends on when
the hazard was observed — a "wolves near the pass" report is stale a week
after the sighting, no matter how recently you heard it. But the *reward* for
carrying news must key on observation time too, or you get a gossip economy:
agents re-posting old news as fresh to collect the credit.

The rule: every shared item carries both timestamps — `observed_at` and
`posted_at`. Truth confidence decays from the observation clock; sharing
rewards pay from the observation clock; shelf life for expiry runs from the
posting clock. Mixing them up creates either a rumor mill (old news
circulating as new) or wasted knowledge (fresh news discarded as old).

## The deep end

### The scar

A design-review catch, not a live incident — caught during the bulletin-board
adversarial review before it could ship. The board design rewards "freshness"
to motivate bots to travel and deposit news. First draft keyed freshness to
posting time, which is gameable by re-posting: a bot could ferry stale
lessons between boards, collecting freshness rewards for information the
network already had, inflating apparent knowledge flow while adding nothing.
The fix: reward and confidence run on `observed_at`; only expiry (the
board's garbage collection) runs on `posted_at`. TTLs sized so news can
physically cross the map before expiring — a shelf life shorter than travel
time silently deletes the treatment.

### The rule

- Two timestamps on every shared knowledge item, never conflated.
- Confidence/credit: functions of `now - observed_at`.
- Expiry/retention: functions of `now - posted_at`.
- TTL floor: max plausible transport time across the world, or the sharing
  mechanism can't work even when agents use it perfectly.

### Why it's true

Any system that rewards information transfer creates an information
*economy*, and economies get gamed by whatever the reward actually measures.
Posting time measures activity; observation time measures novelty. Reward
activity and you buy activity — circulation without information. This is
Goodhart's law applied to gossip, and it generalizes: decayed-credit schemes
appear in any multi-agent design that wants knowledge to move.

### How it shows up per game

- **Minecraft** (designed, Block 2): bulletin-board news items, warning
  quorums, freshness rewards, death obituaries — all dual-stamped.
- **TrackMania**: pace notes age on the *track-version* clock (a note
  observed on last month's physics may be false today) — the "observation"
  clock generalizes to "validity context." A note's transfer credit should
  pay on measured learning-curve improvement, not on delivery.
- **BAR**: scouting intel is the purest case — "enemy air factory at north
  ridge, observed 14:32" decays in truth as the enemy builds; a stale intent
  built on it needs the staleness *visible* (pattern 2's sitreps carry
  observation timestamps so tiers can flag "your plan is older than my
  evidence").

### The prediction

Any sharing mechanism with a single timestamp will exhibit one of two
pathologies within its first block: re-circulation farming (if rewards key on
posting) or premature discard of valid knowledge (if expiry keys on
observation). The two-clock split prevents both, and no single-clock scheme
can.

### The record

- **2026-08 · Minecraft**: designed in, adversarially reviewed twice; live
  test comes with the board arm in Block 2.
- *TrackMania: prediction pending.*
- *BAR: prediction pending.*
