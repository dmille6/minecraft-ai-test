# LLM/VLM Agents in Minecraft and Open Worlds: Research Landscape 2023 to Nov 2026

Method note: 11 searches and 3 abstract-page fetches (2026-11-22). Items marked [V] were opened (abstract page). Items marked [S] are from search snippets only. Items marked [M] come from the researcher's background knowledge (pre-2026 canon) and were NOT re-verified in this session; treat their numbers as unverified.

## Status and follow-ups of the canonical systems

### Takeaway
The field split into two lines. API/code agents (Voyager-style, Mineflayer) lead for long-horizon survival and multi-agent work, capped in Oct 2026 by a 4-agent team finishing the game end to end. Pixel/VLA agents (CraftJarvis: JARVIS-VLA, ROCKET; PKU/HIT: Optimus-1/2/3) improve low-level control and benchmarks but remain short-horizon. Building and coordination are still the weakest skills.

### Cited Findings
**API / code-generation line (closest to this project)**
- Voyager (2023, older): GPT-4 writes Mineflayer JavaScript skills into a growing skill library, with automatic curriculum and iterative self-verification through execution feedback. It is the template for most later code agents. [M] — https://arxiv.org/abs/2305.16291
- GITM (2023, older): LLM decomposer, planner and interface over structured text actions. It reported high Overworld tech-tree coverage without a GPU-trained policy. [M] — https://arxiv.org/abs/2305.17144
- DEPS (2023, older): Describe, Explain, Plan, Select loop, which re-plans from failure explanations. [M] — https://arxiv.org/abs/2302.01560
- Plan4MC (2023, older): RL basic skills plus an LLM skill graph for planning. [M] — https://arxiv.org/abs/2303.16563
- Odyssey (IJCAI-25): a library of 40 primitive and 183 compositional skills. It adds a LLaMA-3 fine-tuned on 390k+ Minecraft-Wiki QA entries, plus a benchmark covering long-term planning, dynamic planning and exploration. Code and weights are public. This is the main open-model, Voyager-style follow-up. [S] — https://www.ijcai.org/proceedings/2025/22 ; https://github.com/zju-vipa/odyssey
- "A team of Gemini 4 Argon agents beats Minecraft" (Faldor, Singh, Raileanu; arXiv 2610.22319, 15 Oct 2026) [V]:
  - Four agents killed the Ender Dragon from a random Easy-difficulty survival world in 27 h 14 min.
  - They wrote 2,783 programs and died 605 times.
  - They used only standard Mineflayer, with no human-written game tools, no assigned roles and no pre-scouted seed.
  - They coordinated through in-game chat and shared memory, dividing work, sharing knowledge and recovering each other's items.
  - It is claimed as the first end-to-end autonomous completion. — https://arxiv.org/abs/2610.22319
- Parallelized Planning-Acting (arXiv 2503.03505, AAMAS 2026): splits planning and acting into two threads with interruptible execution, for multi-agent LLM systems in Minecraft. [S] — https://arxiv.org/html/2503.03505v2

**Pixel / VLA line**
- VPT (OpenAI 2022, older): a behavioural prior learned from contractor video plus inverse dynamics. It can be fine-tuned with imitation learning or RL. [S] — https://arxiv.org/pdf/2206.11795.pdf
- STEVE-1 (2023, older): a text- and visual-goal-conditioned VPT (unCLIP-style). [M] — https://arxiv.org/abs/2306.00937
- GROOT (2023, older): video-instruction-conditioned policy. [M] — https://arxiv.org/abs/2310.08235
- MineDojo (2022, older): the internet-scale knowledge base plus MineCLIP. [M] — https://arxiv.org/abs/2206.08853
- JARVIS-1 (2023, older): multimodal memory-augmented planner over a STEVE-style controller. [M] — https://arxiv.org/abs/2311.05997
- JARVIS-VLA (ACL Findings 2025): post-trains large VLMs to play with keyboard and mouse across 1,000+ atomic tasks. It reports state-of-the-art results over imitation-learning policies. [S] — https://aclanthology.org/2025.findings-acl.920 ; https://arxiv.org/pdf/2503.16365
- ROCKET-2 (CraftJarvis; AAAI-26 version listed): cross-view goal alignment. Inference is 3x to 6x more efficient than ROCKET-1, and it transfers zero-shot to Doom, DMLab and Unreal. It is evaluated on the Minecraft Interaction Benchmark. [S] — https://craftjarvis.github.io/ROCKET-2 ; https://arxiv.org/abs/2503.02505
- MCU (CraftJarvis; ICML per snippet): 3,452 composable atomic tasks in 11 categories and 41 subcategories. Its VLM auto-evaluator reports 91.5% agreement with human ratings. [S] — https://arxiv.org/html/2310.08367v4
- Optimus-1 (NeurIPS 2024, older): hybrid multimodal memory. [M] — https://arxiv.org/abs/2408.03615
- Optimus-2 (CVPR 2025): goal-observation-action conditioned policy. [S] — https://openaccess.thecvf.com/content/CVPR2025/html/Li_Optimus-2_Multimodal_Minecraft_Agent_with_Goal-Observation-Action_Conditioned_Policy_CVPR_2025_paper.html
- Optimus-3 (arXiv 2506.10357, Jun 2025) [S]:
  - A Mixture-of-Experts generalist covering perception, planning, action, grounding and reflection, combining System-1 and System-2 behaviour.
  - Claims to beat GPT-4o, Gemini-1.5-pro and Qwen2.5-VL.
  - Reported gains (from a secondary summary, unverified): about +21% planning, +76% embodied QA, 3.4x grounding, up to 60% success on open-ended tasks.
  - The project page title has since changed to "Dual-Router Aligned MoE ... Reasoning-Aware Policy Optimization", which suggests a revised version.
  - Links: https://arxiv.org/abs/2506.10357 ; https://cybertronagent.github.io/Optimus-3.github.io/ ; https://huggingface.co/iLearn-Lab/Optimus-3

