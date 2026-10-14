# Elasticsearch completeness check: files vs `mcai-skill-agents` / `mcai-llm-agents`, 2026-10-07 to 2026-10-14

**Final run: cutoff 2026-10-14T18:46:00Z, ES queried 19:13Z (run `final2`).** Read-only throughout.

- **Scripts:** `scripts/host/escheck/`. Run `run.sh 2026-10-07 2026-10-14` on 10.0.0.31.
- **Raw outputs:** on 10.0.0.31 in `~/escheck/final2/`: `files.json`, `es.json`, `reconcile.json`, `filebeat.json`, `summary.json`, `digest.txt` and `mapping-*.json`.
- **Auth:** the owner's read-only API key file only. The key was never printed, logged or copied.

A first run (`final`) was reviewed by Codex and Claude. They found real defects in the method,
listed in the appendix. Every finding was addressed, and the numbers below come from the
re-run. The reviewers' second round found three smaller issues, fixed afterwards: an
empty-hit bug in the extras check, the extras sample covering only the first minute, and
term-length probe statuses. 10-07 was then re-reconciled (`reconcile-2026-10-07.json`,
overlaid by `compare.py`).

## Verdict

**Verdict: from 2026-10-08 onward, ES is complete enough to be the default for wide analysis.**
Every bot-day was reconciled row by row. Over 10-08 to 10-14, ES lost
**344 of 8,851,670 skill rows (0.0039%)** and **59 of 1,089,658 llm rows (0.0054%)**. It holds
**0 extra docs**. Every lost row is in the log-rotation minutes 23:57-00:00.

Four gaps have to be handled:

1. **2026-10-07 is over-counted.** ES holds 4,633 skill and 415 llm extra docs. Almost all are
   exact re-sends after the 05:01Z crash.
2. **Null and absent look the same in ES.** Keys whose value is null never reach it.
3. **`llm.brain` is unmapped in the live write index.** brain-01 would have its llm docs
   rejected whole.
4. **Nothing before 10-07 was validated.**

Both review verdicts are recorded at the end.

## Denominators and method

| side | what | how |
|---|---|---|
| files | 10,845,247 skill + 1,345,031 llm lines, 724 + 724 files, 88 bot dirs (80 live + 8 retired `*-Charlie`) | One streaming walk (`nice 19`, `ionice idle`, ~20 min, one core). Every row is parsed and bucketed by **its own `@timestamp`**. Rows are stamped when a skill starts, so a day-D row can sit in rotated file D+1 or D+2. Both are read. |
| ES | `_count` + `terms(bot.name)` x `date_histogram(1h)` per UTC day, over the same half-open windows. Today's window is [00:00, 18:46:00Z). | `bot.name` keyword, `@timestamp` date, `skill.name`/`trigger` keyword, all confirmed from the live mapping. Both indices are `dynamic: strict`. The window spans backing indices `...10.01-000009` and `...10.08-000010`. |
| reconcile | For **every** bot-day (640 per stream), the exact multiset of skill `(ts_ms, skill.name, skill.status, skill.duration_ms)` and llm `(ts_ms, trigger, llm.latency_ms, prompt.system_hash)`, files vs ES composite aggregation. | **Gross** loss and **gross** extras, by minute. For up to 25 extra keys per bot-day, spread evenly over the day, every ES doc at the key is fetched and compared with the file row (nulls dropped, integral floats as ints). |

## Controls (each zero below has a twin that finds something)

| control | skill | llm |
|---|---:|---:|
| whole-window `_count` | 9,745,563 | 1,203,874 |
| one real bot, whole window | 271,958 | 17,385 |
| **nonexistent bot** | **0** | **0** |
| **window in 2001** | **0** | **0** |
| `_count` == hits.total == sum(bot buckets) + missing bot.name, other-bucket = 0, every day | 8/8 | 8/8 |
| spot matcher on 30 docs drawn **from ES** (must be found) | 30/30 | 30/30 |
| spot matcher on 30 rows shifted -400 days (must not be found) | 0/30 | 0/30 |
| **content sensitivity**: changes planted in 40 matched rows (string edited, number +1, bool -> 1, value -> `"null"`, key deleted) must be reported against the same `_source` | 160/160 | 200/200 |
| mapping judge, 8 direct probes + 11 planted **rows** run through the same `walk()` the census uses (unmapped field, keyword receiving an object, flattened receiving a scalar, float receiving `"abc"`, a long over 2^63, 40 KB strings in the keywords `bot.held` and `bot.name`; clean rows including a 1 KB `bot.name`). The status reached for each probe is recorded. | 19/19 | 19/19 |
| filebeat `dropped` counter vs the rejected-event log, 10-06 / 10-07 | 31 = 31, 27 = 27 | (same) |
| the 10-10 13:28Z **clean** reboot | 0 extras on 10-10 | 0 extras |

