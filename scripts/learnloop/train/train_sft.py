#!/usr/bin/env python3
"""learning loop M3: ONE small dry training round -- Qwen3-8B QLoRA in Unsloth on the 3090 (design s.3.2).

    cd ~/learnloop-train && ./venv/bin/python train_sft.py --data m3-train-2000.jsonl --out runs/dry-01 \
        [--base unsloth/Qwen3-8B] [--max-steps 200] [--grad-accum 10] [--fit-test-only]

PRECONDITIONS (checked, refused otherwise -- train only when no bot can reach this GPU):
  * no Ollama model is resident (/api/ps empty) and nothing else of ours holds the GPU: run.sh stops Ollama first;
  * --m2b-verified <ISO>: the time drop16.sh --verify passed at +24 h (no bot env names 10.0.0.16); recorded in metrics.

CONFIG (s.3.2; to be MEASURED, not assumed): max_seq_length 3,072, examples longer are DROPPED (never truncated) and
counted; micro-batch 1; loss on the assistant tokens only; packing off; 4-bit base + Unsloth gradient checkpointing;
LoRA r 16, alpha 32, dropout 0, on q/k/v/o/gate/up/down; adamw_8bit, lr 1e-4 cosine, 3% warmup. The dry round's
step count: 200 optimizer steps x grad-accum 10 = 2,000 sequences = one epoch of the 2,000-example subset (the design's
accumulation of 16 would be 125 steps for the same epoch; both are recorded).

QWEN3 THINKING OFF (s.3.1): every example is rendered with the base's chat template and enable_thinking=False, so the
training text is exactly the prompt a non-thinking serve sees ("<think>\\n\\n</think>\\n\\n" prefix in the assistant
turn) followed by the fleet's JSON answer. The exported Ollama template must match (run.sh template-check measures it).

MEASURED AND WRITTEN to <out>/metrics.json: peak VRAM (torch.cuda.max_memory_allocated and reserved), tokens/s over
the timed steps, tokens trained, examples dropped as too long, grad-norm per logged step (must be finite and non-zero
-- a run whose gradients are all zero is refused as broken), loss curve, wall time, versions of every library.
"""
import argparse, json, math, os, platform, sys, time, urllib.request


def ollama_resident(url='http://127.0.0.1:11434'):
    """[] or None (stopped) = nothing resident; a list of names otherwise; an unreadable answer refuses."""
    import urllib.error
    try:
        return [m.get('name') for m in json.loads(urllib.request.urlopen(url + '/api/ps', timeout=5).read()).get('models') or []]
    except urllib.error.URLError as e:
        if isinstance(getattr(e, 'reason', None), ConnectionRefusedError):
            return None
        return ['UNREADABLE: %s' % e]
    except Exception as e:                      # noqa: BLE001
        return ['UNREADABLE: %s' % e]


