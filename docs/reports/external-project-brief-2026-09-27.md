# Minecraft AI: Project Landscape and Recommended Build

Prepared for Darrell Miller  
Research date: September 27, 2026

## Recommendation

Build around **Mindcraft + Mineflayer**, establish a working baseline using your Claude API, and then add local inference and persistent learning. Your Proxmox server, NVIDIA RTX 5080, and existing Ollama installation are a useful foundation. Use Codex to develop and maintain the surrounding software.

Start with a bot that improves through saved experience and reusable skills. Move into model training after you have a reliable environment and a way to measure improvement.

This brief is based on public GitHub repositories, documentation, research releases, Hugging Face, and Reddit discussions. Official Discord communities were located, but their private conversations were not inspected. Projects were reviewed, not installed or benchmarked on your hardware. Activity dates and compatibility information are a snapshot of the research date.

## Mineflayer Is Not Abandoned

The official [PrismarineJS Mineflayer repository](https://github.com/PrismarineJS/mineflayer) remains maintained. Its [release page](https://github.com/PrismarineJS/mineflayer/releases/tag/4.39.0) listed version **4.39.0**, released September 6, as the latest release when checked.

Mineflayer supplies the Minecraft connection and APIs for movement, inventory, blocks, and interactions. It is the control layer. An AI agent framework such as Mindcraft supplies the decision-making above it.

## Projects Worth Considering

| Project | What it offers | Assessment |
| --- | --- | --- |
| [Mindcraft](https://github.com/mindcraft-bots/mindcraft) | LLM agents built on Mineflayer, with Claude, Ollama, other providers, and task evaluation. | **Best starting point.** Established foundation; maintainers acknowledge slow GitHub issue responses and direct users toward Discord. |
| [Mindcraft Community Edition](https://github.com/mindcraft-ce/mindcraft-ce) | Experimental fork with structured tool calls, retrieval-augmented memory, and additional integrations. | **Most relevant active fork.** Its organization page showed an update September 22, 2026. Consider its stable branch first; the `agent-system` branch is experimental. |
| [Voyager](https://github.com/MineDojo/Voyager) | Automatic goal selection, generated skills, execution feedback, and a growing reusable skill library. | **Best architecture to study for experience-based learning.** Older research setup, including Minecraft 1.19 examples. Borrow its design before attempting to modernize the entire repository. |
| [MineStudio](https://github.com/CraftJarvis/MineStudio) | Simulation, datasets, pretrained policies, imitation learning, reinforcement learning, and evaluation. | **Best research foundation for actual model training**, especially visual gameplay. Its organization page showed an update in May 2026. More involved than Mindcraft. |
| [ROCKET-3](https://github.com/CraftJarvis/ROCKET-3) | Visual control policies and online reinforcement learning built on MineStudio. | Current research worth following; its organization page showed an update September 24, 2026. Defaults target distributed, multi-GPU training. The repository notes incomplete reproduction components and unvalidated full training convergence. |
| [XENON](https://github.com/ml-postech/XENON) | ICLR 2026 research on correcting knowledge through experience and learning Minecraft task dependencies. | Relevant to improvement through experience. Research code with substantial setup requirements, rather than a turnkey home deployment. |
| [mc-agents](https://github.com/jblemee/mc-agents) | Separates immediate survival behavior from LLM strategy and maintains persistent agent memory files. | Useful design reference. Its small repository history makes it a secondary reference rather than the primary foundation. |

Related resources include [MineStudio documentation](https://craftjarvis.github.io/MineStudio/), [OpenHA](https://github.com/CraftJarvis/OpenHA), and [STEVE-1](https://github.com/Shalev-Lifshitz/STEVE-1). OpenHA explores hierarchical visual actions; STEVE-1 is an older instruction-following policy using pixels and low-level controls.

## What “Learning to Play” Means

| Approach | What changes as the system improves | Practical fit |
| --- | --- | --- |
| Experience-based learning | Stored memories, plans, failure lessons, and reusable skills. The base model weights stay fixed. | **Recommended first phase.** Voyager demonstrates this general approach. |
| Model training | Neural-network weights change through demonstrations, fine-tuning, or reinforcement learning. | A later research phase using tools such as MineStudio. |
| Visual gameplay | The agent interprets screen pixels and controls mouse/keyboard actions. Learning can use either of the approaches above. | Adds perception and control complexity compared with structured Mineflayer observations. |

A model that already knows Minecraft and executes commands is not necessarily learning from each session. Persistent state, a feedback loop, and evaluation are needed to demonstrate improvement.

## Recommended Architecture for Your Equipment

The following is a proposed design. It is not a turnkey feature set supplied by one repository.

| Component | Recommended role |
| --- | --- |
| Proxmox | Run a separate Ubuntu VM for the Minecraft server and agent runtime. Snapshot before major changes. |
| Minecraft Java Edition | Private test server, pinned to a version supported by the selected agent stack. Upstream Mindcraft currently recommends 1.21.6. |
| Mindcraft + Mineflayer | Observe game state and execute movement, gathering, crafting, and building. |
| Claude API | Establish the initial planning baseline. Later, handle difficult goals or recovery after repeated local-model failures. |
| RTX 5080 + local inference | Run and compare smaller local models once the baseline is reliable. |
| Codex | Develop the memory layer, evaluation harness, recovery logic, and dashboard. |
| SQLite + skill files | Persist attempts, outcomes, lessons, and verified reusable behaviors. |

Keep the existing GPU-backed Ollama service where it already works and let the agent reach it over the private network. The proposed agent VM does not need its own GPU for basic structured-state gameplay.

Use ordinary code for immediate survival behaviors such as eating or responding to danger. Let the LLM choose goals and plans. The mc-agents repository provides an example of this separation.

## Implementation Sequence

### 1. Establish a Working Baseline

- Start with one bot and the Claude API.
- Pin the Minecraft version and agent dependencies once a working combination is established.
- Use small, bounded tasks: collect logs, craft tools, build a shelter, and acquire iron.
- Keep autonomous code execution disabled initially.
- Record task completion, elapsed time, deaths, retries, and API usage.

The first objective is reliable interaction with the world, before adding a learning layer.

### 2. Verify Outcomes From Game State

Check inventory, location, placed blocks, and other observable conditions. A bot saying “done” should not count as completion.

For example, an iron-pickaxe task succeeds when the expected item is present in inventory. Shelter evaluation needs explicit criteria established before the run.

Use timeouts, retry limits, and an application-level API budget so a stuck agent cannot continue indefinitely.

### 3. Add Persistent Experience and Skills

After each attempt, store:

- Goal and starting conditions.
- Relevant observations and actions.
- Verified outcome and errors.
- A concise lesson from success or failure.
- Any reusable skill, including its prerequisites and known limitations.

Retrieve relevant lessons before the next attempt. Promote successful behavior into reusable skills only after verification. Generated-code skills would be a later extension and should be tested inside the isolated agent VM.

This follows Voyager's broad approach of feedback, reusable skills, and an expanding curriculum. It does not require updating model weights.

### 4. Measure Whether Learning Transfers

Run the same task suite across fresh world seeds with memory enabled and disabled. Compare:

| Metric | What it shows |
| --- | --- |
| Task success rate | Whether the agent achieves its goals more reliably. |
| Time to completion | Whether it becomes more efficient. |
| Deaths and failed attempts | Whether it avoids previously encountered problems. |
| API usage and cost | Whether improvements reduce paid inference. |
| Performance on unfamiliar seeds | Whether skills transfer beyond a familiar world. |
| Persistence after restart | Whether improvement survives beyond the current context window. |

Keep the model, task definition, and evaluation rules consistent when comparing runs. Performance gains caused by changing the model should be distinguished from gains caused by saved experience.

### 5. Compare Local Models and Add Escalation

Once Claude establishes a baseline, run identical tasks with local models. Compare task success and latency rather than chat quality alone.

Later, add a routing policy that lets the local model handle routine decisions and escalates after repeated failure or lack of progress. Automatic escalation is additional development work, not an assumed built-in Mindcraft feature.

### 6. Explore Training

If model training remains the goal, use the collected and verified trajectories as the starting point for a separate experiment. Evaluate MineStudio and pretrained policies before attempting training from scratch.

ROCKET-3 is worth studying, but its default distributed training configuration should not be treated as a ready-made recipe for a single 5080.

## GPU and Runtime Considerations

NVIDIA lists the [RTX 5080 with 16 GB of GDDR7 memory](https://marketplace.nvidia.com/en-us/consumer/graphics-cards/nvidia-geforce-rtx-5080/).

As an initial sizing estimate, target a quantized model in roughly the **4B–14B parameter range**, leaving VRAM for context and runtime overhead. Actual fit depends on architecture, quantization, context length, and concurrent services. This is not a measured Minecraft benchmark.

There is a specific model/runtime compatibility wrinkle:

- Upstream Mindcraft recommends an older **Andy-4 micro** model through Ollama.
- The current Community Edition README recommends **LM Studio for its Andy models** and warns of problems with Ollama.

These recommendations refer to different project/model combinations. Keep Ollama for suitable models, but verify the exact model card and runtime requirements before troubleshooting gameplay. See the [Andy model collection](https://huggingface.co/collections/Mindcraft-CE/andy-4) and [older Andy-4 Ollama page](https://ollama.com/Sweaterdog/Andy-4).

## Communities and Demonstrations

- **[Mindcraft CE Discord](https://discord.gg/mindcraft-ce):** Official community link. The upstream Mindcraft README also links its support Discord. Private channel activity was not inspected for this brief.
- **[CraftJarvis on GitHub](https://github.com/CraftJarvis):** Useful research hub for Minecraft agents, visual control, and training.
- **[Mica demonstration on r/LocalLLaMA](https://www.reddit.com/r/LocalLLaMA/comments/1wqahbz/mica_v01_4b_got_an_iron_pickaxe_in_real_minecraft/):** The author reports a 4B model choosing commands through Mindcraft to obtain an iron pickaxe. Interesting as a small-model experiment, but the demonstration is not independently verified evidence of general gameplay competence.
- **[Local Mindcraft discussion](https://www.reddit.com/r/LocalLLaMA/comments/1kj2yjl/who_else_has_tried_to_run_mindcraft_locally/):** Anecdotal experiences with local-model consistency. Useful for troubleshooting ideas, not a controlled benchmark.

## First Milestone

**Build a bot that reliably obtains iron, remembers its failures across restarts, and improves its success rate across fresh worlds.**

This is a concrete first experiment before pursuing full-game completion, multiple cooperating agents, or GPU training.

## Source Index

1. [Mineflayer repository](https://github.com/PrismarineJS/mineflayer)
2. [Mineflayer 4.39.0 release](https://github.com/PrismarineJS/mineflayer/releases/tag/4.39.0)
3. [Mindcraft repository and documentation](https://github.com/mindcraft-bots/mindcraft)
4. [Mindcraft Community Edition repository](https://github.com/mindcraft-ce/mindcraft-ce)
5. [Mindcraft CE organization and activity](https://github.com/mindcraft-ce)
6. [Voyager repository](https://github.com/MineDojo/Voyager)
7. [MineStudio repository](https://github.com/CraftJarvis/MineStudio)
8. [MineStudio documentation](https://craftjarvis.github.io/MineStudio/)
9. [ROCKET-3 repository](https://github.com/CraftJarvis/ROCKET-3)
10. [XENON repository](https://github.com/ml-postech/XENON)
11. [mc-agents repository](https://github.com/jblemee/mc-agents)
12. [CraftJarvis organization and activity](https://github.com/CraftJarvis)
13. [OpenHA repository](https://github.com/CraftJarvis/OpenHA)
14. [STEVE-1 repository](https://github.com/Shalev-Lifshitz/STEVE-1)
15. [Andy model collection](https://huggingface.co/collections/Mindcraft-CE/andy-4)
16. [Andy-4 on Ollama](https://ollama.com/Sweaterdog/Andy-4)
17. [NVIDIA RTX 5080 specifications](https://marketplace.nvidia.com/en-us/consumer/graphics-cards/nvidia-geforce-rtx-5080/)
18. [Mica Reddit demonstration](https://www.reddit.com/r/LocalLLaMA/comments/1wqahbz/mica_v01_4b_got_an_iron_pickaxe_in_real_minecraft/)
19. [Local Mindcraft Reddit discussion](https://www.reddit.com/r/LocalLLaMA/comments/1kj2yjl/who_else_has_tried_to_run_mindcraft_locally/)
