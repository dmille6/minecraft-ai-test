# infra/

Everything that builds the lab. Each script validates the host it runs on
rather than trusting a plan written earlier — that discipline was earned:
storage names, NIC names and firewall CIDRs all differ per node, and every one
of them was wrong somewhere on the first attempt.

| path | what it builds |
|---|---|
| `proxmox/build-lab.sh` | the five VMs from an Ubuntu cloud image + cloud-init. Additive only; refuses to touch an existing VMID; will not edit host networking. Dry-run by default. |
| `elk/` | docker-elk deployment, index templates, ILM, ingest pipeline, Kibana dashboards, and the two least-privilege service accounts. |
| `guard/` | the death circuit breaker and the experiment guard. Read raw events, never derived labels. |
| `observer/` | server-side RCON sampling of position and health, independent of the agent stack. |
| `control/` | the agent control node, and the constrained `agent` identity used for autonomous runs. |
| `homepage/` | the dashboard: live fleet metrics from Elasticsearch, per-bot health, host stats, Minecraft theme. |
| `evidence/` | the raw NDJSON archive and its pull-only collector. |
| `bluemap/` | staged 3D world map, rendered off-host. Not started. |
| `minecraft/` | RCON client. |
| `backup/` | state backup. |

## Two rules that hold across all of it

**Read the host, do not trust the plan.** rprox1 names its NICs `lan/ten/sfp`
and rprox3a names them `nic0..nic4`; rprox1 has 793G on `local-lvm` and rprox3a
has 137G. A script that assumes either one is wrong half the time.

**Verify the claim the comment makes.** The evidence pull key was installed with
`restrict` and a comment saying it "permits reading logs and nothing else" —
then testing showed `ssh -i key mike@lab01 id` returned a full shell context.
`restrict` blocks ptys and forwarding, not command execution. The comment was
wrong before the code was.