The client also refuses timeouts, failed shards and `terminated_early`. Defects found on the
way, now fixed:

- `fbjournal.py` globbed the root-only `/var/log/filebeat` as `mike` and reported **no
  rejections**. It now lists through `sudo` and refuses an empty listing.
- A string cutoff compare counted `18:00:00.123Z` as earlier than `18:00:00Z`, producing 13
  phantom losses.
- The drill read files D and D+1 only. It missed a late-stamped row and called it an ES-only extra.

## 1. Counts per UTC day

| day | skill file | skill ES | file-ES | llm file | llm ES | file-ES |
|---|---:|---:|---:|---:|---:|---:|
| 10-07 | 889,632 | 894,237 | **-4,605** | 113,868 | 114,275 | **-407** |
| 10-08 | 1,281,875 | 1,281,826 | 49 | 158,601 | 158,591 | 10 |
| 10-09 | 1,270,361 | 1,270,309 | 52 | 160,586 | 160,579 | 7 |
| 10-10 | 1,279,431 | 1,279,373 | 58 | 162,388 | 162,381 | 7 |
| 10-11 | 1,322,949 | 1,322,887 | 62 | 160,185 | 160,176 | 9 |
| 10-12 | 1,303,669 | 1,303,632 | 37 | 161,684 | 161,674 | 10 |
| 10-13 | 1,306,974 | 1,306,930 | 44 | 162,840 | 162,828 | 12 |
| 10-14 to 18:46Z | 1,086,411 | 1,086,369 | 42 | 123,374 | 123,370 | 4 |

The worst day is llm 10-13 at 0.999926. The brief's 1,307,023 for 10-13 counts the rotated
**file** `-20261014.gz`. Aligned by row timestamp, 10-13 has 1,306,974 rows.

**From 10-08 on, gross equals net.** The every-bot-day reconcile finds:

- skill: **344 lost, 0 extra**, against the 344 net deficit.
- llm: **59 lost, 0 extra**, against 59 net.

So at the 4-field-key level, no duplicate hides behind these totals. A row lost and replaced
under the same key would be invisible here. The 3,200 spot-checked rows, compared field by
field, found every row with equal content. By minute, skill loses 295 rows at 00:00 and 49 at
23:59. llm loses 43 at 00:00, 13 at 23:59, 1 at 23:58 and 2 at 23:57. **Nothing is lost
outside 23:50-00:10.**

The per-bot-hour output (`bot_hours` in `summary.json`) says the same thing a different way.
Hours 01-22 hold 1,760 bot-hours per day (1,440 today), and for 10-08 to 10-14 **0 of them
differ**, in both streams. In the two rotation hours, 20-33 of 160 skill bot-hours and 4-12 llm
bot-hours differ each day.

This is the `copytruncate` race. Rows written after filebeat's last read and before the
truncate are in the `.gz` copy but are never shipped. (The logrotate comment says the race only
loses rows that are "already in Elasticsearch". That is wrong in this direction.) Rows written
between the copy and the truncate that filebeat had **not** read are lost from both sides, and
neither side can see them. Rows it **had** read reach ES with no file row behind them. From
10-08 on, that case is 0.

**Per kind**, the loss spreads over common events in proportion to their frequency. From 10-08
on, `_path_reset` totals 66, `_affordance_scan` 56 and llm `idle` 56. The largest single
day-kind is 13. All of it sits in the rotation minutes, so no event type is being rejected.
There are 188 skill kinds and 13 llm triggers, and both sides have the same set.

**10-07: re-sends after a crash.** Host .31 went down at 05:01:47Z and came back at 11:53Z
(`journalctl --list-boots`). On restart, filebeat re-shipped rows it had already sent.

