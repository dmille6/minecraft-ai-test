"""python3 infra/brain/test_brainproxy.py -- the proxy's two decisions, pure."""
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location('bp', os.path.join(os.path.dirname(__file__), 'brainproxy.py'))
bp = importlib.util.module_from_spec(spec); spec.loader.exec_module(bp)
fails = 0
def check(name, cond):
    global fails
    print(('PASS ' if cond else 'FAIL ') + name); fails += 0 if cond else 1
b = bp.translate({'messages': [{'role': 'user', 'content': 'x'}], 'format': {'type': 'object'}, 'options': {'temperature': 0.7, 'num_predict': 512}})
check('the schema becomes a strict json_schema response_format', b['response_format']['json_schema']['strict'] is True and b['response_format']['json_schema']['schema'] == {'type': 'object'})
check('no think in the request -> no chat_template_kwargs', 'chat_template_kwargs' not in b)
check('think false -> enable_thinking false', bp.translate({'think': False})['chat_template_kwargs'] == {'enable_thinking': False})
check('think "low" (not a boolean) is not translated', 'chat_template_kwargs' not in bp.translate({'think': 'low'}))
check('num_predict -> max_tokens', b['max_tokens'] == 512)
check('served by the loaded identifier -> the pinned name', bp.served_name('brain', 'brain', 'gemma4:26b') == 'gemma4:26b')
check('served by anything else -> lmstudio:<it> (the bot will flag a mismatch)', bp.served_name('qwen3-4b', 'brain', 'gemma4:26b') == 'lmstudio:qwen3-4b')
sys.exit(1 if fails else 0)
