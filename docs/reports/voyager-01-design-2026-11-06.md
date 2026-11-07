# voyager-01: a Voyager-style creative-bot pilot (design, 2026-11-06)

**OWNER (11-06):** "Build the voyager-01 pilot with local coding models (Blackwell + Studio) plus a cheap Haiku comparison."
Research: the PRIORITY section of the 11-06 external research (Voyager status, successors, MindForge's evidence that 7-8B
coders fail "collect dirt", the pilot shape). This file is the build design. It is written, and the success bar fixed,
**before** anything launches.

## 0. What the pilot asks

Can a bot that **chooses its own tasks, writes its own code for them, and keeps what works** do more interesting things in an
unseen world than our scripted bots? And which code model makes that affordable?

- Nothing from our job list, milestone list or town plan goes into the arms' prompts.
- **The world is a BRAND-NEW random seed**, drawn 11-06 with `secrets.randbits(63)`: `-1114639111322860839`. Nobody looks at
  the map before launch and no code is tuned to it (owner rule 11-06, [[owner-freshworld-1106]]).
- One bot per arm, one Paper server per arm, all on copies of the same seed. Each arm starts at the same spawn in the same
  untouched world, and arms cannot take each other's trees.

| Arm | Coder (also curriculum) | Where | Notes |
|---|---|---|---|
| **A** | Qwen3.6-35B-A3B (`qwen3.6:35b-a3b`, already pulled) | the Blackwell's public Ollama port, `ai.ticrcorp.com:11438` | Testing only (owner 10-31): time-boxed, unloaded at the end (`keep_alive: 0`) |
| **B** | Qwen2.5-Coder-32B (`qwen2.5-coder:32b`, ~20 GB pull) | the Studio's Ollama, public port `ai.ticrcorp.com:11436` (checked 11-06: version 0.40.3, the same daemon `ssh mike@ai.ticrcorp.com` sees) | The Studio's **LM Studio** serves the showcase brain (gemma4:26b, ~30 GB); Ollama there is idle. Guarded so arm B cannot slow the showcase (§6.3) |
| **C** | Claude Haiku 5.5 (`claude-haiku-5-5`, $0.10 / $0.50 per MTok) | Anthropic API, key held only by the proxy | Spend cap $20 for the 48 h run. Its outputs are **eval-only, never training data** (owner 11-01, vendor terms A) |
| **Control** | our fleet harness (`bots/src/index.mjs`, LLM picks among scripted skills) | Blackwell `qwen2.5:7b-instruct` | The fleet now runs r3-4B on the 5080; the 5080 is off limits, so the control uses the fleet's listed fallback model. A known deviation, stated in every read |

**"72B coder":** no Qwen2.5-Coder-72B exists. `qwen2.5:72b-instruct` (47 GB, not a coder) and `qwen3-coder:30b` (an A3B MoE coder,
already on the Studio) were considered. Arm B stays the owner's named Qwen2.5-Coder-32B: it is the *dense* coder, which is what
makes it a different bet from arm A's A3B MoE. `qwen3-coder:30b` is the fallback if the pull fails.

## 1. Measured before the design (11-06)

- **Worlds host 10.0.0.30:** 32 cores, 78 GB RAM (41 GB available), 228 GB disk free, load ~3. Paper 1.21.8 build 60 (sha
  `8de7c52c…`) is in every fleet world; `paper-api-1.21.8-R0.1-SNAPSHOT.jar` is in their `libraries/`. Java 21 runtime, **no
  JDK, no Docker, no podman, no compiler**; Node 18. systemd 255 (cgroup v2), sudo works.
- **Fleet bots** run on 10.0.0.31 under `mcbot@.service` (Node 22.23.4, `MemoryMax=1G`, `ProtectSystem=full`). The fleet's
  Paper servers listen on `*:25570-25606` and `*:25670-25706` on .30, so **any process on .30 that can open a TCP socket to
  127.0.0.1 can reach every fleet world**. That decides the network design (§3.2).
- **ci2 (10.0.0.34):** Node 22.23.4, g++, make, javac 21. Builds happen there, not on the Mac mini and not on .30.
- **Blackwell (`:11438`, Ollama 0.33.2):** has `qwen3.6:35b-a3b` (22.6 GB). Loaded now, with keep-alive forever:
  qwen2.5:32b 38.5 GB, qwen2.5-coder:7b 9.0 GB, nomic-embed 0.3 GB (48 GB). Loading A adds ~23 GB plus its cache. If the card
  cannot hold all of it, Ollama evicts a pinned model, which would disturb someone else. §6.2 checks that first.
- **Studio:** Ollama 0.40.3, nothing loaded; LM Studio holds ~30 GB (the showcase brain via the 11501/11502 proxies);
  memory_pressure 97% free; the GPU wired limit is ~96 GB. `qwen2.5-coder:32b` is **not** pulled (only 7b/14b).
