#!/usr/bin/env python3
"""learning loop M3: force Qwen3's no-think render into a model directory's chat template (before GGUF conversion).

    python3 nothink_template.py <hf model dir>      # rewrites tokenizer_config.json / chat_template.jinja in place

WHY (measured 10-24 on the 3090's Ollama 0.32.14): a Qwen3 GGUF is marked `thinking`-capable from its own metadata,
whatever the Modelfile TEMPLATE says, and with `think` UNSET -- which is what the fleet's client sends
(bots/src/llm.mjs sends no `think` field) -- Ollama serves the thinking prompt, 4 tokens shorter than the
`enable_thinking=False` render the candidate was trained on. Only `think: false` restored the trained prompt.

THE FIX: the chat template's only thinking switch is the generation-prompt tail
    {%- if enable_thinking is defined and enable_thinking is false %} {{- '<think>\\n\\n</think>\\n\\n' }} {%- endif %}
which becomes unconditional. For enable_thinking=False this renders byte-for-byte what training rendered (checked
below: the rewritten template with NO enable_thinking argument must equal the original with enable_thinking=False on
a probe conversation). The base Qwen3-8B used for the untuned comparison gets the SAME rewrite, so the base and the
candidate differ only in their weights.
"""
import json, os, re, sys

TAIL = r"""{%- if enable_thinking is defined and enable_thinking is false %}
        {{- '<think>\n\n</think>\n\n' }}
    {%- endif %}"""
FORCED = r"""{{- '<think>\n\n</think>\n\n' }}"""


def rewrite(tpl):
    """-> the template with the no-think tail unconditional. Refuses unless the switch appears exactly once."""
    n = tpl.count(TAIL)
    if n != 1:
        raise SystemExit('REFUSED: the enable_thinking tail appears %d times (expected 1) -- not a Qwen3 template?' % n)
    out = tpl.replace(TAIL, FORCED)
    if 'enable_thinking' in out.split('add_generation_prompt')[-1]:
        raise SystemExit('REFUSED: another enable_thinking switch remains in the generation-prompt branch')
    return out


def main(d):
    from transformers import AutoTokenizer
    tok = AutoTokenizer.from_pretrained(d)
    orig = tok.chat_template
    probe0 = [{'role': 'system', 'content': 'You are a bot.'}, {'role': 'user', 'content': 'state saw_end: END-AB12'}]
    if TAIL not in orig and FORCED in orig and 'enable_thinking is false' not in orig:
        # idempotent (a re-run of export), but still VERIFIED: every thinking setting must render the no-think tail
        r = [tok.apply_chat_template(probe0, tokenize=False, add_generation_prompt=True, **kw)
             for kw in ({}, {'enable_thinking': True}, {'enable_thinking': False})]
        if not (r[0] == r[1] == r[2] and r[0].endswith('<|im_start|>assistant\n<think>\n\n</think>\n\n')):
            raise SystemExit('REFUSED: %s looks rewritten but does not render the no-think tail' % d)
        print(json.dumps({'dir': d, 'rewritten': 'already (verified)'}))
        return
    new = rewrite(orig)
    probe = [{'role': 'system', 'content': 'You are a bot.'}, {'role': 'user', 'content': 'state saw_end: END-AB12'}]
    want = tok.apply_chat_template(probe, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    tok.chat_template = new
    got_unset = tok.apply_chat_template(probe, tokenize=False, add_generation_prompt=True)
    got_true = tok.apply_chat_template(probe, tokenize=False, add_generation_prompt=True, enable_thinking=True)
    if not (got_unset == want == got_true):
        raise SystemExit('REFUSED: the rewritten render differs from the trained render:\n%r\n%r\n%r' % (want[-60:], got_unset[-60:], got_true[-60:]))
    tok.save_pretrained(d)
    # transformers may keep the template in chat_template.jinja or in tokenizer_config.json; check what is on disk
    on_disk = ''
    for n in ('chat_template.jinja', 'tokenizer_config.json'):
        p = os.path.join(d, n)
        if os.path.exists(p):
            on_disk += open(p).read()
    if 'enable_thinking is false' in on_disk:
        raise SystemExit('REFUSED: the old switch is still on disk in %s' % d)
    print(json.dumps({'dir': d, 'rewritten': True, 'tail': want[-24:]}))


if __name__ == '__main__':
    main(sys.argv[1])
