# Commercial and adjacent efforts: persistent autonomous AI agents in game worlds (as of 2026-11-22)

Method note: 13 web searches, no full-page fetches (search summaries only). Many sources are 2024-2025; items not confirmed in 2026 are marked [older] or [unverified 2026 status].

## Commercial Minecraft AI: who sells or ships AI Minecraft bots/towns?

### Takeaway
No company currently sells a long-running autonomous Minecraft bot town. The best-known effort, Altera (Project Sid), pivoted away from Minecraft. What actually ships is (a) companion mods backed by a cloud gateway (Player2), and (b) chat-only LLM NPC plugins on Citizens/Paper, several of which can use local models. None of these targets tidy, beautiful, multi-day building.

### Cited Findings
- Altera ran Project Sid: up to 1,000 autonomous agents in one Minecraft world, with reported emergent taxes and religion (Pastafarianism) [older, 2024] — [Tom's Hardware](https://www.tomshardware.com/tech-industry/artificial-intelligence/ai-created-a-minecraft-ai-village-with-up-to-1-000-inhabitants-project-sid-sees-ai-bots-implement-a-taxation-system-and-spread-pastafarianism-religion); [Project Sid post](https://digitalhumanity.substack.com/p/project-sid)
- Altera's first product was an agent that plays Minecraft with you (building, crafting, farming, trading, mining) and was backed by Eric Schmidt [older, 2024] — [TechCrunch 2024-05-08](https://techcrunch.com/2024/05/08/bye-bye-bots-alteras-game-playing-ai-agents-get-backing-from-eric-schmidt/)
- Altera renamed itself Fundamental Research Labs and raised $30M from Prosus to build agents for several verticals. Per secondary coverage, its products are now Shortcut (an Excel agent) and Fairies (a desktop assistant). One account says users found the Minecraft agents "too autonomous" and wanted assistants that do what they are asked (secondary source; not verified against the primary) — [TechCrunch 2025-08-01](https://techcrunch.com/2025/08/01/fundamental-research-labs-nabs-30-million-from-prosus-to-build-ai-agents-for-multiple-verticals); [FRL Substack](https://digitalhumanity.substack.com/p/introducing-fundamental-research)
- The researchers themselves noted that the agents lacked robust innate drives and leaned on foundation-model knowledge — [Tom's Guide](https://www.tomsguide.com/ai/a-company-gave-1000-ai-agents-access-to-minecraft-and-they-built-a-society)
- Player2 offers the Player2NPC mod (Java Edition, Fabric/Forge/NeoForge for 1.20.1 and 1.21.1). It adds in-world companion entities, not separate bot clients, plus opt-in push-to-talk voice. It requires the Player2 desktop app running as a "gateway to the AI models". Related projects: PlayerEngine (server-side framework) and ChatClef (client-side automation copilot). Pricing was not found — [Modrinth Player2NPC](https://modrinth.com/mod/player2npc); [CurseForge](https://www.curseforge.com/minecraft/mc-mods/player2npc); [ChatClef](https://www.curseforge.com/minecraft/mc-mods/chatclef); [PlayerEngine](https://www.curseforge.com/minecraft/mc-mods/playerengine)
- Inworld has an official Minecraft Java SDK, a Spigot plugin built on 1.19.4 that is likely stale, plus demo modpacks [older] — [Inworld docs](https://docs.inworld.ai/docs/tutorial-integrations/minecraft-java); [Inworld blog](https://inworld.ai/blog/integrate-ai-characters-into-your-minecraft-server)
- Server-plugin LLM NPCs:
  - LLM NPC Lite: Citizens add-on for 1.21.x that needs a local OpenAI-compatible server — [Modrinth](https://modrinth.com/mod/llmnpc-lite)
  - NeuroNPC: Paper plugin that talks to OpenAI-compatible endpoints such as OpenRouter — [Modrinth](https://modrinth.com/plugin/neuronpc)
  - CraftGPT: needs your own API key — [CurseForge](https://www.curseforge.com/minecraft/bukkit-plugins/craftgpt)
  - Craft Agent: Fabric mod that uses Ollama or LM Studio — [Modrinth](https://modrinth.com/mod/craftagent)
  - AI-NPC: supports OpenAI and Ollama — [Modrinth](https://modrinth.com/mod/ai-npc)
  - NPCSpeak: supports Citizens2 — [Modrinth](https://modrinth.com/plugin/npcspeak)
- Microsoft Research published work on LLM-driven NPCs for collaborative quests in Minecraft — [MSR](https://www.microsoft.com/en-us/research/publication/collaborative-quest-completion-with-llm-driven-non-player-characters-in-minecraft/)
- Microsoft/Xbox Muse (WHAM) is a generative gameplay model with weights on Azure AI Foundry. Copilot Labs experiences were planned, and Microsoft earlier said Copilot would come to games, starting with Minecraft [older, 2024-2025] — [Xbox Wire](https://news.xbox.com/en-us/2025/02/19/muse-ai-xbox-empowering-creators-and-players/); [PC Gamer](https://pcgamer.com/software/ai/xbox-announces-a-generative-ai-model-for-gameplay-ideation-called-muse-but-dont-get-too-excited-machines-arent-about-to-make-games-for-you-just-yet); [TechCrunch](https://techcrunch.com/2025/03/10/microsoft-appears-to-be-working-on-3d-gaming-experiences-for-copilot)
- Heise argued that Muse and the Minecraft-replica world model Oasis produce low-resolution output at unusable frame rates — [heise](https://heise.de/-10289315)

### Inferences
- Commercial interest has moved from autonomous Minecraft societies to companions that obey the player (Altera pivoted; Player2 builds companions). An autonomous town that runs for days and looks nice is commercially unserved.
- Most NPC plugins are about conversation, not world work: they talk but do not build, gather or tidy.
- "Local" exists only at the plugin/LLM-endpoint level. No one ships a novice installer that bundles server, bots and a local model.

### Gaps
- No Convai Minecraft integration was found.
- No Minecraft Marketplace (Bedrock) AI NPC add-on was found.
- Player2 pricing, and whether its models run locally or in the cloud, were not found.
- The 2026 status of Microsoft Copilot in Minecraft is unknown.
- No startups selling "AI villages" in 2025-2026 were found. That suggests there are none, but the search was not exhaustive.

## Adjacent research and products

### Takeaway
The big labs work on generalist agents (SIMA 2), world models (Genie 3, Muse) and in-game companions (NVIDIA ACE). Persistent social simulations (Smallville, AI Town) are 2D and chat-centric. Benchmarks show LLM agents still fail long-horizon games such as NetHack. None of these targets lasting construction quality.

### Cited Findings
- SIMA 2 (DeepMind, 2025-11-13, limited research preview) is Gemini-based. DeepMind reports 65% task completion versus 31% for SIMA 1. It generalizes to unseen games, including MineDojo (Minecraft) and ASKA, and to Genie 3 worlds, and improves itself with Gemini-set tasks and rewards. No robotics timeline was given — [DeepMind blog](https://deepmind.google/blog/sima-2-an-agent-that-plays-reasons-and-learns-with-you-in-virtual-3d-worlds/); [arXiv 2512.04797](https://arxiv.org/abs/2512.04797v1); [TechCrunch](https://techcrunch.com/2025/11/13/googles-sima-2-agent-uses-gemini-to-reason-and-act-in-virtual-world)
- Genie 3 (announced 2025-08) reached the public as Project Genie from 2026-01-29, for US Google AI Ultra subscribers only. Generations last 60 s, and promptable world events are not in the prototype. No API release was found — [Google blog](https://blog.google/innovation-and-ai/models-and-research/google-deepmind/project-genie/); [TechCrunch 2026-01-29](https://techcrunch.com/2026/01/29/i-built-marshmallow-castles-in-googles-new-ai-world-generator-project-genie); [DeepMind](https://deepmind.google/blog/genie-3-a-new-frontier-for-world-models/)
- AI Town (a16z, open source, Convex) recreates Stanford's Smallville as a deployable starter kit. It is 2D and focused on chat and socializing [older, 2023] — [GitHub](https://github.com/a16z-infra/ai-town/); [a16z essay](https://a16z.com/the-neverending-game-how-ai-will-create-a-new-category-of-games/)
- NVIDIA ACE autonomous game characters (CES 2025) include:
  - PUBG Ally, an on-device small-language-model teammate in beta — [NVIDIA](https://www.nvidia.com/en-us/geforce/news/pubg-ally-ai-teammate-beta-available-now/)
  - inZOI Smart Zoi, an experimental RTX-local feature that reflects overnight on the previous day to refine its behavior — [NVIDIA](https://www.nvidia.com/en-au/geforce/news/nvidia-ace-naraka-bladepoint-inzoi-launch-this-month/)
  - On-device teammates in NARAKA: BLADEPOINT — [same NVIDIA post](https://www.nvidia.com/en-au/geforce/news/nvidia-ace-naraka-bladepoint-inzoi-launch-this-month/)
  - Overview — [NVIDIA ACE](https://developer.nvidia.com/ace)
  Coverage is mostly NVIDIA's own pages.
- BALROG (ICLR 2025) benchmarks LLMs and VLMs on games including Crafter, Craftax-like environments and NetHack. Models do decently on easy games, are far from solving NetHack, and get worse with image input — [arXiv 2411.13543](https://arxiv.org/abs/2411.13543v2); [Epoch AI](https://epoch.ai/benchmarks/balrog)
- Craftax is a fast JAX benchmark for open-ended RL — [arXiv 2402.16801](https://arxiv.org/pdf/2402.16801)

### Inferences
- inZOI's nightly reflection is the closest commercial analogue to a long-running agent loop. It runs locally on the GPU, which shows local-first is viable for consumers with an RTX card.
- Benchmark results (NetHack failure) are consistent with the experience that pure-LLM control breaks over long horizons. Deterministic skills with an LLM planner on top remain the practical design.

### Gaps
- No search results came back for Factorio Learning Environment.
- Roblox, Fortnite/UEFN and Unity agent efforts were not researched (I ran out of my search budget).
- Voyager successors were not covered here; another researcher likely covers the open-source Minecraft agents.

## Non-AI tools relevant to building and visualization

### Takeaway
Mature non-AI tools already cover schematic building (Baritone), web maps (BlueMap) and photoreal renders (Chunky). Timelapse support is not built into any of them and must be scripted from repeated renders.

### Cited Findings
- Baritone has a `build` command that loads a schematic and builds it at the player's position — [Baritone usage (via search summary)](https://github.com/cabaletta/baritone) [unverified URL; search summary only]
- BlueMap renders 3D web maps from world files and, as a plugin, re-renders only changed regions — [GitHub](https://github.com/BlueMap-Minecraft/BlueMap)
- Chunky renders path-traced stills and has a headless CLI mode once a scene is saved — [GitHub](https://github.com/orangechannel/chunky); [minecraft.how comparison](https://minecraft.how/blog/post/bluemap-minecraft-3d-web-maps)

### Inferences
- BlueMap's incremental re-render makes a cheap daily-snapshot timelapse plausible.

### Gaps
- Litematica, WorldEdit and Distant Horizons were not researched (out of budget).
- No dedicated Minecraft timelapse tool was found.

## Community sentiment: complaints about AI bots

### Takeaway
Direct Reddit, HN and Discord complaint threads were not retrieved. The available evidence points to hype and dramatization, safety risks from code execution, and poor reliability of small local models.

### Cited Findings
- The Mindcraft authors warn that many viral posts are "heavily dramatized" and anthropomorphize the bot — [UCI project page](https://sites.uci.edu/kolbynottingham/2024/10/30/mindcraft)
- The Mindcraft README warns not to connect a bot to public servers with coding enabled, because the LLM writes and runs code on your machine — [README](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/README.md)
- On local models, Lemonade found that Qwen-1.5-7B responded to commands and attempted construction "with limited accuracy". It also found that Mindcraft sends 2,100+ input tokens for simple commands — [Lemonade docs](https://lemonade-server.ai/docs/server/apps/mindcraft)
- Ollama's default 4,096-token context can truncate large agent prompts. This is a general claim and was not confirmed for Mindcraft — [DEV post](https://dev.to/jovan_chan_9500711396d4e6/cline-ollama-stuck-in-a-loop-in-2026-the-qwen25-coder-json-tool-call-bug-and-the-90-second-98i)

### Inferences
- The likely pain points for novices are: setup friction (separate gateway apps, API keys, matching profile names), cost on cloud APIs, weak small local models, safety, and bots that wander or loop.
- A local-first project that makes the LLM optional, with deterministic skills doing the work, addresses the main reliability complaint.

### Gaps
- No primary Reddit, HN or YouTube threads on griefing, mess or cost were retrieved. The Project Sid HN thread was not found. This needs a direct search on those platforms.
- No cost figures (dollars per bot-hour) were found for any product.
