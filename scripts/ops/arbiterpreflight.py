#!/usr/bin/env python3
"""Pre-flight for any ARBITER=1 canary. Run it on the CANARY TREE before declaring.

owner-01 shipped INERT (OWNER never reached the process). owner-01b died on the
apparatus. Attempt three is queued, and there is a third way to fail sitting in the
deployed baseline right now:

  bots/src/index.mjs:259 calls  runner.arb.installActuatorGate(bot, {...})
  guarded only by            if (config.reflex.arbiter && runner?.arb)

`runner.arb` always exists -- runner.mjs constructs an Arbiter unconditionally --
but **installActuatorGate does not exist in cfc1c58's arbiter.mjs** (115 lines;
it exports PRIORITY, ACK_MS, StaleGrant, Arbiter, mayPreempt and nothing else).
The method lives only on movement-owner-1/-1f. The call has no try/catch and sits
BEFORE `new Movements(bot)`, so with ARBITER=1 on a tree lacking it, bot setup
throws a TypeError part-way and the movement profiles are never installed.

That failure is silent in exactly the way this project keeps getting caught by: the
deploy verifies, the flag is present in /proc/<pid>/environ, and the canary is not
doing what its name says.

So this asserts the two things the env check cannot:
  1. the METHOD the entrypoint calls actually exists in this tree's arbiter.mjs
  2. GATED_SYNC still lists the actuators the canary claims to gate

Usage:  arbiterpreflight.py [path-to-worktree]      (default: cwd)
Exit 0 = safe to declare an ARBITER canary from this tree. Exit 2 = do not.
"""
import sys, os, re

root = sys.argv[1] if len(sys.argv) > 1 else '.'
src = os.path.join(root, 'bots', 'src')
fails, notes = [], []


def read(name):
    p = os.path.join(src, name)
    if not os.path.exists(p):
        fails.append('%s is missing from %s' % (name, src))
        return ''
    return open(p).read()


index, arbiter, runner = read('index.mjs'), read('arbiter.mjs'), read('runner.mjs')
if not index or not arbiter:
    for f in fails:
        print('FAIL:', f)
    raise SystemExit(2)

strip = lambda t: re.sub(r'/\*[\s\S]*?\*/', '', re.sub(r'^\s*//.*$', '', t, flags=re.M))
index_x, arbiter_x = strip(index), strip(arbiter)

# 1. every runner.arb.<method>() the entrypoint calls must exist on the class
called = set(re.findall(r'runner\??\.arb\??\.(\w+)\s*\(', index_x))
defined = set(re.findall(r'^\s{2,}(?:static\s+)?(?:async\s+)?(\w+)\s*\(', arbiter_x, re.M))
print('entrypoint calls on runner.arb : %s' % (sorted(called) or 'none'))
print('methods defined in arbiter.mjs : %s' % sorted(defined))
missing = sorted(called - defined)
if missing:
    fails.append('index.mjs calls runner.arb.%s() but arbiter.mjs does not define it. '
                 'With ARBITER=1 this is a TypeError during bot setup, BEFORE the '
                 'movement profiles are installed, and the canary ships broken rather '
                 'than inert.' % ', '.join(missing))
else:
    notes.append('every runner.arb method the entrypoint calls exists in this tree')

# 2. the guard at the call site should test the METHOD, not just the object
m = re.search(r'if\s*\(\s*config\.reflex\.arbiter\s*&&\s*([^)]*)\)', index_x)
if m:
    guard = m.group(1).strip()
    if 'installActuatorGate' not in guard:
        notes.append('the call site guards on `%s`, which is true whenever an Arbiter '
                     'exists -- it does not test that the METHOD does. That is why the '
                     'missing method is a crash rather than a skip.' % guard)

# 3. GATED_SYNC must still cover the actuators an ownership canary claims
g = re.search(r'GATED_SYNC\s*=\s*\[([^\]]*)\]', arbiter_x)
if g:
    gated = set(re.findall(r"'([^']+)'", g.group(1)))
    print('GATED_SYNC                     : %s' % sorted(gated))
    want = {'setControlState', 'clearControlStates', 'stopDigging'}
    if not want <= gated:
        fails.append('GATED_SYNC is missing %s -- an ownership canary that claims to '
                     'gate them would not.' % sorted(want - gated))
    else:
        notes.append('GATED_SYNC covers setControlState, clearControlStates and stopDigging')
elif 'installActuatorGate' in arbiter_x:
    notes.append('installActuatorGate exists but GATED_SYNC was not found by this pattern; '
                 'check it by hand rather than trusting this line')

print()
for n in notes:
    print('  ok   %s' % n)
for f in fails:
    print('  FAIL %s' % f)
print()
if fails:
    print('DO NOT declare an ARBITER canary from this tree.')
    print('Also assert on the LIVE process after deploy: ARBITER=1 in /proc/<pid>/environ '
          'is necessary and NOT sufficient -- the gate must actually be installed.')
    raise SystemExit(2)
print('Safe to declare an ARBITER canary from this tree, as far as static wiring goes.')
print('Still verify on the live process: ARBITER=1 in /proc/<pid>/environ AND evidence '
      'the gate is active (arbiter_actuator_refused rows, or bot.dig wrapped).')
