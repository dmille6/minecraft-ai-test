# Reusable open-source components for a local-first mineflayer bot platform (as of 2026-11-22)

Method: GitHub stats come from the GitHub REST API (`gh api repos/...`), pulled 2026-11-22. They show stars, last push date, open issues + PRs, and the SPDX licence as GitHub detects it. npm versions come from `npm view`. "Last push" means any branch, which is not the same as a release. "none" or NOASSERTION means GitHub could not detect a licence; it does not mean the project has none. Check the repo before reuse.

## mineflayer ecosystem: pathfinding, movement, collect, pvp, tool, builder, schematic, viewer

### Takeaway
The PrismarineJS core is alive. mineflayer itself is at 4.39.0 with a push on 2026-11-14. The plugins see light maintenance: they get pushes, but mineflayer-pathfinder's npm release has been frozen at 2.4.5 since 2023. No mature JS Baritone port exists. The realistic reuse path is to keep mineflayer-pathfinder (or a fork of it), keep mineflayer-collectblock, -tool and -pvp as reference or thin dependencies, and own builder logic in-house.

### Cited Findings
- mineflayer: 7,796 stars, pushed 2026-11-14, 601 open issues + PRs, MIT. npm latest is 4.39.0 — [GitHub](https://github.com/PrismarineJS/mineflayer)
- mineflayer-pathfinder: 317 stars, pushed 2026-11-14, 76 open, MIT. The npm latest is still 2.4.5, and the package was last modified 2023-09-04, so repo activity has not reached a release — [GitHub](https://github.com/PrismarineJS/mineflayer-pathfinder), [npm](https://www.npmjs.com/package/mineflayer-pathfinder)
- Pathfinder alternatives found by search. All are small:
  - miner-org/mineflayer-baritone: 46 stars, pushed 2026-08-29, no licence detected — [GitHub](https://github.com/miner-org/mineflayer-baritone)
  - nuxdie/baritone-ts: 2 stars, pushed 2026-01, AGPL-3.0. Its copyleft makes it a poor fit for linking — [GitHub](https://github.com/nuxdie/baritone-ts)
  - aesthetic0001/pathfind ("more player-like movement"): 3 stars, last pushed 2024-03, MIT — [GitHub](https://github.com/aesthetic0001/pathfind)
  - Suficio/mineflayer-pathfinder (A*/D* Lite): last pushed 2019 — [GitHub](https://github.com/Suficio/mineflayer-pathfinder)
- "mineflayer-movement": I could not find a repo by that name. Two guessed owners returned 404, and repo search did not surface it. Unverified.
- mineflayer-collectblock: 59 stars, pushed 2026-04-13, 26 open, MIT — [GitHub](https://github.com/PrismarineJS/mineflayer-collectblock)
- mineflayer-pvp: 72 stars, pushed 2026-04-17, 13 open, MIT — [GitHub](https://github.com/PrismarineJS/mineflayer-pvp)
- mineflayer-tool: 29 stars, pushed 2026-10-03, MIT — [GitHub](https://github.com/PrismarineJS/mineflayer-tool)
- mineflayer-statemachine: 139 stars, pushed 2026-07-08, MIT — [GitHub](https://github.com/PrismarineJS/mineflayer-statemachine)
- mineflayer-builder: 33 stars, pushed 2026-04-01, 5 open, MIT. It builds from a prismarine-schematic — [GitHub](https://github.com/PrismarineJS/mineflayer-builder)
- prismarine-schematic: 32 stars, pushed 2026-10-06, MIT, npm 1.3.0 — [GitHub](https://github.com/PrismarineJS/prismarine-schematic)
- prismarine-viewer: 408 stars, pushed 2026-10-06, 70 open, MIT. A web/three.js viewer of the bot's world — [GitHub](https://github.com/PrismarineJS/prismarine-viewer)
- Supporting libraries:
  - prismarine-world: 42 stars, pushed 2026-10-06 — [GitHub](https://github.com/PrismarineJS/prismarine-world)
  - prismarine-provider-anvil (reads region files from Node): 17 stars, pushed 2026-10-19 — [GitHub](https://github.com/PrismarineJS/prismarine-provider-anvil)
  - prismarine-nbt: 127 stars, pushed 2026-10-06 — [GitHub](https://github.com/PrismarineJS/prismarine-nbt)
  - minecraft-data: 963 stars, pushed 2026-11-18 — [GitHub](https://github.com/PrismarineJS/minecraft-data)
  - GitHub detected no licence for any of these four. The PrismarineJS norm is MIT, but that is unverified for these repos.
- LLM agent frameworks built on mineflayer, for reference or skill code:
  - mindcraft: 6,041 stars, pushed 2026-10-27, MIT — [GitHub](https://github.com/mindcraft-bots/mindcraft)
  - mindcraft-ce (community edition): 157 stars, pushed 2026-11-19, MIT — [GitHub](https://github.com/mindcraft-ce/mindcraft-ce)
  - Voyager: 7,341 stars, but last pushed 2024-04, so effectively dormant. MIT — [GitHub](https://github.com/MineDojo/Voyager)

### Inferences
- Builder: mineflayer-builder plus prismarine-schematic is a starting point, but it is small and has little activity. The scaffolding, ordering and reachability logic a real builder needs is likely to stay in-house. Treat mineflayer-builder as a reference, not a dependency.
- Pathfinding: repo activity without npm releases suggests depending on the git main or a vendored fork. That is consistent with this repo's own `walkToGoal` workaround for the `goto`/partial-path issue noted in CLAUDE.md.
- mindcraft's skill library (MIT) is the richest permissively licensed source of mineflayer action code to borrow from.

### Gaps
- I did not compare release cadence, changelogs or the open-issue backlog for the pathfinder fork against upstream.
- I did not check which Minecraft versions each plugin supports.
- I did not verify mineflayer-movement's existence.

## Building, schematics, terraforming, procedural/AI structure generation

### Takeaway
GDMC is still active. The 2026 round ran on itch.io with submissions from Feb 15 to Jun 30, and the GDMC HTTP Interface mod (MIT, active fork by Niels-NTG) plus GDPC (Python, MIT) form the standard toolchain. Past entries are MIT and Apache open-source settlement generators worth mining for terrain and layout algorithms. JS-native .litematic tooling is thin. Terrain smoothing exists mainly as client mods, not as reusable algorithms.

### Cited Findings
- GDMC 2026 jam: submissions 2026-02-15 to 2026-06-30, hosted on itch.io — [itch.io](https://itch.io/jam/gdmc2026), [CoG 2026 competitions](https://cog2026.fdi.ucm.es/competitions.html)
- A Leiden University news item (Sept 2026) reports that Leiden students won GDMC. I read it from a search snippet only and did not confirm the edition or the placings — [Leiden](https://www.student.universiteitleiden.nl/en/news/2026/09/can-ai-build-a-beautiful-city-in-minecraft-these-leiden-students-did-it-better?cf=science)
- GDMC HTTP Interface (Niels-NTG fork): 29 stars, pushed 2026-05-29, MIT. A mod that exposes HTTP endpoints for reading and writing blocks. The original nikigawlik repo was last pushed 2023 — [GitHub](https://github.com/Niels-NTG/gdmc_http_interface)
- GDPC (Python client for the interface): 35 stars, pushed 2026-09-30, MIT — [GitHub](https://github.com/avdstaaij/gdpc)
- Example open entries:
  - Niels-NTG/GDMC2024, MIT — [GitHub](https://github.com/Niels-NTG/GDMC2024)
  - MightyCode/GDMC2022, MIT — [GitHub](https://github.com/MightyCode/GDMC2022)
  - williamcwi/GDMC, Apache-2.0 — [GitHub](https://github.com/williamcwi/GDMC)
- Background on the challenge and its judging (adaptation to terrain, functionality, narrative, aesthetics) — [Impressions of GDMC (arXiv 2108.02955)](https://ar5iv.labs.arxiv.org/html/2108.02955)
- Schematic tooling:
  - schematic4j (Java parser for .schem, .schematic and .litematic): 27 stars, last pushed 2023, MIT — [GitHub](https://github.com/SandroHc/schematic4j)
  - Davide0995/schematic.viewer (browser viewer for .litematic, .schematic and .nbt): 2 stars, pushed 2026-11-17, MIT — [GitHub](https://github.com/Davide0995/schematic.viewer)
  - AboveAphid0/Litematica-Bot (mineflayer places .litematic files): 2 stars, last pushed 2024, no licence — [GitHub](https://github.com/AboveAphid0/Litematica-Bot)
- AI structure design: WebitroHQ/minecraft-structure-mcp, an MCP server that lets an LLM design structures and view isometric renders. 5 stars, pushed 2026-10-26, MIT — [GitHub](https://github.com/WebitroHQ/minecraft-structure-mcp)
- Terrain smoothing exists as mods that reshape terrain visually or with slabs, not as world-editing algorithms:
  - NoCubes, LGPL-3.0 — [GitHub](https://github.com/Cadiboo/NoCubes)
  - terrain-slabs-mod, AGPL-3.0 — [GitHub](https://github.com/Coun7ered/terrain-slabs-mod)

### Inferences
- The GDMC HTTP mod writes blocks directly, which is an admin edit. The owner's rule forbids that for the bots, so the GDMC stack fits offline planning only: generate a layout or blueprint in a test world, then have the bots build it.
- The most valuable reuse from GDMC entries is algorithmic: heightmap analysis, plot selection, road networks, and terrain adaptation and levelling. That code is in Python and would need a port.
- For terrain smoothing, it is better to derive the algorithm (heightmap blur or erosion to a target grade, then a dig/fill diff) from GDMC entries than from the mods.

### Gaps
- I could not find the official 2026 GDMC results or their repos.
- I did not verify which Minecraft version the HTTP interface currently targets.
- I found no maintained JS .litematic parser. prismarine-schematic's .litematic support is unverified (it is known for .schem and .schematic).

## World rendering for top-down and isometric timelapses

### Takeaway
There are four headless options. BlueMap CLI (MIT, very active) for 3D web maps. Chunky (GPL-3.0, active) for path-traced stills with a headless mode. uNmINeD for fast top-down maps (isometric is still in development; licence not verified). spoutn1k/mcmap (GPL-3.0, active) for isometric PNGs from region files. Overviewer is effectively unmaintained (last push 2024-12). Dynmap and squaremap are server plugins, not region-file CLIs.

### Cited Findings
- BlueMap: 2,869 stars, pushed 2026-11-22, MIT. It runs as a standalone CLI (`java -jar BlueMap-cli.jar`, `-r` to render, `-w` for the webserver; Java 21+) without a server, and there is a Docker image. Output is a webapp map — [GitHub](https://github.com/BlueMap-Minecraft/BlueMap), [Install docs](https://bluemap.bluecolored.de/wiki/getting-started/Installation.html)
- Chunky: 739 stars, pushed 2026-11-21, GPL-3.0. A path tracer with a documented headless launcher mode — [GitHub](https://github.com/chunky-dev/chunky), [Headless docs](https://chunky-dev.github.io/docs/reference/user_interface/chunky_launcher/headless). ChunkyMap (a map plugin using Chunky): GPL-3.0, pushed 2026-07 — [GitHub](https://github.com/leMaik/ChunkyMap)
- uNmINeD: latest is 0.20.11-dev (2026-10-06). It has CLI parameters for web export and builds for Windows, Linux and macOS (including musl). It renders top-down; the site says isometric mode is in development and that isometric image and web export were not available in 0.20.11-dev. It is not on GitHub as source, and I did not read its licence (it is likely freeware, unverified) — [unmined.net](https://unmined.net/). Community Docker images exist — [kylrth/unmined_docker](https://github.com/kylrth/unmined_docker)
- mcmap (spoutn1k): 338 stars, pushed 2026-11-20, GPL-3.0. An isometric renderer for region files. It is a standalone binary, so a GPL tool invoked as a subprocess does not license our code — [GitHub](https://github.com/spoutn1k/mcmap)
- Minecraft-Overviewer: 3,512 stars, last pushed 2024-12-20, 351 open, GPL-3.0. Treat it as stale, and its support for recent versions is doubtful (unverified) — [GitHub](https://github.com/overviewer/Minecraft-Overviewer)
- Dynmap: 2,227 stars, pushed 2026-11-14, Apache-2.0. A server plugin with live rendering — [GitHub](https://github.com/webbukkit/dynmap)
- squaremap: 525 stars, pushed 2026-11-22. A top-down server plugin for Paper and Fabric. GitHub shows NOASSERTION; my recollection is MIT, unverified — [GitHub](https://github.com/jpenilla/squaremap)
- mcrender (Mineways + Blender isometric snippets): last pushed 2024-08 — [GitHub](https://github.com/avdstaaij/mcrender)
- minecraft-library/asset-renderer (block and item renderer from the vanilla client jar): Apache-2.0, pushed 2026-11-14 — [GitHub](https://github.com/minecraft-library/asset-renderer)

### Inferences
- For timelapse frames from saved region snapshots:
  - Isometric PNG per frame: mcmap, cropped to the town bounding box.
  - Cheap top-down frames: uNmINeD.
  - Hero shots: Chunky headless.
  - Interactive viewing: BlueMap.
- All four run as subprocesses, so GPL is not an issue unless we link them.

### Gaps
- I did not benchmark any of these renderers for speed.
- I did not verify the uNmINeD licence.
- I did not check each renderer's support for MC 1.21.x.

## Evaluation datasets and benchmarks

### Takeaway
The best-known assets (MineDojo, VPT, Voyager) are dormant since 2024–25. The newer benchmarks are LLM-native: MineAnyBuild for building and spatial planning, Plancraft for crafting plans, TeamCraft and MineCollab for multi-agent work, and MCU for an atomic task suite. Most of these target MineRL/Malmo or a simulator, not mineflayer, so their task lists are more reusable than their harnesses.

### Cited Findings
- MineDojo: 2,285 stars, last pushed 2024-03, MIT. It includes the internet-scale knowledge base (YouTube, Wiki, Reddit) — [GitHub](https://github.com/MineDojo/MineDojo)
- VPT (OpenAI contractor gameplay data and models): 1,764 stars, last pushed 2025-09, MIT — [GitHub](https://github.com/openai/Video-Pre-Training)
- MCU: 3,452 atomic tasks with LLM task generation and an automatic evaluator. The repo has 64 stars, last pushed 2025-10, and no licence detected — [arXiv 2310.08367](https://arxiv.org/html/2310.08367v4), [GitHub](https://github.com/CraftJarvis/MCU)
- MineAnyBuild (NeurIPS 2025): 4,000 spatial-planning (building) tasks. It scores spatial understanding, spatial reasoning, creativity and commonsense, and evaluated 13 MLLMs — [arXiv 2505.20148](https://arxiv.org/html/2505.20148v3)
- Plancraft: a crafting-planning benchmark for LLM agents, MIT, installed with pip or uv, with a Docker image and a text gym wrapper. The README warns that the paper's baselines are underreported because of an environment bug. The repo has 31 stars and was last pushed 2025-11 — [GitHub](https://github.com/gautierdag/plancraft)
- TeamCraft (multi-agent): 61 stars, last pushed 2025-09, MIT — [GitHub](https://github.com/teamcraft-bench/teamcraft)
- TickingCollabBench (2026, time-sensitive multi-agent collaboration; it cites TeamCraft and MineCollab) — [arXiv 2606.15684](https://arxiv.org/pdf/2606.15684)

### Inferences
- MineAnyBuild's tasks are the closest match to the "beautiful builds" goal. They could serve as an offline planner eval for local models, separate from live-fleet telemetry.
- Plancraft is a cheap offline check on crafting-chain reasoning for qwen and other challenger models.

### Gaps
- I did not verify MineAnyBuild's code or data licence, or its repo URL.
- I did not research MineCollab details.
- I found no public mineflayer-native trajectory dataset.

## Local LLM tool-calling and structured-output glue for Node

### Takeaway
For llama.cpp, Ollama and vLLM from Node, the low-risk stack is:
- The OpenAI-compatible endpoint, via openai-node (Apache-2.0) or the Vercel AI SDK, with zod schemas.
- ollama-js (MIT) for Ollama's native `format` JSON-schema option.
- node-llama-cpp (MIT, very active) for in-process GBNF grammar or JSON-schema-constrained output.

instructor-js has been inactive since early 2025.

### Cited Findings
- node-llama-cpp: 2,210 stars, pushed 2026-11-22, MIT. In-process llama.cpp bindings with grammar and JSON-schema enforcement and function calling (the feature claims come from memory of its docs, not re-read here) — [GitHub](https://github.com/withcatai/node-llama-cpp)
- ollama-js: 4,420 stars, pushed 2026-11-17, MIT — [GitHub](https://github.com/ollama/ollama-js)
- openai-node: 11,275 stars, pushed 2026-11-20, Apache-2.0. It works against the OpenAI-compatible servers of llama-server, vLLM and Ollama — [GitHub](https://github.com/openai/openai-node)
- Vercel AI SDK: 28,133 stars, pushed 2026-11-22, 1,715 open. It offers tool calling and `generateObject`, with OpenAI-compatible provider support. GitHub shows NOASSERTION; my recollection is Apache-2.0, unverified — [GitHub](https://github.com/vercel/ai)
- instructor-js: 805 stars, last pushed 2025-01-27, MIT. Stale — [GitHub](https://github.com/567-labs/instructor-js)
- zod: 44,389 stars, pushed 2026-11-22, MIT — [GitHub](https://github.com/colinhacks/zod)
- llama.cpp (server, GBNF grammars, `json_schema`): 136,121 stars, pushed 2026-11-22, MIT — [GitHub](https://github.com/ggml-org/llama.cpp)
- Outlines (Python constrained decoding, used by vLLM-style backends): Apache-2.0, pushed 2026-09 — [GitHub](https://github.com/dottxt-ai/outlines)

### Inferences
- The most portable pattern is server-side enforcement through llama-server's `json_schema`/grammar or vLLM's guided decoding, with zod validating on the client. That keeps the 5080, the 3090 and the Ollama fallback interchangeable behind one client.

### Gaps
- I did not test the quality of tool-calling across qwen2.5 and Muse Glimmer through each library.
- I did not verify vLLM's current guided-decoding backend names.
