#!/usr/bin/env python3
"""learning loop round 3: LoRA adapter + HF base -> ONE GGUF (q8_0 or bf16), merged ON THE FLY (3090 VM, 10.0.0.16).

    venv/bin/python export_lora_gguf.py --base <hf snapshot> --lora <run>/lora --out <run>/cand-q8_0.gguf [--outtype q8_0]
    venv/bin/python export_lora_gguf.py --verify <out.gguf> --against <reference.gguf> [--n 24]

WHY: c2 wrote merged-16bit safetensors (18 GB for 9B) and then a bf16 GGUF (18 GB) before quantising; the 3090's disk
has ~20 GB free beside the stored models. Here the base tensors are read lazily by llama.cpp's own converter
(convert_hf_to_gguf.py, the commit in llama.cpp.sha) and every adapted weight is replaced by
    W' = W + (alpha / r) * B @ A          (fp32 arithmetic, cast back to the base dtype -- what PEFT merge_and_unload does)
BEFORE the converter's own modify_tensors (so any split/permute the converter applies to W applies to W'). Nothing
but the output file is written. Refuses when an adapter tensor has no base tensor, when the adapter uses DoRA/rsLoRA
(not implemented here), or when not every adapter pair was merged (counts printed: a silent skip is not a pass).

--verify compares tensors of two GGUFs (dequantised to fp32) on --n tensors that carry an adapter in the source and
--n that do not: the relative L2 error per tensor must stay below the quantisation noise (1e-2 for q8_0 vs bf16).
POSITIVE CONTROL (round 3): c2's adapter through this exporter vs c2's own merged bf16 GGUF (made by Unsloth's
merge + the converter); and an UNMERGED base vs that same GGUF must FAIL on the adapted tensors.
"""
import argparse, json, os, subprocess, sys


def lcpp():
    root = os.environ.get('LCPP', os.path.expanduser('~/learnloop-train/llama.cpp'))
    sys.path.insert(0, root); sys.path.insert(0, os.path.join(root, 'gguf-py'))
    return root


def base_name(k):
    """PEFT key -> the HF base tensor name, e.g. base_model.model.model.language_model.layers.0.mlp.up_proj.lora_A.weight
    -> model.language_model.layers.0.mlp.up_proj.weight"""
    n = k.replace('base_model.model.', '', 1)
    return n.replace('.lora_A.weight', '.weight').replace('.lora_B.weight', '.weight')


def load_adapter(d):
    import torch
    from safetensors.torch import load_file
    cfg = json.load(open(os.path.join(d, 'adapter_config.json')))
    if cfg.get('use_dora') or cfg.get('use_rslora') or cfg.get('rank_pattern') or cfg.get('alpha_pattern'):
        raise SystemExit('REFUSED: DoRA / rsLoRA / per-module rank or alpha are not implemented by this exporter')
    sd = load_file(os.path.join(d, 'adapter_model.safetensors'))
    pairs = {}
    for k, v in sd.items():
        if '.lora_A.' not in k and '.lora_B.' not in k:
            raise SystemExit('REFUSED: adapter tensor %s is not a LoRA A/B (embeddings or saved modules?)' % k)
        pairs.setdefault(base_name(k), {})['A' if '.lora_A.' in k else 'B'] = v
    bad = [n for n, p in pairs.items() if set(p) != {'A', 'B'}]
    if bad:
        raise SystemExit('REFUSED: %d adapter pairs incomplete, e.g. %s' % (len(bad), bad[:3]))
    scale = float(cfg['lora_alpha']) / float(cfg['r'])
    return pairs, scale, cfg


def delta(p, scale):
    import torch
    return scale * (p['B'].to(torch.float32) @ p['A'].to(torch.float32))


