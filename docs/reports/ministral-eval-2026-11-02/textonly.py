"""Ollama ministral-3 blob (text + vision in one GGUF, Ollama key names) -> a text-only GGUF llama.cpp b12020 loads.
Tensor bytes are copied unchanged (same Q4_K_M weights). Metadata: vision/mm keys and tensors dropped; Ollama's rope key
names mapped to llama.cpp's (as conversion/mistral3.py writes them for ministral3: yarn_log_multiplier = mscale_all_dim,
attention.temperature_scale = llama_4_scaling_beta); tokenizer pre 'tekken' (Ollama wrote 'default'); chat template =
the Ollama template of the same artifact in jinja (BOS, [SYSTEM_PROMPT]..[/SYSTEM_PROMPT], [INST]..[/INST])."""
import sys
from gguf import GGUFReader, GGUFWriter, GGUFValueType

src, dst = sys.argv[1], sys.argv[2]
r = GGUFReader(src)
arch = r.fields['general.architecture'].contents()
assert arch == 'mistral3', arch
w = GGUFWriter(dst, arch)
TEMPLATE = ("{{- bos_token }}{%- for m in messages %}{%- if m['role'] == 'system' %}{{- '[SYSTEM_PROMPT]' + m['content'] + '[/SYSTEM_PROMPT]' }}"
            "{%- elif m['role'] == 'user' %}{{- '[INST]' + m['content'] + '[/INST]' }}"
            "{%- elif m['role'] == 'assistant' %}{{- m['content'] }}{%- if not loop.last %}{{- eos_token }}{%- endif %}{%- endif %}{%- endfor %}")
RENAME = {'mistral3.rope.scaling.beta_fast': 'mistral3.rope.scaling.yarn_beta_fast',
          'mistral3.rope.scaling.beta_slow': 'mistral3.rope.scaling.yarn_beta_slow'}
DROP_PREFIX = ('mistral3.vision.', 'mistral3.mm.', 'GGUF.')
DROP = {'general.architecture', 'mistral3.image_token_index', 'mistral3.spatial_merge_size', 'mistral3.rope.scaling_beta',
        'mistral3.rope.scaling.mscale', 'mistral3.rope.scaling.mscale_all_dim', 'tokenizer.ggml.pre'}
f = r.fields
for k, fld in f.items():
    if k in DROP or k.startswith(DROP_PREFIX):
        continue
    k2 = RENAME.get(k, k)
    t = fld.types[0]
    v = fld.contents()
    if t == GGUFValueType.ARRAY:
        w.add_key_value(k2, v, t, sub_type=fld.types[-1])
    else:
        w.add_key_value(k2, v, t)
w.add_tokenizer_pre('tekken')
w.add_rope_scaling_yarn_log_mul(float(f['mistral3.rope.scaling.mscale_all_dim'].contents()))
w.add_attn_temperature_scale(float(f['mistral3.rope.scaling_beta'].contents()))
w.add_chat_template(TEMPLATE)
n = 0
for t in r.tensors:
    if t.name.startswith(('v.', 'mm.')):
        continue
    w.add_tensor_info(t.name, t.data.shape, t.data.dtype, t.data.nbytes, raw_dtype=t.tensor_type)
    n += 1
w.write_header_to_file(); w.write_kv_data_to_file(); w.write_ti_data_to_file()
for t in r.tensors:
    if t.name.startswith(('v.', 'mm.')):
        continue
    w.write_tensor_data(t.data)
w.close()
print('WROTE', dst, n, 'tensors')
