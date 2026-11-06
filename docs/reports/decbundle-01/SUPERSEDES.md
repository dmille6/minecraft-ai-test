# decbundle-01 supersedes three queue entries

decbundle-01 (branch `decbundle-01` @ 3690e867, built on idlework-01 817704dd) carries, unchanged, the code of:

| queue entry | branch @ tip | in the bundle as |
|---|---|---|
| depositoffer-01 | depositoffer-on-0542fcc @ 6d25266d | cherry-picks 73bf31ff, 28c794cf |
| vetoremedy-01 | vetoremedy01-on-53fd28e @ 0556ddfa | cherry-picks 2a0f6fc7, e66c2ac8, db512df5 |
| repeatwork-01 | repeatwork-on-0542fcc @ daa09c6c | cherry-picks 637ee874, 670145b9 |

plus 3690e867: the `#N` deposit-rung fix gets its own rollback (DEPOSITRUNG=0), and idlework's depositRefused asks the
gate's depositVerdict. **Cancel depositoffer-01, vetoremedy-01 and repeatwork-01** when decbundle-01 is queued (right after
idlework-01). Rollbacks, all env only: VETOREMEDY=0, REPEATWORK=0, DEPOSITOFFER=0, DEPOSITRUNG=0 (DEPOSITRUNG=0 also turns
the offer off).
