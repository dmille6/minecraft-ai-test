# reconnleak-01show: what each connection starts, and where it ends (2026-11-18)

`connect()` in `bots/src/index.mjs` runs again on every reconnect. Anything it starts that something process-wide still
references (a timer, a `process` listener, a module-level registry) keeps the dead connection's `bot`, `Client` and `World`
alive: about 20 MB of chunk ArrayBuffers each (live: 329 columns held, ~22 MB a reconnect; sandbox2: 213 columns, ~14 MB).

## Evidence
- Showcase 11-18 (a5aae063): every arrayBuffers step in `_chunks_evicted` falls on a reconnect (the sweep counter resets);
  a reconnect storm 07:30-08:05Z took Alpha 26 -> 355 MB, Onyx 51 -> 386, Haven 79 -> 427 (rss to 1,448 MB).
- Kick rig (ci2 -> sandbox2, real `index.mjs`, LLM off, 3 bots an arm, 22 RCON kicks each, 11-18 10:11-11:44Z):
  b6b83327: arrayBuffers 14-17 -> 335-337 MB, rss 192 -> 769-809 MB (~14.5 MB a kick); heap snapshot after: **23 World,
  23 Client**, the old ones retained through `timerListMap -> Timeout._onTimeout -> context bot` (and `ctx:moves`, the
  wedge sampler's context). reconnleak-01show: arrayBuffers 17 at the end (one old world at most between GCs), rss 229-260 MB;
  snapshot after: **1 World, 1 Client**.

## Every per-connection resource in connect() (b6b83327 line numbers)
Timers:
| line | what | ends |
|---|---|---|
| 271 | `memTimer` setInterval 10 s (memory logger) | **was never cleared -> fixed: `bot.once('end')`** |
| 342 | `zoneTimer` | `bot.once('end')` 343 |
| 347 | `planTimer` | `bot.once('end')` 349 |
| 367 | `wornTimer` | `bot.once('end')` 374 |
| 382 | `toolDiffTimer` setTimeout | `bot.once('end')` 399 |
| 589 | `deathSitesTimer` | `bot.once('end')` 590 |
| 629/632 | `wellsTimer`, `wellsFirst` | `bot.once('end')` 633 |
| 681 | `lidHitsTimer` | `bot.once('end')` 685 |
| 705/707 | `scafAreaTimer`, `scafHitsTimer` | `bot.once('end')` 711 |
| 728 | `czHitsTimer` | `bot.once('end')` 732 |
| 1107 | pathfinder-wedge position sampler, setInterval 2 s, anonymous | **was never cleared -> fixed: named `wedgeTimer`, `bot.once('end')`** |
| 1266 | `tgTimer` | `bot.once('end')` 1276 |
| 1340 | `koTimer` | `bot.once('end')` 1350 |
| 1369 | `pzTimer` | `bot.once('end')` 1380 |
| 1398 | `egTimer` | `bot.once('end')` 1407 |
| 1421 | `lsTimer` | `bot.once('end')` 1423 |
| 1440 | `peakTimer` (module-level `let`) | cleared before re-arming (1439) and in the `end` handler |
| 1514 | `startTimer` setTimeout | `bot.once('end')` 1518 |
| 1635 | `setTimeout(connect, delay)` | the reconnect itself; fires once |

Process listeners:
| line | what | ends |
|---|---|---|
| 301 | `process.once('exit', stopTrace)` (only with AIR_TRACE_MIN > 0) | **was kept for every old connection -> fixed: removed and stopped on `end`** |
| ~1490 | viewer HTTP server (VIEWER_ENABLED=true only) and its port probe | **held the old bot and its port -> fixed (Codex r1): closed on `end`; a probe pending at `end` starts no viewer** |
| 1658 | `process.on('unhandledRejection')` | module level, once a process (holds nothing per connection) |

Installed per connection (listeners on the connection's own `bot`, `bot._client`, `bot.inventory`, `bot.pathfinder` or its
`Movements` die with that connection once nothing else holds it): `installOxygenGuard`, `installDigCollisionWatch`,
`installFeatures`, `installCraftSync`, `installShoreEgress`, `installNoBridge`, `installCornerRule`, `installLidPrice`,
`installScafTownPrice/Search`, `installCleanZoneFilter/Search` (per-connection objects); `installWellWatch` (`wellWatch.stop()`
on end); `startReflexes` -> `stopReflexes()` on end; `watchForDeathCause` -> `stopDeathWatch()` on end; `startChunkEvictor`
(stops itself on `end`, hivedrop-01); `shopAckInstall`'s presence beat (cleared on end); cognitive loop and watchdog
(`stop()` on end); `installPathBackoff()` (no bot argument). The bot's own `on('spawn'|'health'|'death'|'kicked'|'error'|'end'|
'path_*'|'goal_reached'|'move')` handlers live on the connection object itself.

The structural check is `bots/test/reconnleak.test.mjs` (every timer and `process` listener started in `connect()` is cleared;
anchored mutants for the three found). The heap-snapshot count (1 World after 22 kicks) is the empirical check that nothing
outside `connect()`'s own text still holds an old connection.

Not fixed here (pre-existing, Codex r1): with Microsoft auth, a rejection before the socket exists emits only `error`, not
`end`, so that connection's timers stay and no reconnect follows. Every bot here runs `MINECRAFT_AUTH=offline`.
