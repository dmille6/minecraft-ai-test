# banktruth-01 could not deploy: the reader interlock is blind to a loop started via its shebang (23 Sep, read-only)

**The pipeline is blocked and the fleet is fine.** Two deploy attempts were refused, nothing is half-deployed, and
no canary is declared. 80 bots up on `9b572aa`, manifest clean. This is a guard misfiring, not damage.

## What happened

```
12:01:52  banktruth-01  preflight-ok   positive control: 226474 rows, 80 bots, 118 distinct row kinds
12:03:45  banktruth-01  drawn          placebo-d,hive-b,hive-c,board-c
12:03:46  banktruth-01  ERROR          deploy launch failed
12:05:07  banktruth-01  preflight-ok   (second invocation)
12:06:45  banktruth-01  ERROR          deploy launch failed
```

`~/digest/deploy-banktruth-01.log`:

```
REFUSED: --pool declares a canary and NOTHING WOULD READ IT.
  no canary-loop.sh process, and ~/MANUAL-READS-UNTIL is missing or expired.
```

**A loop was demonstrably alive** -- it wrote those journal rows itself, one second before the refusal. So the
interlock refused a canary that its own caller was about to read.

## Why: the anchor requires the command line to begin with the literal `bash `

`~/bin/fleet-deploy:30`

```bash
_loop=$(pgrep -f '^bash /home/mike/canary-loop.sh' | head -1 || true)
```

That anchor exists for a good reason, recorded in the file's own header: an unanchored `pgrep -f canary-loop`
SELF-MATCHES, and that hid a broken check for four days. But it now admits only one of the two normal ways to start
the script. Measured on the host today, with the test run from a file so the pattern is not in the calling command
line:

| launch form | `/proc/<pid>/cmdline` | anchor |
|---|---|---|
| `bash ~/canary-loop.sh <run>` | `bash /home/mike/canary-loop.sh <run>` | **MATCHES** -> allowed |
| `~/canary-loop.sh <run>` (shebang) | `/bin/bash /home/mike/canary-loop.sh <run>` | **MISSES** -> refused |

A shebang exec makes the kernel record the interpreter's **absolute** path, so the line starts `/bin/bash`, and
`^bash` cannot match it. Same script, same process, same behaviour; only the launch form differs.

## Immediate unblock, no code change

Start the loop in the form the anchor recognises:

```bash
bash ~/canary-loop.sh banktruth-01
```

**Do NOT use `~/MANUAL-READS-UNTIL` for this.** That hatch asserts a human will read the canary manually. Writing a
future stamp to silence a guard that is wrong for a different reason would be lying to the interlock, and the next
canary would ship genuinely unread.

## The durable fix, which I have deliberately not applied

Two candidates, in order of preference:

1. **A pidfile.** The loop writes its pid at startup; the interlock checks that pid is alive and that its
   `/proc/<pid>/cmdline` mentions `canary-loop.sh`. This removes the dependence on argv formatting entirely, and it
   cannot self-match because the check never scans for its own pattern.
2. **Tolerate an interpreter path**, e.g. anchoring on `^(/[^ ]*/)?bash /home/mike/canary-loop\.sh`.

I did not edit `fleet-deploy` myself, and the reason is the failure mode rather than the diff: a slightly wrong
anchor either blocks every deploy, or -- much worse -- starts matching the checking process itself and makes the
interlock **vacuously true**, at which point unmonitored canaries ship and nothing complains. That is exactly the
harm this guard exists to prevent, so the change belongs with the person who owns the guard.

## Second-order: the same blind spot is in the watchdog

`~/canarywatch.py:31` holds the identical `ANCHOR = "^bash /home/mike/canary-loop.sh"` and uses it for the
`ORPHANED: canary ... is live and NO canary-loop process is ...` alarm. A shebang-launched loop would therefore be
reported as orphaned while it is in fact reading normally. Whatever fix lands, both call sites need it, and the
docstring at `canarywatch.py:18` already says the anchor is shared -- so fixing one and not the other would leave
them disagreeing again, which is the drift that produced this class of bug in the first place.

## Footnote, for the next person writing a process check

My first attempt to measure this ran the pattern inline over ssh. The ssh command line contained the pattern, so
`pgrep -f` matched my own shell and `pkill -f` killed the session. The trap the interlock was written to avoid caught
the person diagnosing the interlock. Run process-matching tests from a file.