def export(a):
    root = lcpp()
    import torch
    pairs, scale, cfg = load_adapter(a.lora)
    print('adapter: %d pairs, r %s alpha %s scale %.3f' % (len(pairs), cfg['r'], cfg['lora_alpha'], scale), flush=True)
    sys.argv = ['convert_hf_to_gguf.py', a.base, '--outtype', a.outtype, '--outfile', a.out]
    import convert_hf_to_gguf as C
    from conversion import ModelBase, LazyTorchTensor
    orig = ModelBase.index_tensors
    merged = {'n': 0, 'names': set()}

    def index_tensors(self, *args, **kw):
        t = orig(self, *args, **kw)
        # the converter renames through filter_tensors (e.g. drops 'language_model.'); map adapter names the same way
        want = {}
        for n, p in pairs.items():
            r = type(self).filter_tensors((n, None))
            want[r[0] if r else n] = (n, p)
        missing = [n for n in want if n not in t]
        if missing:
            raise SystemExit('REFUSED: %d adapter targets have no base tensor, e.g. %s' % (len(missing), missing[:3]))
        for tn, (n, p) in want.items():
            g = t[tn]

            def gen(g=g, p=p, tn=tn):
                w = g()
                shp = (p['B'].shape[0], p['A'].shape[1])
                if tuple(shp) != tuple(w.shape):
                    raise SystemExit('REFUSED: delta %s != base %s for %s' % (tuple(shp), tuple(w.shape), tn))
                merged['n'] += 1; merged['names'].add(tn)
                if isinstance(w, LazyTorchTensor):
                    # LAZY delta (OOM 11-01: eager fp32 deltas for every adapted tensor were held until the write,
                    # ~50 GB for 9B): only the small A/B factors stay in memory; B @ A runs when the tensor is written
                    A = LazyTorchTensor.from_eager(p['A']); B = LazyTorchTensor.from_eager(p['B'])
                    return (w.to(torch.float32) + (B.to(torch.float32) @ A.to(torch.float32)) * scale).to(w.dtype)
                return (w.to(torch.float32) + delta(p, scale)).to(w.dtype)
            t[tn] = gen
        return t
    ModelBase.index_tensors = index_tensors
    C.main()
    if len(merged['names']) != len(pairs):
        os.replace(a.out, a.out + '.INCOMPLETE')
        raise SystemExit('REFUSED: merged %d of %d adapter pairs (output renamed .INCOMPLETE)' % (len(merged['names']), len(pairs)))
    print('MERGED %d of %d adapter pairs into %s (%s)' % (len(merged['names']), len(pairs), a.out, a.outtype))
    json.dump({'base': a.base, 'lora': a.lora, 'outtype': a.outtype, 'pairs': len(pairs), 'merged': len(merged['names']),
               'scale': scale, 'llama_cpp': subprocess.run(['git', '-C', root, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip() or None},
              open(a.out + '.export.json', 'w'), indent=1)


def verify(a):
    lcpp()
    import numpy as np
    from gguf import GGUFReader
    from gguf.quants import dequantize
    x, y = GGUFReader(a.verify), GGUFReader(a.against)
    tx = {t.name: t for t in x.tensors}; ty = {t.name: t for t in y.tensors}
    common = sorted(set(tx) & set(ty))
    if not common:
        raise SystemExit('REFUSED: no common tensor names')
    lora_like = [n for n in common if any(s in n for s in ('attn_q', 'attn_k', 'attn_v', 'attn_output', 'ffn_up', 'ffn_down', 'ffn_gate', 'attn_qkv', 'attn_gate', 'ssm_out')) and n.endswith('.weight')]
    other = [n for n in common if n not in set(lora_like) and n.endswith('.weight')]
    import random
    rng = random.Random(1101)
    pick = rng.sample(lora_like, min(a.n, len(lora_like))) + rng.sample(other, min(a.n, len(other)))
    out, worst, cos = [], 0.0, []
    tb = {t.name: t for t in GGUFReader(a.base_gguf).tensors} if a.base_gguf else None
    for n in pick:
        u = dequantize(tx[n].data, tx[n].tensor_type).astype(np.float32).ravel()
        v = dequantize(ty[n].data, ty[n].tensor_type).astype(np.float32).ravel()
        if u.shape != v.shape:
            out.append({'tensor': n, 'shape_mismatch': [list(u.shape), list(v.shape)]}); worst = float('inf'); continue
        rel = float(np.linalg.norm(u - v) / max(np.linalg.norm(v), 1e-12))
        worst = max(worst, rel)
        row = {'tensor': n, 'adapted_kind': n in lora_like, 'rel_l2': round(rel, 6)}
        if tb is not None and n in lora_like and n in tb:
            # the TRAINING DELTA: (a - base) vs (b - base). Weight-space error alone cannot tell a merged model from
            # the unmerged base (the LoRA delta is ~1% of W, q8_0 noise ~0.5%); the delta direction can.
            w = dequantize(tb[n].data, tb[n].tensor_type).astype(np.float32).ravel()
            d1, d2 = u - w, v - w
            row['delta_cos'] = round(float(d1 @ d2 / max(np.linalg.norm(d1) * np.linalg.norm(d2), 1e-12)), 4)
            cos.append(row['delta_cos'])
        out.append(row)
    res = {'a': a.verify, 'b': a.against, 'tensors_compared': len(pick), 'common': len(common),
           'only_a': len(set(tx) - set(ty)), 'only_b': len(set(ty) - set(tx)), 'worst_rel_l2': worst,
           'tolerance': a.tol, 'delta_cos_min': min(cos) if cos else None, 'delta_cos_floor': a.cos_floor,
           'pass': worst <= a.tol and len(tx) == len(ty) and (tb is None or (bool(cos) and min(cos) >= a.cos_floor)),
           'detail': out}
    print(json.dumps(res, indent=1))
    sys.exit(0 if res['pass'] else 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base'); ap.add_argument('--lora'); ap.add_argument('--out'); ap.add_argument('--outtype', default='q8_0', choices=('q8_0', 'bf16', 'f16'))
    ap.add_argument('--verify'); ap.add_argument('--against'); ap.add_argument('--n', type=int, default=24); ap.add_argument('--tol', type=float, default=1e-2)
    ap.add_argument('--base-gguf', default=None, help='the untuned base GGUF: also require the training delta to point the same way')
    ap.add_argument('--cos-floor', type=float, default=0.5)
    a = ap.parse_args()
    if a.verify:
        return verify(a)
    if not (a.base and a.lora and a.out):
        ap.error('--base, --lora and --out are required')
    if os.path.exists(a.out):
        raise SystemExit('REFUSED: %s exists' % a.out)
    return export(a)


if __name__ == '__main__':
    main()