| | extra | lost | extras checked against `_source` |
|---|---:|---:|---|
| skill, all 80 bot-days | 4,633 | 28 | 169 identical to the file row (re-send), 20 with no file row at that key |
| llm | 415 | 8 | 37 re-send, 6 with no file row |

The extras check is a sample. It covers 189 of 4,633 skill extra keys and 43 of 415 llm,
up to 25 per bot-day spread across that bot-day's extras. On the three big bot-days, 25/25 are re-sends.

The re-sends are exact doubles. Every row in hours 01-04 appears twice for placebo-a-Comet
(434 -> 868 in hour 01), isolated-c-Echo (360 -> 720) and llm placebo-b-Bravo (71 -> 142).
Hour 00 is double less its own rotation loss (579 -> 1,156), and hour 05 runs to 05:01. Most other bots carry 1-10 extras at 05:00-05:01, and those are **not** clean doubles.
isolated-c-Echo's hour 05 is 9 -> 27. One skill doc at 11:55, on placebo-b-Bravo two minutes
after the 11:53 boot, has no file row. The 20+6 extras with no file row fall at 05:00-05:01,
apart from that one. They are consistent with rows that ES
received but that the files lost in the crash, though that is not proven. The files hold 35
skill and 24 llm unparseable lines, all in the `-20261007.gz` and `-20261008.gz` generations,
which hold the 10-06 17:07Z and 10-07 05:01Z crashes. Filebeat refused 58 lines on those days,
as `message` + `error.*` docs that the strict mapping rejected. That does not reconcile 1:1
with the 59 lines in the files. A NUL run is one "line" to the reader whatever filebeat saw
earlier, so it is not claimed to.

**Freshness.** File tails and ES newest-per-bot were read in the same second.

| | median lag | p90 | max | bots with a doc in the last 3 h |
|---|---:|---:|---:|---|
| skill | 5.7 s | 31 s | 62 s | 80 of 80 |
| llm | 0 s | 38 s | 201 s | 80 of 80 |

## 2. Field coverage (every row, not a sample)

Every node of all 10.8M skill and 1.34M llm rows was censused. That covers objects, leaves,
list elements, numeric min/max and the longest string in UTF-8 bytes. Each path was judged
against each backing index in the window, taking `dynamic` from the nearest object.

| | paths | mapped | under `flattened` | null-only | **strict-rejected** | **type / range / term-length conflict** |
|---|---:|---:|---:|---:|---:|---:|
| skill | 586 | 48 | 536 | 2 | **0** | **0** |
| llm | 317 | 60 | 255 | 2 | **0** | **0** |

The ranges observed all fit their mapped types:

- llm: `llm.retry_count` (short) 0-1, `memory.cited_fails` (integer) 4-5,057, and
  `llm.args_cleaned` (integer) 0 throughout.
- skill: `board.reporters` (integer) 0-5.
- The longest keyword value is 70 characters and the longest flattened leaf is 182
  characters. Even at 4 bytes a character, both are far under Lucene's 32,766-byte term limit.
- Flattened depth reaches at most 2, against the limit of 20.

These are type-level and range checks. Coercion of numeric strings and date formats are not
judged here. Filebeat's `dropped` counter covers what actually arrived.

The truncation seen in the data happens in the **bot**, not in ES. `skill.detail` is capped at
500 characters and `prompt.text` at 6,000, in the files too.

**Rejections.** Filebeat's `dropped` was **0 every day from 10-08 to 10-14**. It was 31 on 10-06
and **27 on 10-07**, all of them the crash lines above, which were never valid rows. The only
other rejections on record are 2,950 on 09-16 (`bot.tools`, `llm.args_cleaned`), the migration
documented in `infra/elk/llm-backfill.py`.

**The brain-01 agent's claim, checked.**

- `llm.args_cleaned` (integer), `llm.args_cleaned_fields` (keyword) and `llm.model_mismatch`
  (keyword) **are mapped** in every llm backing index since `...09.16-000007`.
- Both `args_cleaned_fields` and `model_mismatch` are `null` in **every** llm row of the window.
- **`llm.brain` is genuinely unmapped** in the live write index `...10.08-000010`.
  `origin/brain01-on-82aef34` writes `llm.brain` with a non-null value on essentially every
  decision, and it changes only the **template**.