def render(tok, ex):
    msgs = [{'role': 'system', 'content': ex['system']}, {'role': 'user', 'content': ex['user']}]
    prompt = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    return prompt, ex['assistant'] + tok.eos_token


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--base', default='unsloth/Qwen3-8B')
    ap.add_argument('--max-seq', type=int, default=3072)
    ap.add_argument('--max-steps', type=int, default=200)
    ap.add_argument('--grad-accum', type=int, default=10)
    ap.add_argument('--lr', type=float, default=1e-4)
    ap.add_argument('--fit-test-only', action='store_true', help='50 optimizer steps, measure, save nothing but metrics')
    ap.add_argument('--save-steps', type=int, default=0, help='checkpoint every N optimizer steps (0 = none); keeps 2')
    ap.add_argument('--resume', action='store_true', help='resume from the newest checkpoint under <out>/trainer')
    ap.add_argument('--m2b-verified', default='', help='ISO time of the +24 h drop16.sh --verify OK')
    a = ap.parse_args()
    import re
    if not re.fullmatch(r'20\d\d-\d\d-\d\dT\d\d:\d\d(:\d\d)?Z', a.m2b_verified or ''):
        raise SystemExit('REFUSED: --m2b-verified <ISO Z time> of the +24 h drop16.sh --verify OK (no bot can reach .16)')
    res = ollama_resident()
    if res:
        raise SystemExit('REFUSED: Ollama still holds %s -- stop it first (run.sh does: sudo systemctl stop ollama)' % res)
    os.makedirs(a.out, exist_ok=True)
    import torch
    from unsloth import FastLanguageModel
    from datasets import Dataset
    from trl import SFTConfig, SFTTrainer
    from transformers import TrainerCallback

    t_load = time.time()
    model, tok = FastLanguageModel.from_pretrained(a.base, max_seq_length=a.max_seq, load_in_4bit=True, dtype=None)
    model = FastLanguageModel.get_peft_model(
        model, r=16, lora_alpha=32, lora_dropout=0, bias='none',
        target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'],
        use_gradient_checkpointing='unsloth', random_state=3407)
    load_s = time.time() - t_load

    rows, dropped, lens = [], 0, []
    for line in open(a.data):
        ex = json.loads(line)
        p, c = render(tok, ex)
        n_p = len(tok(p, add_special_tokens=False)['input_ids']); n_c = len(tok(c, add_special_tokens=False)['input_ids'])
        if n_p + n_c > a.max_seq:
            dropped += 1; continue
        rows.append({'prompt': p, 'completion': c}); lens.append(n_p + n_c)
    if not rows:
        raise SystemExit('no example fits in %d tokens' % a.max_seq)
    ds = Dataset.from_list(rows)
    # --max-steps 0 = exactly one epoch of the examples that fit (M3 bootstrap, 10-24)
    steps = 50 if a.fit_test_only else (a.max_steps or math.ceil(len(rows) / a.grad_accum))

    class Clock(TrainerCallback):
        def __init__(self):
            self.t = {}

        def on_step_begin(self, args, state, control, **kw):
            # skip 5 warm-up / compile steps from wherever this process started (a resumed run starts mid-way)
            self.t.setdefault('first', state.global_step)
            if state.global_step == self.t['first'] + 5 and 'start' not in self.t:
                torch.cuda.synchronize(); self.t['start'] = time.time(); self.t['start_step'] = state.global_step

        def on_train_end(self, args, state, control, **kw):
            torch.cuda.synchronize(); self.t['end'] = time.time(); self.t['end_step'] = state.global_step

    clock = Clock()
    # warmup_steps=0.03: transformers 5 dropped warmup_ratio; a float in [0, 1) is the ratio of total steps
    cfg = SFTConfig(output_dir=os.path.join(a.out, 'trainer'), per_device_train_batch_size=1,
                    gradient_accumulation_steps=a.grad_accum, max_steps=steps, learning_rate=a.lr,
                    lr_scheduler_type='cosine', warmup_steps=0.03, optim='adamw_8bit', weight_decay=0.0,
                    logging_steps=1, save_strategy='steps' if a.save_steps else 'no', save_steps=a.save_steps or 500,
                    save_total_limit=2, report_to='none', bf16=torch.cuda.is_bf16_supported(),
                    fp16=not torch.cuda.is_bf16_supported(), max_length=a.max_seq, packing=False,
                    completion_only_loss=True, seed=3407, dataloader_num_workers=0)
    tr = SFTTrainer(model=model, processing_class=tok, train_dataset=ds, args=cfg, callbacks=[clock])
    torch.cuda.reset_peak_memory_stats()
    t0 = time.time()
    ck = os.path.join(a.out, 'trainer')
    resume = a.resume and os.path.isdir(ck) and any(d.startswith('checkpoint-') for d in os.listdir(ck))
    tr.train(resume_from_checkpoint=True if resume else None)
    wall = time.time() - t0
    hist = [h for h in tr.state.log_history if 'loss' in h]
    gn = [h.get('grad_norm') for h in hist if h.get('grad_norm') is not None]
    timed_steps = clock.t.get('end_step', 0) - clock.t.get('start_step', 0)
    mean_len = sum(lens) / len(lens)
    tok_s = (timed_steps * a.grad_accum * mean_len / (clock.t['end'] - clock.t['start'])) if timed_steps > 0 else None
    import importlib.metadata as md
    vers = {p: md.version(p) for p in ('unsloth', 'unsloth_zoo', 'torch', 'transformers', 'trl', 'peft', 'bitsandbytes', 'datasets')}
    m = {'base': a.base, 'data': os.path.abspath(a.data), 'examples_in': len(rows) + dropped, 'examples_used': len(rows),
         'dropped_too_long': dropped, 'max_seq': a.max_seq, 'mean_tokens': round(mean_len), 'max_tokens': max(lens),
         'steps': steps, 'grad_accum': a.grad_accum, 'sequences_seen': steps * a.grad_accum, 'lr': a.lr,
         'lora': {'r': 16, 'alpha': 32, 'dropout': 0}, 'load_s': round(load_s), 'train_wall_s': round(wall),
         'tokens_per_s_timed': round(tok_s, 1) if tok_s else None, 'timed_steps': timed_steps,
         'peak_vram_allocated_gib': round(torch.cuda.max_memory_allocated() / 2**30, 2),
         'peak_vram_reserved_gib': round(torch.cuda.max_memory_reserved() / 2**30, 2),
         'grad_norm': {'n': len(gn), 'min': min(gn) if gn else None, 'max': max(gn) if gn else None,
                       'all_finite': all(math.isfinite(x) for x in gn), 'any_zero': any(x == 0 for x in gn)},
         'loss_first5': [round(h['loss'], 4) for h in hist[:5]], 'loss_last5': [round(h['loss'], 4) for h in hist[-5:]],
         'gpu': torch.cuda.get_device_name(0), 'versions': vers, 'python': platform.python_version(),
         'fit_test_only': a.fit_test_only, 'm2b_verified': a.m2b_verified, 'resumed': bool(resume),
         'epochs': round(steps * a.grad_accum / len(rows), 3)}
    ok = gn and m['grad_norm']['all_finite'] and not m['grad_norm']['any_zero'] and min(gn) > 0
    m['verdict'] = 'OK' if ok else 'BROKEN: grad-norm missing, zero or non-finite'
    json.dump(m, open(os.path.join(a.out, 'metrics.json'), 'w'), indent=1)
    json.dump(tr.state.log_history, open(os.path.join(a.out, 'log_history.json'), 'w'))
    print(json.dumps(m, indent=1))
    if not ok:
        sys.exit(3)
    if not a.fit_test_only:
        model.save_pretrained(os.path.join(a.out, 'lora')); tok.save_pretrained(os.path.join(a.out, 'lora'))
        model.save_pretrained_merged(os.path.join(a.out, 'merged-16bit'), tok, save_method='merged_16bit')
        print('saved', os.path.join(a.out, 'lora'), 'and', os.path.join(a.out, 'merged-16bit'))


if __name__ == '__main__':
    main()
