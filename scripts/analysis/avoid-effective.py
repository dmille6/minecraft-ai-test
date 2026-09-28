# BOTH ENGINES SAID THE TELEMETRY CANNOT SEE THE NUMBER THE GATE READS. Test that.
# admission.mjs:673 interpolates `priorFails` into the rejection detail, and priorFails IS
# failCount() == #effective (decayed). The `cited=` field carries entryFor().fails, the
# STORED count. If both appear and differ, the effective count is already exported and no
# code change is needed to answer the question.
import re, subprocess, collections, statistics, sys
UNITS = [u for u in subprocess.run(["systemctl","list-units","mcbot@*","--no-legend","--plain"],
        capture_output=True,text=True).stdout.split() if u.startswith("mcbot@") and u.endswith(".service")]
EFF = re.compile(r"has failed (\d+)x across runs")
STO = re.compile(r"fails=(\d+)")
KEY = re.compile(r"cited=([a-z_]+:\{[^}]*\})")
pairs = []; n_la = 0; n_lines = 0
for u in UNITS[:40]:
    out = subprocess.run(["sudo","journalctl","-u",u,"--since","-360min","--no-pager"],
                         capture_output=True,text=True).stdout
    for line in out.splitlines():
        if "decision rejected" not in line: continue
        n_lines += 1
        if "why=learned_avoid" not in line: continue
        n_la += 1
        e = EFF.search(line); s = STO.search(line); k = KEY.search(line)
        if e and s: pairs.append((int(e.group(1)), int(s.group(1)), k.group(1) if k else "?"))
print("POSITIVE CONTROL: %d units sampled, %d veto lines, %d learned_avoid, %d with BOTH numbers"
      % (len(UNITS[:40]), n_lines, n_la, len(pairs)))
if not pairs:
    print("  NO PAIRS -- the effective count is NOT exported; both engines were right."); sys.exit(0)
eq = sum(1 for e,s,_ in pairs if e == s)
print("  effective == stored in %d of %d (%.1f%%); they DIFFER in %d"
      % (eq, len(pairs), 100.0*eq/len(pairs), len(pairs)-eq))
diffs = [s-e for e,s,_ in pairs]
diffs.sort()
print("  stored MINUS effective (the wall-clock forgiveness already applied):")
print("    min %d  p25 %d  median %d  p75 %d  max %d  mean %.1f"
      % (diffs[0], diffs[len(diffs)//4], diffs[len(diffs)//2], diffs[3*len(diffs)//4], diffs[-1],
         statistics.mean(diffs)))
effs = sorted(e for e,_,_ in pairs)
print("  EFFECTIVE fails at the moment of the veto (this is the number the gate acted on):")
print("    min %d  p25 %d  median %d  p75 %d  p95 %d  max %d"
      % (effs[0], effs[len(effs)//4], effs[len(effs)//2], effs[3*len(effs)//4], effs[int(.95*len(effs))], effs[-1]))
print("    share with effective exactly 4 (right at the threshold): %.1f%%"
      % (100.0*sum(1 for e in effs if e == 4)/len(effs)))
print("    share with effective >= 20: %.1f%%   >= 100: %.1f%%"
      % (100.0*sum(1 for e in effs if e >= 20)/len(effs), 100.0*sum(1 for e in effs if e >= 100)/len(effs)))
c = collections.Counter(k for _,_,k in pairs)
print("  most-vetoed keys (by learned_avoid lines):")
for k,v in c.most_common(8): print("    %5d  %s" % (v, k[:72]))