**Multi-agent / civilization**
- MINDcraft and MineCollab (UCSD with Emergent Garden; arXiv 2504.17950; NeurIPS 2025 as "Blocks, Bots, and Bottlenecks") [S]:
  - 47 in-game tools across cooking, crafting and construction tasks.
  - Communication is the main bottleneck: performance drops up to 15% when agents must communicate detailed plans.
  - The authors argue that methods beyond in-context and imitation learning are needed.
  - Links: https://arxiv.org/abs/2504.17950 ; https://neurips.cc/virtual/2025/137194
- Project Sid / PIANO (Altera; arXiv 2411.00114, Oct 2024, older) [S]:
  - A concurrent, brain-inspired architecture: parallel modules with a coherence bottleneck.
  - Scaled to 1,000+ agents, with emergent roles, emerald currency, tax votes and spreading memes and religion.
  - The authors admit weak spatial awareness and physical coordination.
  - Many of the vivid claims come from press coverage.
  - Links: https://arxiv.org/abs/2411.00114 ; https://github.com/altera-al/project-sid
- Gated Coordination (Jian et al.; arXiv 2604.18975, Apr 2026) [V]:
  - Separates private execution state from public coordination state.
  - Uses event-triggered working memory, updated only on system-verified outcomes.
  - Uses cost-sensitive gated escalation, which talks across regions only when node criticality, local recovery cost and downstream impact justify it.
  - On long construction blueprints, it beats always-communicate and planned-structure baselines on completion quality and chain length, with fewer wasted escalations.
  - The abstract gives no numbers and names no model. — https://arxiv.org/abs/2604.18975
- MindForge (arXiv 2411.12977): Theory-of-Mind for cultural learning. Open-weight LLMs "still falter on elementary tasks after domain-specific fine-tuning". [S] — https://arxiv.org/html/2411.12977v5
- TeamCraft, VillagerAgent, S-Agents, Plancraft: the searches returned nothing. See Gaps.