- Backing indices roll weekly (10-01, 10-08), so the next rollover is due about 10-15.
- If brain-01 deploys before that rollover, or before someone applies its template change to
  the cluster, every brain-01 llm doc is **rejected whole**. That is the 09-07 to 09-16 hole again.

`_ignored` is empty, but that is not evidence. No mapped field sets `ignore_above` or
`ignore_malformed`, so nothing could be recorded there.

## 3. Spot equality (200 seeded random file rows per stream per day)

| | sampled | found | `_source` == row exactly | == row ignoring null-valued keys | non-null value missing or different |
|---|---:|---:|---:|---:|---:|
| skill | 1,600 | 1,600 | 1,558 | **1,600** | **0** |
| llm | 1,600 | 1,600 | 0 | **1,600** | **0** |

**Every difference is a key whose value was `null`.** Filebeat does not ship null-valued keys.
Every llm row has at least one, because `model_mismatch` and `args_cleaned_fields` are always
null. Other examples are `llm.error`, `llm.admission` and `bot.held` (34 skill, 64 llm).

Multi-hits are docs sharing bot + ms + kind. There were 8 skill (5 on 10-07, 2 on 10-11, 1 on
10-13) and 2 llm (both on 10-07). The files themselves carry 16,293 byte-identical skill rows
and 26,072 repeats of the 4-field key, so same-key events are real, not artifacts.

## Gaps and recommendations (none applied; no filebeat, mapping or live change was made)

1. **10-07 (and any day after an unclean host stop).** The default is to **exclude 10-07 from
   ES counts**. Until ~10-21 the files are still on disk and are the better source for that day.

   Do not dedup by `(bot, @timestamp, kind)` or by whole `_source`. The files hold 16,293
   legitimate byte-identical skill rows over the window, and either rule deletes them.

   Halving is exact only in the exactly doubled windows: hours 00-04 of skill placebo-a-Comet,
   skill isolated-c-Echo and llm placebo-b-Bravo. The 05:00-05:01 extras on most bots and the
   11:55 doc are not doubles, and halving would corrupt them.

   `reconcile.py --days D` lists any day's affected bot-days. A deterministic `_id` at ingest
   would make re-sends idempotent. That is an owner decision.
2. **Before brain-01 deploys**, map `llm.brain` on the live stream. Either
   `PUT mcai-llm-agents/_mapping` with `llm.brain: keyword`, or apply the template and let the
   ~10-15 rollover happen first. Then confirm filebeat `dropped` stays at 0.
3. **Rotation loss** is about 40-60 skill and 5-12 llm rows per day, all at 23:57-00:00. That
   is negligible for rates. It matters only to analyses of the midnight minute. A fix needs
   filebeat to read the rotated generation, or the bots to reopen their file on SIGHUP.
4. **Null and absent are the same in ES.** Questions like "how often is X null" must use the files.
5. **What ES cannot answer even when complete:**
   - `skill.detail` is `text` with no keyword, so it cannot be aggregated.
   - Flattened fields (`bot.inventory`, `skill.args`, `perception`, `bot.tools`,
     `skill.inventory_delta`) store their leaves as keywords. Numeric sums and ranges over them
     must be computed from `_source`.
6. **History before 10-07 is outside this check.** Known holes are llm 09-08 (unrecoverable) and
   09-09 to 09-16 (backfilled, per `llm-backfill.py`). Run `run.sh` over any older window while
   its files still exist (14 generations).

## Appendix: what the first review round found, and the fixes

Codex (NOT-COMPLETE-ENOUGH) and Claude (COMPLETE-ENOUGH, with conditions) reviewed run `final`.

