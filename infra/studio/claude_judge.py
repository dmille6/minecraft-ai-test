"""Claude as referee judge over the replay set, via the Message Batches API (50% price).

Same grading instructions as the local judges (judge.py), so labels are comparable.

  python3 claude_judge.py submit  <replay.jsonl> <ids.txt|ALL> <model> <effort> <out_prefix>
  python3 claude_judge.py collect <out_prefix>

The API key is read from ANTHROPIC_API_KEY, or from ~/.config/mcai/anthropic.key (mode 600).
It is never printed or logged.
"""
import json
import os
import stat
import sys

import anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

SYS = ("You grade decisions made by a Minecraft bot. The bot saw the PROMPT below and chose ONE skill with arguments. "
       "Judge whether the choice was sensible GIVEN WHAT THE BOT COULD SEE when it chose. The later OUTCOME is a hint only: "
       "an action can be right and still be aborted by a controller or fail for reasons the bot could not know. "
       "Return acceptable_skills (skill names from the prompt that would be reasonable next actions), decision_ok, args_ok, "
       "and why (one short sentence).")
SCHEMA = {
    "type": "object",
    "properties": {
        "acceptable_skills": {"type": "array", "items": {"type": "string"}},
        "decision_ok": {"type": "string", "enum": ["yes", "no", "unclear"]},
        "args_ok": {"type": "string", "enum": ["yes", "no", "unclear"]},
        "why": {"type": "string"},
    },
    "required": ["acceptable_skills", "decision_ok", "args_ok", "why"],
    "additionalProperties": False,
}


def client():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        p = os.path.expanduser("~/.config/mcai/anthropic.key")
        if not os.path.exists(p):
            sys.exit("no API key: set ANTHROPIC_API_KEY or create ~/.config/mcai/anthropic.key (chmod 600)")
        if os.stat(p).st_mode & (stat.S_IRWXG | stat.S_IRWXO):
            sys.exit(f"{p} must be mode 600")
        os.environ["ANTHROPIC_API_KEY"] = open(p).read().strip()
    return anthropic.Anthropic()


def user_text(item):
    return (f"PROMPT THE BOT SAW:\n{item['prompt']}\n\nBOT'S DECISION: skill={item['logged_skill']} "
            f"args={json.dumps(item['logged_args'])} reason={item.get('logged_reason')!r}\n\n"
            f"OUTCOME (hint only): {item.get('outcome_status')} {item.get('outcome_detail', '')[:300]}")


def submit(replay, ids_path, model, effort, prefix):
    items = [json.loads(line) for line in open(replay)]
    if ids_path != "ALL":
        want = {line.strip() for line in open(ids_path) if line.strip()}
        items = [x for x in items if x["id"] in want]
    reqs = [Request(custom_id=str(i), params=MessageCreateParamsNonStreaming(
        model=model, max_tokens=4000, system=SYS,
        messages=[{"role": "user", "content": user_text(x)}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": SCHEMA}}))
        for i, x in enumerate(items)]
    json.dump({str(i): x["id"] for i, x in enumerate(items)}, open(prefix + ".idmap.json", "w"))
    b = client().messages.batches.create(requests=reqs)
    json.dump({"batch_id": b.id, "model": model, "effort": effort, "n": len(reqs)}, open(prefix + ".batch.json", "w"))
    print(f"submitted batch {b.id}: {len(reqs)} requests, model {model}, effort {effort}")


def collect(prefix):
    meta = json.load(open(prefix + ".batch.json"))
    idmap = json.load(open(prefix + ".idmap.json"))
    c = client()
    b = c.messages.batches.retrieve(meta["batch_id"])
    if b.processing_status != "ended":
        print(f"not finished: {b.processing_status} {b.request_counts}")
        return
    n_in = n_out = 0
    counts = {}
    with open(prefix + ".labels.jsonl", "w") as f:
        for r in c.messages.batches.results(meta["batch_id"]):
            rid = idmap[r.custom_id]
            row = {"id": rid, "judge": meta["model"], "label": None}
            if r.result.type == "succeeded":
                m = r.result.message
                n_in += m.usage.input_tokens
                n_out += m.usage.output_tokens
                if m.stop_reason == "refusal":
                    row["raw"] = "refusal"
                else:
                    text = next((blk.text for blk in m.content if blk.type == "text"), "")
                    try:
                        row["label"] = json.loads(text)
                    except ValueError:
                        row["raw"] = text[:300]
            else:
                row["raw"] = r.result.type
            counts[r.result.type] = counts.get(r.result.type, 0) + 1
            f.write(json.dumps(row) + "\n")
    print(f"collected: {counts}; tokens in {n_in:,} out {n_out:,} -> {prefix}.labels.jsonl")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "submit" and len(sys.argv) == 7:
        submit(*sys.argv[2:7])
    elif cmd == "collect" and len(sys.argv) == 3:
        collect(sys.argv[2])
    else:
        sys.exit(__doc__)
