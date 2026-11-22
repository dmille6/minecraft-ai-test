# Open-source, runnable LLM-driven Minecraft bot frameworks (as of 2026-11-22)

Method note: GitHub pages were opened with WebFetch on 2026-11-22. The fetcher could not see last-commit dates on any repo page, so "last activity" is unverified everywhere unless a dated item is quoted. Items taken only from search snippets are marked (snippet, not opened).

## Mindcraft (mindcraft-bots/mindcraft, formerly kolbytn/mindcraft)

### Takeaway
Mindcraft is the most established runnable framework: MIT, mineflayer, JS, about 6.0k stars. It has first-class Ollama support with its own fine-tuned "Andy-4" models, and MineCollab for multi-agent tasks. The LLM mostly picks commands, with optional sandboxed code generation that is off by default.

### Cited Findings
- The repo now lives at mindcraft-bots/mindcraft. It is MIT-licensed, with about 6.0k stars, 1.0k forks, 1,673 commits on `develop`, and no releases listed. — [GitHub](https://github.com/mindcraft-bots/mindcraft)
- Core team: MaxRobinsonTheGreat, kolbytn, icwhite, Sweaterdog, Ninot1Quyi, riqvip, uukelele, mrelmida. — [GitHub](https://github.com/mindcraft-bots/mindcraft)
- Architecture: each bot is a JSON profile (for example `andy.json`). It has separate models for chat, code (`code_model`, used for "newAction" coding), vision, embedding and voice. Docker support is included. — [GitHub](https://github.com/mindcraft-bots/mindcraft)
- Code generation is disabled by default and enabled with `allow_insecure_coding`. The README warns against public servers with coding on. — [GitHub](https://github.com/mindcraft-bots/mindcraft)
- Local models: Ollama, using `ollama pull sweaterdog/andy-4:micro-q8_0 && ollama pull embeddinggemma`. A vLLM option is listed. About 18 cloud APIs are supported, including OpenAI, Anthropic, Google, Groq and OpenRouter. — [GitHub](https://github.com/mindcraft-bots/mindcraft)
- Supports Minecraft Java up to 1.21.11, with 1.21.6 recommended. The README warns that Node v24+ may break native dependencies. Dependency bugs are fixed with `patch-package`. — [GitHub](https://github.com/mindcraft-bots/mindcraft)
- MineCollab is a multi-agent task framework (`minecollab.md`, `node main.js --task_path`) with automatic world launching. — [GitHub](https://github.com/mindcraft-bots/mindcraft)
- The README says it is "currently not very responsive to github issues" (search snippet). — [search result via raw README](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/README.md)
- The skill library (`src/agent/library/skills.js`) includes craftRecipe, smeltItem, clearNearestFurnace, attackNearest/attackEntity, defendSelf, collectBlock, pickupNearbyItems, breakBlockAt, placeBlock, equip, discard, putInChest, takeFromChest, viewChest, consume and giveToPlayer (the page was truncated after that). — [GitHub skills.js](https://github.com/mindcraft-bots/mindcraft/blob/develop/src/agent/library/skills.js)
- Tidiness behaviours in skills.js:
  - craftRecipe and smeltItem place a temporary table or furnace and then collect it back.
  - placeBlock clears an occupied target first.
  - collectBlock calls pickupNearbyItems and autoLight.
  - In cheat mode, place and break use `/setblock`. That would violate this repo's no-admin-edit rule, so it must be off.
  — [GitHub skills.js](https://github.com/mindcraft-bots/mindcraft/blob/develop/src/agent/library/skills.js)
- A 2024 project write-up describes it as a Node.js LLM bot project (older). — [UCI site](https://sites.uci.edu/kolbynottingham/2024/10/30/mindcraft)
- Forks exist, including mindcraft-ts (a TypeScript port, not opened). — [majinbot/mindcraft-ts](https://github.com/majinbot/mindcraft-ts)

### Inferences
- skills.js (MIT) is the most directly reusable code for a mineflayer JS/TS bot. The temporary-station place-and-collect pattern matches this project's "leave it tidy" goal.
- No evidence was found of multi-day unattended runs. It is designed for interactive or task sessions.

### Gaps
- Exact last-commit or release date, and the 2025-2026 changelog. Not visible, and no releases are published.
- Whether "mindcraft-ce" exists as a separate community edition. I did not find it in searches.

## Voyager (MineDojo/Voyager) and descendants

### Takeaway
Voyager is MIT research code: about 7.3k stars, 35 commits, no releases. It is tied to GPT-4, Minecraft 1.19 and Fabric 0.14.18, and is effectively unmaintained. Its ideas (code-as-skill library, automatic curriculum, self-verification) live on in Odyssey (local LLaMA-3) and in the agent-swarm's 57 Voyager-style skills. I found no maintained Ollama fork of Voyager itself.

### Cited Findings
- Voyager has three parts: an automatic curriculum, an "ever-growing skill library of executable code", and iterative prompting with environment feedback and self-verification. — [GitHub](https://github.com/MineDojo/Voyager)
- It is MIT-licensed, with 7.3k stars, 710 forks, 35 commits and 7 open PRs. It supports only GPT-4 through an OpenAI key. It needs Python 3.9+, Node 16.13+, Fabric 0.14.18 and Minecraft 1.19. — [GitHub](https://github.com/MineDojo/Voyager)
- Odyssey (zju-vipa) is based on Voyager. It is MIT (the dataset is CC BY-NC-SA 3.0), with 412 stars and 141 commits. It uses a LLaMA-3 8B/70B model fine-tuned on 390k+ wiki Q&A entries, served by a self-hosted backend. It has 40 primitive and 183 compositional skills, and was accepted at IJCAI 2025 (Apr 29, 2025). — [GitHub](https://github.com/zju-vipa/odyssey)
- The search found no Voyager fork that runs on Ollama. The Voyager-LLM-Trials repo exists but was not opened. — [JVP15/Voyager-LLM-Trials](https://github.com/JVP15/Voyager-LLM-Trials)

### Inferences
- Odyssey's skill library is MIT and mineflayer JS, which makes it a candidate source of compositional skills. It would need porting from 1.19-era APIs.

### Gaps
- Odyssey's last commit date, and whether its LLaMA server runs on one consumer GPU (the 8B model probably does; not verified).

## Other mineflayer / mod-based LLM agents

### Takeaway
The notable runnable newcomer is minecraft-agent-swarm: MIT, TS, five local bots on Ollama gpt-oss:20b, with documented long-running operations. The others are an MCP server (Apache-2.0), a Forge mod (Steve AI), Player2's AltoClef/Baritone mods (AGPL) and an archived AIRI bot. Altera released a paper, not code.

### Cited Findings
- **minecraft-agent-swarm (JesseRWeigel):** MIT, mineflayer and TypeScript, 37 stars and 1,486 commits. It runs five role bots (scout, farmer, miner, builder, combat) with a shared bulletin board and a central chest. Its rule is "earn everything" (no handouts or teleports). — [GitHub](https://github.com/JesseRWeigel/minecraft-agent-swarm)
  - Architecture: an event-driven brain per bot (plan on idle, react to danger, critic after each action). It has hand-written TS skills, 57 Voyager-style JS skills in a VM sandbox, and an optional LLM skill generator (off by default; Linux plus Bubblewrap). It keeps per-bot JSON memory and a skill reliability tracker that retires broken skills. — [GitHub](https://github.com/JesseRWeigel/minecraft-agent-swarm)
  - Models: one local `gpt-oss:20b` on Ollama. It won a July 2026 trial against nemotron-3-nano and qwen3.6:27b. The README warns that qwen3-family models through Ollama's `/v1` return empty output, so use the native provider. — [GitHub](https://github.com/JesseRWeigel/minecraft-agent-swarm)
  - Long-running operations:
    - About 900-1,000 actions/h on five bots, roughly 2,000 calls/h.
    - The advancement run uses keepInventory, with 10-55 deaths/day. Food cannot sustain five bots.
    - Skill and action watchdogs are set at 240 s and 150 s.
    - A stale `.lock` file and TTS staging files need manual cleanup after a crash.
    - Run conditions are dated 2026-09-07.
    - Targets Java 1.21.4 (Paper 26.3 through ViaVersion is experimental).
    — [GitHub](https://github.com/JesseRWeigel/minecraft-agent-swarm)
- **minecraft-mcp-server (yuniko-software):** Apache-2.0, mineflayer and TS, 830 stars, 220 commits, 16 open PRs, Minecraft 1.21.11. Its tools cover move/look/jump, fly-to, inventory, place/dig/find-blocks, smelt, find-entity and chat. — [GitHub](https://github.com/yuniko-software/minecraft-mcp-server)
- **Steve AI (YuvDwi/Steve):** MIT Forge mod for 1.20.1, about 1.4k stars and 62 commits. The LLM plans the whole action sequence up front. It runs JavaScript through GraalVM and uses entities built on PathfinderMob. Providers are OpenAI, Groq and Gemini (no local model). — [GitHub](https://github.com/YuvDwi/Steve)
  - It has procedural house, castle, tower and barn generators, NBT structure loading, and a CollaborativeBuildManager that splits builds into sections across agents. Crafting is missing. — [GitHub](https://github.com/YuvDwi/Steve); press coverage at [PC Gamer](https://www.pcgamer.com/games/survival-crafting/this-minecraft-mod-lets-you-command-steve-to-do-whatever-you-want-which-means-no-more-strip-mining-or-wood-gathering-ever-again) (not opened)
- **AIRI minecraft (moeru-ai/airi-minecraft):** MIT, mineflayer and TS. It was archived on 2025-02-18 and the code moved into the main AIRI repo under `services/minecraft`. It uses an OpenAI-compatible base URL, so local servers are possible. — [GitHub](https://github.com/moeru-ai/airi-minecraft)
- **Player2 / elefant-ai:**
  - ChatClef is an AGPL-3.0 client mod built on AltoClef and Baritone. Its source is at github.com/elefant-ai/chatclef. The last update was 2025-05-09 (v0.18.23 for 1.21.1, 1.20.1 and 1.19.4). The LLM, speech-to-text and text-to-speech come from the Player2 desktop app. — [CurseForge](https://www.curseforge.com/minecraft/mc-mods/chatclef)
  - Player2NPC and PlayerEngine (the server-side framework that inherits ChatClef's tasks) are linked below; their pages were not opened. — [CurseForge Player2NPC](https://www.curseforge.com/minecraft/mc-mods/player2npc), [PlayerEngine](https://www.curseforge.com/minecraft/mc-mods/playerengine)
- **Altera Project Sid:** the `altera-al/project-sid` repository holds the technical report (snippet showed two commits). There is no evidence the agent code (PIANO) was released. — [GitHub](https://github.com/altera-al/project-sid) (snippet, not opened)
- **MineStudio (CraftJarvis):** a training, inference and benchmark toolkit (MineRL simulator, STEVE-1 and ROCKET-1 baselines). It is a research toolkit, not an LLM bot framework. — [docs](https://craftjarvis.github.io/MineStudio)
- **Craftium:** built on Luanti, not Minecraft (ICML 2025). — [docs](https://craftium.readthedocs.io/)
- A local Nemotron 9B on vLLM with a mineflayer write-up exists. — [DEV](https://dev.to/soytuber/giving-a-brain-to-minecraft-npcs-with-a-local-llm-nemotron-mineflayer-implementation-notes-1mph) (not opened)

### Inferences
- **Single consumer GPU:** Mindcraft (Andy-4 micro via Ollama) and agent-swarm (gpt-oss:20b, which fits in about 16 GB) are the two with explicit local-first setups. Odyssey's 8B is plausible.
- **Multi-day unattended runs:** only agent-swarm documents round-the-clock operations (deaths per day, watchdogs, crash cleanup). Even it needs keepInventory and manual lock cleanup. None shows tidy, unattended multi-day runs without cheats.
- **Reusable code for a mineflayer JS/TS bot:**
  - MIT: Mindcraft skills.js, agent-swarm's TS skills, sandbox and reliability tracker, and Odyssey/Voyager skills.
  - Apache-2.0: minecraft-mcp-server tool wrappers.
  - Avoid copying from ChatClef/AltoClef (AGPL).
  - Steve AI is Java, so only its ideas carry over, such as the collaborative build split.
- **Aesthetics, terrain, cleanup:** only Steve has structure generators. Mindcraft's place-then-collect station pattern is the only cleanup behaviour found. No framework found addresses terrain levelling or tidy worlds.

### Gaps
- Last-commit dates for all repos (not rendered).
- Reddit, HN and YouTube threads were not searched, because of the tool-call budget.
- I did not search for these projects: "AIMC", the ChatGPT/Claude NPC mods, "Resonance AI" and CraftAgent (seen on Modrinth, not opened: [Resonance AI](https://modrinth.com/mod/resonance-ai), [CraftAgent](https://modrinth.com/mod/craftagent)).
- "mindcraft-ce" was not found.