| finding | fix in `final2` |
|---|---|
| Net per-hour equality can hide a loss plus a duplicate. Only 16 bot-days were multiset-checked. | `reconcile.py` checks all 640 bot-days per stream, gross, with a 4-field key and a `_source` check of the extras. |
| The drill missed a late-stamped row in file D+2 and reported it as an ES-only extra (board-d-Comet 10-11, 19,080 vs 19,081). | `files_for` reads D to D+2. The drill and the walk now agree (19,081). |
| The "<=3 per kind" claim netted 10-07's surplus against later losses. | `compare.py` now reports gross per-day-kind (`_path_reset` 66). |
| "12,000 bot-hours match" was not emitted by any script. | `bot_hours` and `bot_hours_nonzero_01_22` are in `summary.json`. |
| llm losses at 23:57 and 23:58 were omitted. | Stated. |
| The dedup key would delete legitimate same-key rows. | File-side repeats are priced (16,293 identical rows), and the recommendation changed. |
| The classifier was tested on paths, not rows. `dynamic` on a property-less object was not inherited correctly. There were no range or term-length checks. | Planted rows now go through `walk()`. Own `dynamic` is kept. Numeric ranges, the 32,766-byte limit and flattened depth are checked. Non-empty objects are censused as `dict`. |
| Equality was decided on the printed value (`"null"` passed as null, and `True == 1`). There was no content-sensitivity control. | Equality is type-strict, and mutants are planted (160/160 and 200/200 detected). |
| `fbjournal.py` ignored `cat` failures and skipped malformed metric lines silently. `ts_ms` accepted non-canonical stamps. `botday.py` ignored the cutoff. | All three now raise or count. |
| (round 2) `check_extra` labelled an empty hit list "identical payload", capped hits at 20 unchecked, and ignored missing-field keys. | An empty answer is labelled a matcher failure. A truncated answer is labelled as such. Absent fields need `must_not exists`. A re-send must have more ES docs than file rows. |
| (round 2) Extras sampled only the first 25 keys, so the big bots were checked in minute 00:00 only. | The sample is now evenly spaced over the day. 10-07 re-run gives the same 169/20 and 37/6, with the big three at 25/25 across 00:00-05:01. |
| (round 2) The term-length probe recorded only flagged or clean. `bot.held` was a probe. | The status is recorded for each probe. `bot.held` is a live keyword, and a 40 KB `bot.name` probe and a clean 1 KB one were added. |
| (round 2) `bot.held` 40/89, "bytes", "every defect fixed". | Corrected to 34/64 and characters, and the wording is narrowed. |

## Reviews

The full texts are in `docs/reports/es-completeness-2026-10-14-reviews.txt`.

**Round 1, on run `final`.**

- **CODEX: NOT-COMPLETE-ENOUGH.** It asked for these fixes:
  - reconcile gross loss and extras across the whole fleet;
  - resolve the 19,080 vs 19,081 discrepancy;
  - repair the classifier and equality controls;
  - narrow the rejection wording;
  - map `llm.brain`.
- **CLAUDE: COMPLETE-ENOUGH-AS-DEFAULT for 10-08 onward**, provided:
  - the per-kind and per-bot-hour claims are corrected or backed by script output;
  - the drill window is fixed;
  - the multiset extras are emitted;
  - the dedup key is replaced;
  - `llm.brain` is mapped before brain-01.

**Round 2, on run `final2` (every finding addressed, see the appendix).**

- **CODEX: COMPLETE-ENOUGH-AS-DEFAULT.** It names five gaps to handle:
  - the midnight rotation loss;
  - use the files, or exclude the 10-07 replay windows;
  - keep null-versus-absent analyses on the files;
  - map `llm.brain` before deployment;
  - validate history before 10-07 separately.

  It noted three residual issues, all fixed after it: the `check_extra` empty-hit bug, the
  `bot.held` counts, and chars versus bytes.
- **CLAUDE: COMPLETE-ENOUGH-AS-DEFAULT for 10-08 onward.** Before 10-07 is used:
  - name the exact doubled windows, or make whole-day exclusion the default (now the default);
  - name the hour-11 extra (11:55, placebo-b-Bravo).

  Before the classifier is relied on for new fields, it should record a status per probe and
  put a term-length probe on a keyword known to be mapped. Both are done.

**Agreed verdict: ES is complete enough to be the default source for wide analysis from
2026-10-08 onward.** Four gaps have to be handled:

1. Exclude 10-07, or use its files, while they last.
2. Expect about 50 skill and 5-12 llm rows a day lost at 23:57-00:00.
3. Use the files for null-versus-absent questions.
4. Map `llm.brain` before brain-01 deploys.

History before 10-07 needs its own run.
