#!/usr/bin/env python3
"""learning loop M3: the served prompt must equal the TRAINED prompt (Codex r1 P2: a template that drops the
"</think>\\n\\n" tail, or injects think tags, changes every decision silently).

    ./venv/bin/python template_check.py --items data/m3-eval.jsonl --model cand-qwen3-8b-v0-dry [--n 3]

For n items: the HF tokenizer renders system + user with the base's chat template and enable_thinking=False,
add_generation_prompt=True (exactly train_sft.render's prompt half) and counts its tokens; Ollama is asked the same
messages with num_predict 1 and keep_alive 0 (unloaded after each call, so no cached prefix shortens the count) and
reports prompt_eval_count. Every pair must be EQUAL. Positive control: the same check on a deliberately wrong render
(thinking ON) must differ, or the check cannot see a template difference at all.
"""
import argparse, json, os, sys, urllib.request


def ollama_count(url, model, system, user):
    body = {'model': model, 'stream': False, 'keep_alive': 0, 'messages': [{'role': 'system', 'content': system},
                                                                          {'role': 'user', 'content': user}],
            'options': {'num_predict': 1, 'num_ctx': 8192, 'temperature': 0}}
    req = urllib.request.Request(url + '/api/chat', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=600).read()).get('prompt_eval_count')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--items', required=True)
    ap.add_argument('--model', required=True)
    ap.add_argument('--base', default='unsloth/Qwen3-8B')
    ap.add_argument('--url', default='http://127.0.0.1:11434')
    ap.add_argument('--n', type=int, default=3)
    a = ap.parse_args()
    from transformers import AutoTokenizer
    tok = AutoTokenizer.from_pretrained(a.base)
    items = [json.loads(l) for l in open(a.items) if l.strip()][:a.n]
    rows, ok = [], True
    for it in items:
        msgs = [{'role': 'system', 'content': it['system']}, {'role': 'user', 'content': it['user']}]
        good = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        wrong = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=True)
        hf = len(tok(good, add_special_tokens=False)['input_ids']); hf_wrong = len(tok(wrong, add_special_tokens=False)['input_ids'])
        ol = ollama_count(a.url, a.model, it['system'], it['user'])
        rows.append({'id': it['id'], 'hf_no_think': hf, 'hf_think_on (control)': hf_wrong, 'ollama': ol, 'equal': ol == hf})
        ok = ok and ol == hf and hf_wrong != hf
    print(json.dumps({'model': a.model, 'items': rows, 'pass': ok}, indent=1))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
