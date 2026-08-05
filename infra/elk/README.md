# ELK stack for the minecraft-ai testbed

We use [`deviantony/docker-elk`](https://github.com/deviantony/docker-elk) rather than a
hand-rolled compose file — it is actively maintained (18k stars, ELASTIC_VERSION 9.4.4)
and handles the security/user bootstrap correctly, which is the fiddly part.

This directory holds only the things docker-elk does *not* give you: our index
mappings, our retention policy, and the host-level prerequisites.

**Role of this stack:** observability and search. It is **not** the system of record.
The JSONL files on the Minecraft VM are the source of truth; Elasticsearch is a
disposable view over them. If a mapping change requires a reindex, or an index gets
deleted, we re-ship from JSONL and lose nothing. See ADR-0001 D4.

---

## Host prerequisites

Elasticsearch will not start without this — and the failure message is not obvious:

```bash
echo 'vm.max_map_count=262144' | sudo tee /etc/sysctl.d/99-elasticsearch.conf
sudo sysctl --system
```

**Disable swap entirely** — not merely `swappiness=1` as on the Minecraft VM:

```bash
sudo swapoff -a
sudo sed -i '/\sswap\s/s/^/#/' /etc/fstab
```

A swapped Elasticsearch heap on a single node does not present as an error. It
presents as random multi-second hangs that look like a network problem.

### Proxmox settings

Elasticsearch is a JVM application, so every lesson from VM 101 applies unchanged —
see [`../../docs/ops/vm-provisioning.md`](../../docs/ops/vm-provisioning.md):

| Setting | Value |
|---|---|
| `cpu` | `x86-64-v3` — Lucene leans on AVX2 for codec and vector work |
| `balloon` | `0` |
| disk | `ssd=1,discard=on,iothread=1` |
| vCPU / RAM / disk | 4 / 8 GB / 100 GB |

---

## Required changes to docker-elk defaults

| Setting | docker-elk default | Use | Why |
|---|---|---|---|
| `ES_JAVA_OPTS` | `-Xms512m -Xmx512m` | **`-Xms4g -Xmx4g`** | 512 MB is a demo value. Half the VM's RAM, and never above ~31 GB on any node — past that you lose compressed object pointers and usable capacity goes *down*. |
| `ulimits.memlock` | often unset | `soft: -1, hard: -1` | Required for `bootstrap.memory_lock` to actually pin the heap |
| Logstash | enabled | **omit initially** | Filebeat ships JSONL straight to ES. Logstash is a second JVM costing ~1 GB for no benefit yet. Add it later if Paper log parsing needs it. |

Start without Logstash:

```bash
docker compose up -d elasticsearch kibana
```

If you do run Logstash, size the VM at 12 GB rather than 8 GB.

---

## Apply before the first document

Order matters. Once documents land under a dynamic mapping, fixing it means a reindex.

```bash
source .env
curl -u elastic:$ELASTIC_PASSWORD -XPUT localhost:9200/_ilm/policy/mcai-logs \
     -H 'content-type: application/json' \
     -d "$(jq 'del(._comment)' ilm-policy.json)"

curl -u elastic:$ELASTIC_PASSWORD -XPUT localhost:9200/_index_template/mcai-llm \
     -H 'content-type: application/json' \
     -d "$(jq 'del(._comment)' index-template.json)"
```

(`jq 'del(._comment)'` strips the explanatory blocks — Elasticsearch rejects unknown
top-level keys.)

Verify:

```bash
curl -u elastic:$ELASTIC_PASSWORD localhost:9200/_index_template/mcai-llm?pretty
```

---

## Retention: ~180 days

Set in [`ilm-policy.json`](ilm-policy.json): rollover at 10 GB primary shard or 7 days,
delete 180 days after rollover.

`min_age` in the delete phase counts from **rollover**, not from when a document was
indexed — so worst-case document age is ~187 days. A 30-day rollover would mean
keeping data up to 210 days and silently overshooting the disk budget by 15%.

### Volume estimate

| | per day | 180 days |
|---|---|---|
| LLM calls, 5 agents @ ~10k/day | ~80 MB | ~14 GB |
| Paper server logs | ~50 MB | ~9 GB |
| **Total** | ~130 MB | **~24 GB** |

Comfortable inside 100 GB. Note it scales roughly linearly with agent count — at
20 agents that becomes ~100 GB and the disk needs revisiting.

**Watch the disk watermark.** At 90% full Elasticsearch flips indices to read-only
and ingestion stops. Recovering requires manually clearing the block, so keep well
clear of it rather than relying on ILM alone to save you.

---

## Files here

| File | Purpose |
|---|---|
| `index-template.json` | Explicit mappings. `dynamic: strict`, `replicas: 0`, `flattened` for `messages`/`tool_calls` |
| `ilm-policy.json` | Rollover + 180-day retention |
| `../../schemas/llm-call.schema.json` | The record format the harness emits — keep in sync with the mapping |

Two mapping decisions worth not undoing:

- **`number_of_replicas: 0`** — on a single node any replica is unassignable, leaving
  every index permanently YELLOW.
- **`messages` / `tool_calls` as `flattened`** — dynamically mapping arbitrary tool-call
  JSON creates a field per distinct key until the field limit rejects writes. This is
  the most common way people break Elasticsearch with LLM logs.