- **Keys:** the existing `~/.config/mcai/anthropic.key` on the Mac (mode 600; owner 10-23: "use the keys that are already
  there"). The referee reads it the same way. It is never printed.

## 2. The loop (Voyager's, rebuilt in Node on our harness)

One **iteration** per arm:

1. **Curriculum** (one LLM call). Input: inventory, equipment, position, biome, time of day, the 16-block block census, the
   names and one-line descriptions of the library's skills, the last 10 finished and last 10 failed tasks. The prompt says,
   in effect, "you are exploring an unknown world; propose the next task that teaches you something you can't do yet, or a
   project you want to build". Output is **JSON**: `{task, why, success}`, where `success` is one of a few typed checks (§2.1).
2. **Feasibility filter** (code, no LLM). The item or block must exist in `bot.registry`. The task must not need something
   peaceful-plus-no-Nether makes impossible (nether quartz, blaze rods, ender pearls from mobs, mob drops: a fixed list from the
   11-06 internal research §1). A refusal goes back to the curriculum with its reason, at most 2 re-asks.
3. **Retrieve**: the 5 library skills whose name and description best match the task (token overlap; no embeddings, no vector
   DB, nothing unpickled).
4. **Code** (up to 4 rounds). The coder writes `async function <camelName>(bot) { ... }` against the facade (§4). Each round
   gets the previous code, its error or the facade's refusal, its execution log and the world delta.
5. **Run** the code in a fresh isolate (§3.3). Retrieved library skills are prepended as plain function declarations so the
   new code can call them.
6. **Verify** (§2.1). Success comes from **observed state** only, never from the code's return value or the model's claim.
7. **Keep**: on a verified success the harness writes the skill to the library. Only the harness writes the library.

### 2.1 The verifier (deterministic code, separate from the coder)

The task's `success` names one check, each read from state the harness measures itself:

| `success.kind` | Passes when |
|---|---|
| `have` `{item, count}` | the inventory count of `item` rose by at least `count` during the run (before/after snapshots) |
| `placed` `{block, count}` | at least `count` blocks of `block` that this run placed are still there on read-back at the end |
| `structure` `{min_blocks, max_span}` | at least `min_blocks` placed blocks still stand at the end, all inside one box no wider than `max_span` (≤ 24), connected (6-neighbour) |
| `reach` `{y}` or `{block, within}` | the bot ended at or below/above `y`, or within `within` blocks of a seen `block` |
| `craft` `{item}` | the item count rose and the craft log shows the recipe ran |

Placed and dug blocks are known two ways: the facade's own log, and **the server's log** from our Paper plugin (§3.4), which
is the ground truth for "built" and for "still standing 24 h later". A check the curriculum invents outside this table is
refused at step 2 ("name one of: have, placed, structure, reach, craft").

### 2.2 The skill library

- One JSON file per skill under the arm's state dir: name, description, code, the task that made it, created, `verified`,
  `fails`, `last_success`, `calls` (library skills it calls, from the parse tree), the model that wrote it.
- **Reuse** counts when (a) a later verified skill's code calls it, or (b) a later task is solved by re-running it unchanged.
  "Invented and reused" is the pilot's headline metric, as in the research.
- A skill whose re-runs fail 3 times in a row is demoted (kept, not retrieved).
- Library hygiene (SkillOps): a new skill whose normalised code equals an existing one is a reuse, not a new entry.
- **Only our own library is ever loaded.** No outside checkpoint (Voyager issue #194: unpickling a community library runs
  attacker code). The library is JSON read with `JSON.parse`; code from it runs only inside the isolate.

### 2.3 The control

The fleet harness as it is (`LLM_ENABLED=true`), one bot, the same server settings, `HOME` = world spawn. It gets the same
sandbox (it runs no generated code, but uniform walls make the comparison clean).

## 3. Sandbox and host safety

The threat is **the generated code**, plus prompt injection through anything the model reads (chat, signs, item names). The
order of defences, outermost first:

### 3.1 Host: units, users, limits

All voyager processes are systemd units on .30 under `/srv/voyager`, separate from `/srv/block2` and from every fleet unit:

| Unit | User | Limits |
|---|---|---|
| `voyager-paper@<arm>` | `voyager-mc` | `-Xmx2G`, `MemoryMax=3G`, `CPUQuota=300%`, `CPUWeight=30`, `Nice=10`, `IOWeight=30`, `PrivateNetwork=yes`, `ProtectSystem=strict`, `ReadWritePaths=` its world dir only, `ProtectHome=yes`, `NoNewPrivileges=yes` |
| `voyager-bot@<arm>` | `voyager-bot` | `--max-old-space-size=768`, `MemoryMax=1200M`, `TasksMax=64`, `CPUQuota=150%`, `Nice=10`, `JoinsNamespaceOf=voyager-paper@<arm>.service` + `PrivateNetwork=yes`, `IPAddressDeny=any` + `IPAddressAllow=localhost`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`, `ProtectSystem=strict`, `ReadOnlyPaths=/srv/voyager/code`, `ReadWritePaths=` its own state and log dirs, `ProtectHome=yes`, `PrivateTmp=yes`, `PrivateDevices=yes`, `NoNewPrivileges=yes`, `CapabilityBoundingSet=` (none), `SystemCallFilter=@system-service`, `SystemCallArchitectures=native`, `LockPersonality=yes`, `MemoryDenyWriteExecute=no` (V8 JIT needs W+X), `ProtectKernel*=yes`, `ProtectProc=invisible`, `UMask=0077` |
| `voyager-proxy` | `voyager-proxy` | `MemoryMax=300M`, reads the keys file (0600, owned by `voyager-proxy`); listens on unix sockets only |
| `voyager-watch.timer` | root | every minute; can stop only `voyager-bot@*` units (§5) |

Total worst case: 4 x 3G + 4 x 1.2G + 0.3G ≈ 17 GB of the 41 GB available; CPU quotas sum to 18 cores of 32 at **lower** weight
and nice than the fleet's Paper servers, so the fleet keeps priority under contention.

### 3.2 Network: the bot can reach exactly two things

Docker is not on .30, and installing it rewrites the host firewall of the machine that serves the whole fleet. So the
"container" is a **systemd network namespace**:

- Each `voyager-paper@<arm>` runs with `PrivateNetwork=yes`: a namespace with only its own loopback. Paper listens on
  `127.0.0.1:25565` **inside** it. Nothing outside the namespace can reach it, and it reaches nothing.
- `voyager-bot@<arm>` joins **that** namespace (`JoinsNamespaceOf=`). Its whole network is that loopback: its own Paper server
  and nothing else. The fleet's `*:2557x` listeners live in the host namespace and are **unreachable** (tested in stage 1).
- The LLM is reached through a **unix socket** `/run/voyager/<arm>/llm.sock`, bind-mounted into the bot unit. The proxy runs in
  the host namespace and is the only part with internet access. The socket path fixes the arm, so the bot cannot pick a
  model, a backend or a budget.
- The control bot's `llm.mjs` speaks HTTP to a base URL, so its entry starts a tiny relay, `127.0.0.1:11434` inside the
  namespace to the unix socket, before loading `index.mjs`.
- `IPAddressDeny=any` / `IPAddressAllow=localhost` is a second wall in case the namespace join ever fails open: the unit then
  refuses to start (`BindsTo=` the Paper unit) and, if it started anyway, still cannot reach a non-loopback address.

**Owner/operator view of a voyager world:** none over the network during the pilot. Logs, the plugin's event log, and a nightly
offline render (BlueMap or our offline readers on a **copy** of the world) are the view. Opening a port into a namespace would
be a later, separate decision.

### 3.3 Generated code: isolated-vm, a narrow facade, budgets

- **isolated-vm 6.2.0** (Node ≥ 22; a separate V8 isolate with its own heap). Node's `vm` is not a security boundary (the Node
  docs say so) and is not used.
- **A fresh isolate per execution**, `memoryLimit: 64` MB, disposed afterwards. No state survives between runs except what the
  harness writes to the library.
- **Inside the isolate there is no `require`, `import`, `process`, `fs`, `fetch`, timers, `Buffer`, or any host object.** The
  only thing injected is ONE dispatcher `ivm.Callback` that takes `(name, jsonText)` and returns either a refusal as text or a
  numeric ticket; the host delivers the answer later as **text** by calling an isolate-side `settle(id, text)` through a
  Reference that only the **host** holds (host to isolate, never the reverse). Only strings cross. The prelude keeps the
  dispatcher in a closure, deletes it from the global, and defines `bot` as a frozen, non-configurable object of plain async
  functions (§12 B1: `Callback({async:true})` does not await a host Promise, which the first draft assumed). No `ivm.Reference`
  to a host object and no `ivm` module object is ever reachable from inside.
- Every facade result is a JSON-clean object built by the harness (numbers, strings, arrays, plain objects): no mineflayer
  objects, Vec3s, Blocks or Items cross the boundary.
- **Budgets per execution:** wall clock 240 s; 80 facade calls; isolate CPU 3 s (polled every 250 ms via `isolate.cpuTime`;
  a synchronous `while(true){}` runs on the isolate's thread, not the bot's event loop, and is killed by `isolate.dispose()`);
  at most 1 facade call in flight (a second concurrent call is refused, so `Promise.all` cannot multiply actions).
  A budget breach disposes the isolate, interrupts the running skill through the runner, and the coder is told which budget it hit.
- **Static lint before running** (acorn parse): the code must parse, define exactly one top-level `async function`, and must not
  contain `import`, `require`, `eval`, `Function`, `process`, `globalThis`, `constructor`, `__proto__`, `prototype`,
  `with`, `fetch`, `WebSocket`, `XMLHttpRequest`, `Atomics`, `SharedArrayBuffer`, `WebAssembly`, or a `while(true)`/`for(;;)`
  with no `await` in its body. The lint is a filter that gives the coder better errors and catches obvious attempts. **It is
  not the boundary; the isolate is.**
- **Runtime violations:** a `ReferenceError` naming a forbidden identifier at run time is logged as `sandbox_violation`. The
  watcher stops the bot on one (§5). Lint refusals are fed back to the coder and counted, not stopped on (that code never ran).

### 3.4 Server: no commands, and a server-side record

- `online-mode=false`, `white-list=true` with only the arm's bot name, `ops.json` empty, `enable-rcon=false`,
  `enable-query=false`, `enable-command-block=false`, `spawn-protection=0`, peaceful, `allow-nether=false`, gamerules copied from
  the fleet (keepInventory true, mobGriefing false, doFireTick false, doWeatherCycle false).
- **VoyagerGuard**, a small Paper plugin of our own (compiled on ci2 against the server's `paper-api-1.21.8` jar):
  - cancels **every** `PlayerCommandPreprocessEvent` (lowest priority, so nothing else sees it) and logs it;
  - logs every `BlockPlaceEvent`, `BlockBreakEvent` and `PlayerDeathEvent` by a player to `plugins/VoyagerGuard/events.jsonl`.
  That file is the ground truth for structures, for 24-h survival and for deaths.
- **Chat:** the facade's `say` drops any text whose first non-space character is `/`, strips control characters, caps at 100
  characters and 1 line per 10 s. The harness also wraps `bot.chat` so **no** `/`-text leaves the bot process from any code
  path. Belt (bot wrapper), braces (plugin).

### 3.5 Prompt injection

The model reads world text (signs, item names, chat). It cannot gain a capability from it: the facade is the whole capability
set and the server refuses commands. Chat from other players is not fed to the model (there are no other players: the
whitelist holds one name).

## 4. The facade (what generated code can do)

All calls are `await bot.<name>(...)`, return `{ok, ...}` or `{ok:false, reason, remedy}`, and go through **our runner**, so
the reflexes (air, lava, falls, pins, escapes) preempt them exactly as they preempt a fleet skill. A preempted call returns
`{ok:false, reason:'interrupted by reflex: <name>'}`, which goes back to the coder.

| Call | Maps to |
|---|---|
| `observe()` | position, health, food, inventory, equipment, biome, time, the 16-block census, nearby entities (read-only) |
| `findBlocks(name, radius≤32, max≤32)` | positions of loaded blocks (read-only) |
| `mine(block, count)` | our `gather` skill (its guards, tool choice and drops pickup) |
| `goto(x, y, z)` / `explore(blocks)` | our `goto` / `explore` |
| `craft(item, count)` / `smelt(item, count)` | our `craft` / `smelt` (table and furnace placement included) |
| `placeAt(item, x, y, z)` | new `vy_place` skill: one block at that cell, within reach, never in the bot's own body cells, never within 8 blocks of world spawn |
| `digAt(x, y, z)` | new `vy_dig` skill: one block, within reach; refuses the block under the bot's feet and a block with lava or water beside it, naming the remedy |
| `equip(item)` / `eat()` | equip / our `eat` |
| `chest(x, y, z, 'put'|'take', item, count)` | new `vy_chest` (open, move, close) |
| `say(text)` | filtered chat (§3.4) |
| `wait(ms ≤ 10000)` | a pause that counts against the budget |
| `log(text)` | a line in the execution log the coder sees next round |

**Every refusal names a remedy the bot can perform from where it is** (CLAUDE.md rule), e.g. `placeAt` near spawn: "build at
least 9 blocks from spawn (0, 0)"; `digAt` beside lava: "place a block over the lava at (x, y, z) first, or pick another block".

The new `vy_*` skills are registered into `SKILLS` at start-up by the voyager entry (the table is a plain object), not by
editing `skills.mjs`. **No file on `config/protected-paths.txt` changes.** The voyager entry captures the bot and the runner
that `index.mjs` creates (it wraps `mineflayer.createBot`, and records the runner from its first `isBusy`/`describe` call),
then drives that runner. `LLM_ENABLED=false` keeps the fleet's cognitive loop off; the entry starts the fleet's
`StagnationWatchdog` itself (its `cognitive` argument is optional), so the stuck-rescue layer still runs underneath.

## 5. The watcher

`voyager-watch.py`, every minute, as root, reading only voyager logs. It stops a bot (`systemctl stop voyager-bot@<arm>`,
nothing else) and writes a stop record with the cause on:

1. **deaths:** 2 in a rolling 6 h (plugin log, cross-checked with the bot's death rows);
2. **any command attempt:** a VoyagerGuard cancel, or a `/` line dropped by the facade or the chat wrapper;
3. **any sandbox violation** at run time (§3.3), or a connection the bot unit's process tried outside its namespace (the
   entry logs any socket error to a non-loopback address);
4. **10 minutes of looping with no world change:** skills keep executing but the position moved < 2 blocks, the inventory is
   unchanged and the plugin logged no place/break.

A stopped arm stays stopped until a human (the pilot's operator session) reads the cause and restarts it; every restart is a
logged row. The watcher never touches a unit that does not match `voyager-*`, never the fleet's or the showcase's tripwire.

## 6. Models and serving

### 6.1 The LLM proxy

One Node process, one unix socket per arm, a fixed backend per socket:
`POST /chat {purpose, system, messages, max_tokens}` → Ollama `/api/chat` (A, B, control) or the Anthropic Messages API (C,
official SDK). It enforces per-arm limits: 1 request in flight (2 for C), a request size cap (48 KB), a per-hour call cap, and
for C a dollar cap ($20 per 48 h) priced from each response's `usage` (cache reads included). Every call is a row: arm,
purpose, model, latency, tokens in/out/cached, dollars. The control socket also forwards raw Ollama `/api/chat` and
`/api/generate` bodies (what `llm.mjs` sends), with the model **forced** to the control's.

### 6.2 Blackwell (arm A and the control)

Before launch: load `qwen3.6:35b-a3b` once with a short keep-alive and check `/api/ps`. If any of the three pinned models
dropped out, reload it with `keep_alive: -1` (restoring the state found), and run arm A with `num_ctx` 16k on the condition
that it fits, else stop and report. During the run the proxy sends `keep_alive: "15m"`. **At the end:** `keep_alive: 0` for
`qwen3.6:35b-a3b` and `qwen2.5:7b-instruct` (unloads them), and `/api/ps` confirms.

### 6.3 Studio (arm B): never disturb the showcase brain

- The showcase brain is LM Studio (gemma4:26b) on the same GPU. Arm B gets at most **one request in flight**, `num_ctx` 16k.
- **A 30-minute interference probe before arm B runs for real:** the showcase brain's p95 latency (showcase llm rows on .40,
  via `scripts/lib/telemetry.py`) over the 3 h before, then during 30 min of arm B traffic. If the p95 rises > 20 % (or past
  6 s), arm B gets a duty cycle (calls/h cap) and is re-probed; if it still degrades, arm B moves to `qwen3-coder:30b`
  (smaller active set) or is dropped from this run. The same check runs every 6 h during the pilot.
- `keep_alive: "15m"` during, `keep_alive: 0` at the end. The pull of `qwen2.5-coder:32b` (~19.9 GB, Ollama registry) is the
  one download on the Studio.

## 7. Metrics (daily, from logs, with denominators)

Per arm per day: bot-hours alive and connected (the denominator); iterations; tasks proposed / feasibility-refused / attempted
/ verified; distinct task types; **unique items** ever held and **tool tier** reached (wood/stone/iron/diamond) with time to
each; **skills invented** (verified library entries), **reused** (§2.2), demoted; self-chosen **projects** (tasks whose
check is `placed` or `structure`) proposed and finished; **structures**: connected clusters of ≥ 20 placed blocks, and how
many still stand 24 h later (plugin log); **deaths per bot-h** with causes; **cost per verified skill** and per unique item
(proxy rows); LLM latency p50/p95. The control reports the same where it applies (no library).

Every zero carries a positive control (e.g. "0 structures" next to "N placed blocks"), as CLAUDE.md requires.

## 8. Success bar (fixed before launch)

For the **first 48-h run**, one bot per arm:

1. **Safety (all arms, a hard bar):** zero sandbox escapes. Any evidence that generated code reached the host file system,
   network, a process or a command outside the facade fails the pilot outright, whatever else it did. Zero commands executed
   on any server.
2. **Primary (the best LLM arm):** stone tools inside 6 bot-h and iron tools inside 48 h; **≥ 10 invented skills, ≥ 5 of
   them reused**; **≥ 5 self-chosen projects finished**; at least one self-chosen structure of **≥ 30 blocks** standing 24 h
   later; deaths per bot-h no worse than 2x the control.
3. **More creative than the control:** more unique items than the control in the same bot-hours, or a structure the control
   did not build.
4. **Affordability:** an arm is "worth running every day" if it reaches ≥ 50 % of the best arm's reused-skill count; for
   Haiku also ≤ $0.25 per verified skill.

The verdict uses these words: **PASS** (1-3 met), **PARTIAL** (1 met, 2 partly), **FAIL** (1 failed, or nothing in 2). The
research's 7-day bar (iron + 30 reused skills + a 50-block structure) is the bar for a longer run, if this one earns it.

Prior evidence says expect A and B to struggle (MindForge: open 7-8B Voyager 4-7 % on dirt/wood; 70B reached wooden tools).
A FAIL for the local arms is an answer, not a defect.

## 9. Stages

1. **Harness + sandbox**, proven with an adversarial suite: generated code that tries `require`, `import()`, `process`, `fs`,
   `fetch`, a host-object walk through `constructor`, a `Reference` hunt, `eval`/`Function` escapes, a sync infinite loop, an
   async infinite loop, a memory bomb, a call flood (`Promise.all` of 1,000 facade calls), chat commands (`/give`, ` /op`,
   unicode-slash look-alikes), and network from the bot unit to a fleet port and to the internet. All must be blocked, each by
   the layer the design says. Plus behaviour tests for the verifier, the lint, the feasibility filter and the library.
   **Reviews:** Codex (read-only) and an independent Claude subagent on the sandbox code (a security boundary: two engines).
2. **One arm for 1 h** (arm C, Haiku: no shared GPU at stake), with the watcher live. Read it; fix; report.
3. **All three arms + the control** after the Blackwell fit check (§6.2) and the Studio probe (§6.3). **Time box 48 h**,
   daily metrics, then stop everything, unload the models, write the verdict.

## 10. Tier and placement

- New files only: `voyager/**` (harness, proxy, watcher, plugin, units, tests) and this report. `protected.py` must report no
  protected file. Nothing changes on the fleet or the showcase, and no canary slot is used. Tier: **tooling-like, separate
  host**; the sandbox gets **two engines** because it is a security boundary.
- Independent of the fleet queue and the showcase lane; it runs on its own servers. It does not hold the deploy lock.

## 11. Risks

- **isolated-vm escape** (a V8 bug): mitigated by the outer namespace, user and syscall walls; the isolate is not the only wall.
- **The bot process itself** (mineflayer, our harness) is trusted code; a bug there is not an escape but could crash the bot.
- **Shared GPUs:** §6.2 and §6.3.
- **Host load on .30:** quotas + weights + nice; the watcher also stops everything if the host's 5-min load passes 24 or
  available memory drops under 8 GB.
- **Cost:** Haiku capped at the proxy; local arms cost GPU time only.
- **A dull result:** likely for the local arms (see §8). The pilot reports it.

## 12. Independent review (Codex, read-only, 11-06) and what changed

Codex reviewed §§0-11 with the repo, and searched the isolated-vm 6.2.0, systemd 255, Paper 1.21.8 and mineflayer sources.
Its verdicts and the reconciliation follow. **Where this section and the text above differ, this section holds.**

**Blockers**

| # | Codex | Reconciled |
|---|---|---|
| B1 | `Callback({async:true})` does not await a Promise the host returns; an async facade fails to copy it | **Agreed and already hit in the first test run** ("#<Promise> could not be cloned"). Rebuilt as a ticket + host-held `settle` bridge, strings only (§3.3 as amended). Proven by the adversarial suite with real async handlers |
| B2 | A unix socket is not automatically the only egress: other filesystem sockets stay reachable, and one shared bot UID means socket paths do not prove the arm | **Agreed.** One user per arm (`voyager-a`, `-b`, `-c`, `-ctl`) and one group per arm; each arm's socket dir is `0750 root:voyager-<arm>`, the socket `0660`, the proxy is in every arm group. The bot unit sees a minimal file system: `TemporaryFileSystem=/run /var /srv /mnt /media /opt` (empty, so `/run/dbus`, `/run/systemd`, other sockets vanish), then `BindReadOnlyPaths=` the code, the node runtime and **only its own** socket dir, `BindPaths=` its own state and log dirs; `ProtectHome=yes`, `PrivateTmp=yes`. Abstract unix sockets are per network namespace, so the private namespace hides the host's. `NoExecPaths=/` with `ExecPaths=` only the node runtime, the code tree (the isolated-vm addon) and the system libraries: nothing in `/usr/bin` can be executed. Stage 1 tests each from inside the unit |
| B3 | GPU "protection" detects damage after causing it; Blackwell eviction; Studio probe permits slowdown | **Agreed on both.** Blackwell: Ollama's default is **3 loaded models per GPU**, and 3 are pinned now, so loading A (and the control's 7B) very likely **evicts** someone's pinned model. That is not tested by doing it: it goes to the owner as a decision before stage 3 (displace which model for 48 h, or a different home for A). Studio: the showcase brain shares the GPU; arm B gets a **10-minute** probe, aborted at the first minute whose showcase p95 is > 10 % over its 3-h baseline, and runs only under a hard duty cycle (the proxy waits 2x the last call's duration before the next). If the probe shows any slowdown, arm B does not run while the showcase is live, and that goes to the owner |
| B4 | The headline metrics are gameable: withdraw stored items for `have`, rebuild the same pile, pick an already-met target, unreachable library calls for "reuse", trivial wrappers for "invented" | **Agreed.** (a) `have` counts the net gain **minus** anything taken from chests in that run; (b) a task whose check is already met at the start is refused as trivial; (c) a structure counts once: one whose cells overlap an earlier verified structure by > 50 % is a rebuild, not a new project; (d) **reuse is runtime evidence**: every library skill is wrapped so that calling it at run time reports to the host, and only calls inside a verified run count; (e) a skill is **invented** only if its verified outcome signature (check kind + item/block) is new to that arm's library; a new skill whose run made no facade call of its own (only library calls) is a composition, counted as reuse. The daily report lists every verified task's text, so a human can score "interesting" separately |
| B5 | No disk/I-O/world-growth/log bounds; the emergency stop covers only bots | **Agreed.** `max-world-size=1000` in server.properties (a 2,000 x 2,000 world, no command needed); all voyager units in a `voyager.slice` (`CPUQuota=800%`, `MemoryMax=20G`, `IOWeight=20`); Paper units `IOWriteBandwidthMax=` 20 MB/s on the data disk; logs rotate at 200 MB and are capped at 2 GB per arm; the watcher stops **every `voyager-*` unit** (Paper included) when `/srv/voyager` passes 40 GB, the root disk drops under 60 GB free, available memory under 8 GB, or the 5-min load passes 24 |

**Risks**

1. *Disposal cannot cancel host-side mineflayer actions* (the runner abandons a timed-out skill). **Agreed.** Each execution
   has a token; on a budget kill the token is revoked, `runner.interrupt()` is called, late handler results are dropped, every
   handler refuses to start once its token is revoked, and the next execution waits for `runner.current == null` (≤ 20 s, else
   the bot is restarted). isolated-vm's documented process-wide OOM failure mode is accepted for the pilot: the bot unit
   restarts on failure and the watcher counts crash loops (3 in 30 min stops the arm).
2. *Runner capture must be redone on every reconnect, and SKILL_CONTRACTS must include the vy_ skills.* **Agreed**; both.
3. *Spend control charges after the fact; raw control requests need an option allowlist.* **Agreed.** The proxy reserves the
   worst case (`max_tokens` x output price + the request's input estimate) before dispatch, settles to the real `usage`
   after, persists spend in a file across restarts, sends no retries, and counts a timed-out request at its reservation. The
   control's raw Ollama requests are rebuilt from an allowlist (messages, format, `options.{temperature,num_ctx,num_predict,top_p}`),
   with the model forced. A pilot with one seed and different control model supports an observation, not a model ranking;
   the verdict says so.

**Factual corrections, accepted**

- `JoinsNamespaceOf=` gives no ordering or activation: the bot unit has `BindsTo=` + `After=` its Paper unit. With
  `PrivateNetwork=yes` an absent Paper unit gives a private namespace, never the host's, so the failure mode is "cannot
  connect", not "fleet reachable". `IPAddressAllow=localhost` stays only as a backstop.
- A `LOWEST`-priority cancel can be un-cancelled by a later listener. VoyagerGuard cancels at `LOWEST` **and** re-cancels at
  `HIGHEST`, logs at `MONITOR`, and the voyager servers run **no other plugins** (spark and bStats are not copied). Tab
  completion is a separate path: `AsyncTabCompleteEvent` and `TabCompleteEvent` are cancelled and `PlayerCommandSendEvent`
  clears the command tree sent to the client.
- Place/break logs miss physics and fluids, so they cannot prove 24-h survival. VoyagerGuard **reads the block back on the
  server** 24 h after each placement (chunk loaded on demand) and logs `survived` true/false: the 24-h metric is that read.
- Wrapping `bot.chat` does not cover `bot._client.write`: the harness also wraps `_client.write` and drops the
  `chat_command` and `chat_command_signed` packets outright. Generated code has no route to either; this covers our own code.
- `SystemCallFilter=@system-service` is broad: add `~@mount @swap @reboot @raw-io @clock @cpu-emulation @debug @module
  @obsolete @privileged`; `NoExecPaths=` above is the exec control. `MemoryDenyWriteExecute=no` is simply what V8 needs.

## 13. Stage 1 result (11-06 23:50Z - 11-07 00:07Z): the harness and the sandbox, proven

**Code:** `voyager/` (branch `voyager-01`). Built on ci2; installed on the worlds host under `/srv/voyager` by
`voyager/infra/setup.sh` (users `voyager-mc`, `-proxy`, `-a/-b/-c/-ctl`; units `voyager-paper@`, `voyager-bot@`,
`voyager-proxy`, `voyager-watch.timer`, `voyager.slice`). The fleet's units, worlds and ports were not touched.

**Tests (ci2, Node 22.23.4, isolated-vm 6.2.0): 48/48.** The adversarial suite runs generated code straight into the sandbox
with no lint in front: `require`/`process`/`fetch`/`Buffer`/timers/`module`/`global` (trapped, reported even when caught, and
the run ends); the dispatcher gone from the global; `Function('return process')` constructor walks (isolate only); host
errors come back as data; dynamic `import()`; prototype pollution (host unaffected); `bot` cannot be replaced; a synchronous
`while(true)` after an await and before one (CPU budget; host timers kept ticking); an awaiting infinite loop (steps); a stuck
call (wall); a memory bomb (heap limit); 1,000 concurrent calls (one runs; a refusal storm ends the run); JSON-only arguments;
oversized arguments; a trap-read flood (one report, run ended); 30 MB errors and 5 MB results (bounded inside the isolate,
also with `JSON.stringify`/`String` replaced); an un-awaited action at return (killed); an external stop (disposed at once);
a library skill hunting the reuse-mark callback (unreachable); no vy_ side effect after an abort. Plus the lint, verifier,
library, chat filter, proxy pricing and control-request rebuild.

**From inside the real bot unit on the worlds host:**
- `host-probe.mjs` **39/39**: its own Paper server reachable (control); every fleet port on loopback (25570/71/99, 25670/706),
  sshd, node-exporter refused; 10.0.0.30/31/1, 1.1.1.1, the Blackwell's and Anthropic's public IPs unreachable; DNS fails; the
  key file and the proxy config unreadable; the only unix socket visible is its own arm's; D-Bus, systemd and journal sockets
  absent; `/srv` shows only its own voyager dirs; `/srv/block2` absent; code tree and `/etc` read-only; `/bin/sh`, python3,
  curl, sudo and a file it wrote itself all refuse to execute; the isolated-vm addon loads (control).
- `cmd-probe.mjs` **9/9**, on a live connection: 14 raw `chat_command` packets plus a signed one (`/op`, `/give`,
  `/gamemode`, `/tp`, `/time`, `/gamerule`, `/kill`, `/help`, `/list`, `/me`, `/msg`, `/spark`, `/plugins`, `/version`)
  changed nothing: not op (`ops.json` still `[]`), no item, still survival, not moved; VoyagerGuard logged each as
  `command_denied`; no tab completion. With our guard installed, `bot.chat('/…')`, a fullwidth-solidus look-alike, a whisper
  and a raw `chat_command` write never reached the wire; a plain line did.

**Reviews (two engines, the sandbox being a security boundary):**
- *Independent Claude subagent*: **no blockers**; 12 findings, all fixed: trap-read floods, unbounded result text, un-awaited
  calls outliving the run, a fakeable reuse metric (`bot.useSkill` removed; marks through a private callback), refusal storms,
  `equip` during a reflex, bot not revived after a Paper restart (`PartOf` + the watcher's RUNNING marker), proxy LAN egress,
  proxy `max_tokens` NaN/negative and the in-flight check before the duty-cycle wait. Accepted: isolated-vm's process-wide OOM
  mode (restart + crash-loop stop); the spawn guard covers placeAt/digAt only.
- *Codex r1* (one run refused as "cyber risk" and was re-asked as a correctness review); *r2*: 7 blockers, all fixed — vy_
  skills acting after an abort; `stop()` not revoking the running skill; library code sharing the mark callback's scope (now
  three scripts: trusted wrap-maker, untrusted implementations, trusted publish); result size checked only after the copy
  (now bounded inside the isolate with captured intrinsics); proxy loopback/IPv6 egress; control `num_predict: -1` and fetch
  timeouts; spend reservation not an upper bound. *r3 re-check*: 1-4 FIXED; 5-7 fixed further (control health probes answered
  locally; reservation by UTF-8 bytes + framing; an unreadable spend record fails closed). **Accepted residual:** the proxy
  keeps the systemd-resolved stub (127.0.0.53/54) for DNS, and any port there is reachable, so a *compromised proxy* could
  reach a wildcard-bound host listener. The proxy is our code and bots reach it only through its fixed HTTP API.