### Inferences
- The Oct 2026 Gemini result validates this project's core bet (Mineflayer plus self-written programs plus chat and shared memory). It also shows the cost profile: about 600 deaths and 2.8k programs in a day are tolerated. A frontier model was required.
- Pixel/VLA work is mostly irrelevant to an API-controlled builder, except its evaluators (MCU's VLM judge).

### Gaps
- TeamCraft (multi-modal multi-agent benchmark, late 2024), VillagerAgent (graph-based task coordination, ACL 2024 Findings), S-Agents (self-organizing agents, 2024) and Plancraft (crafting-planning benchmark, 2024/25) were not verified this session. They are named from background knowledge only.
- The Gemini 4 Argon paper's limits section and its compute and cost figures were not read.

## New 2025-2026 work: long horizon, building, civilizations, small models, evaluation

### Takeaway
Building has a benchmark (MineAnyBuild) and some blueprint agents (APT, T2BM). No paper found grades "beautiful" builds or terraforming as a primary aim. Distilling trajectories into small Minecraft models is barely studied: one hobby dataset distils Sonnet into Qwen 9B.

### Cited Findings
- APT (arXiv 2411.17255, AAAI 2025): chain-of-thought architectural planning to text-to-blueprint, with memory and reflection modules. A/B tests show memory gives significant gains. [S] — https://arxiv.org/abs/2411.17255
- T2BM (arXiv 2406.08751, 2024): text to building through prompt refinement, an interlayer representation and repair. [S] — https://arxiv.org/abs/2406.08751v1
- MineAnyBuild (arXiv 2505.20148, 2025): 4,000 spatial-planning tasks. Its creativity dimension scores aesthetics and structure through humans or critique MLLMs. [S] — https://arxiv.org/html/2505.20148v3
- GuessBench (arXiv 2506.00814): VLMs infer what player builds depict. This is sensemaking, not quality. [S] — https://arxiv.org/html/2506.00814v2
- Creative Agents (arXiv 2312.02519, older): GPT-4V does pairwise comparison and scoring of build images. It is an early LLM-as-judge for builds. [S] — https://arxiv.org/pdf/2312.02519
- Madge and Poesio (arXiv 2402.08392): builder and architect agents for the Collaborative Builder Task, with open and closed models. [S] — https://arxiv.org/pdf/2402.08392
- Echo (KAIST; arXiv 2604.05533, Apr 2026) [V]:
  - Experience memory along five dimensions: structure, attribute, process, function and interaction.
  - In-Context Analogy Learning reuses that experience on new tasks.
  - 1.3x to 1.7x faster object unlocking from scratch, with "burst" chain-unlocking after transferable experience.
  - Backbone not named. — https://arxiv.org/abs/2604.05533
- Other 2026 items from an awesome-list, not opened [S] — https://github.com/git-disl/awesome-LLM-game-agent-papers:
  - MineNPC-Task, a memory-aware task suite (2026-01).
  - Requesting Expert Reasoning, learned collaborative intervention (2026-02).
  - BLOCK, a skin pipeline (2026-03), which is irrelevant here.
  - Ratchet, a minimal hygiene recipe for self-evolving agents (2026-05).
- Distillation: agent-society-distill-v1 has 1,355 SFT examples of Claude Sonnet per-tick decisions, distilled into a Qwen3.5-9B LoRA at Q4_K_M. The author calls it a proof of concept: rare actions are weak (hunt has 5 examples), and some noisy teacher labels were kept. [S] — https://huggingface.co/datasets/SebastianAldrin/agent-society-distill-v1
- General agent distillation (not games): 0.5B to 3B students with retrieval and code tools match next-tier 1.5B to 7B CoT-distilled models. [S] — https://arxiv.org/abs/2505.17612
- No dedicated paper on agents that clean or maintain a world, on settlement planning, or on terraforming was found. Gated Coordination's long construction blueprints and APT are the closest.

### Inferences
- World tidiness and aesthetics are open research territory. The practical judge pattern is a VLM critique of rendered views (MineAnyBuild, Creative Agents, the MCU evaluator at 91.5% agreement), checked against human labels.
- Echo-style typed experience memory and Gated Coordination's "update memory only on verified outcomes" both match this repo's "intent rows are not outcomes" lesson.

### Gaps
- Searches surfaced no verified 2026 paper on building beauty, terraforming or settlement layout. Some may exist but are poorly indexed.
- None of the 2026 abstracts give the backbone model.

## Model size vs capability, and multi-agent communication cost

### Takeaway
The evidence is thin and qualitative. Open and fine-tuned models trail frontier ones on embodied Minecraft tasks (MindForge, Odyssey's need for a wiki fine-tune). The only full-game win used a frontier model. Communication has a measurable cost (up to -15% in MineCollab), and gating it is the 2026 response.

### Cited Findings
- MineCollab: up to a 15% drop when detailed plan communication is required. [S] — https://arxiv.org/abs/2504.17950
- Gated Coordination: selective escalation beats always-communicate baselines (qualitative). [V] — https://arxiv.org/abs/2604.18975
- Parallel planning-acting with interruption addresses the latency of LLM calls in real time. [S] — https://arxiv.org/html/2503.03505v2
- Open-weight models falter on elementary tasks even after fine-tuning (MindForge). [S] — https://arxiv.org/html/2411.12977v5
- Optimus-3, a domain-trained MoE, claims to beat general frontier VLMs on Minecraft perception and planning. This suggests domain training can close the gap for narrow skills. [S] — https://arxiv.org/abs/2506.10357

### Inferences
- For a local-first fleet: keep deterministic code for execution and routing, use a local model for routine choices, and save frontier calls for rare planning and debugging. Gate inter-bot chat by cost.
- Distilling frontier logs into a local 7B to 9B model looks feasible but needs class balancing for rare actions.

### Gaps
- No controlled size-scaling study (same harness, models of several sizes) for Minecraft agents was found.
- No token or dollar cost figures per agent-hour were found.
