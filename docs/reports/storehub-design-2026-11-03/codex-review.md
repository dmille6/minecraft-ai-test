# Codex review of the reconciled design (codex exec, read-only, one round, blockers only, 2026-11-03 ~21:10Z)

Reviewed draft: the first version of storehub-design-2026-11-03.md. Disposition of each blocker: the main doc §10.

VERDICT: BLOCK

1. **Tier-3 intake is scheduled through a showcase-first rollout.**  
   **Where:** §6 classifies D as tier 3; §7 releases D on the showcase and delays its fleet canary until after a 72-hour showcase read. Fun mode requires a fleet canary for tier 3; Paper proof and two reviews do not replace it.  
   **Fix:** Keep A/B/C/E on their eligible tier-2 paths. Schedule D’s tier-3 fleet canary after S0 and required reviews, before its showcase rollout. Remove the dependency that makes this canary wait for D’s showcase acceptance.

2. **The toss path permits item loss without recovery.**  
   **Where:** §3.2’s receipt check and §6 SH2. Entity removal near a hopper does not establish receipt: the feasibility report explicitly identifies item merging, which can remove an entity while its contents remain on the ground. Moreover, an actual missed toss is merely logged after 45 seconds; SH2 can wait another 240 seconds and tolerates losses below 64 items. Nothing retrieves the missed stack before despawn.  
   **Fix:** Require positive inventory receipt accounting that handles merging and concurrent withdrawals. Treat disappearance alone as unresolved. Recover unreceived items within a bounded deadline comfortably below despawn, and suspend further tosses until recovery or receipt is confirmed. Include these failure cases in S0.

3. **The proposed cargo guarantee cannot be met by the cited transfer primitive.**  
   **Where:** §3.3 steps 3–5, including “delivers every stack, or puts it back” and “never ends a visit holding intake cargo.” In `skills.mjs::sortPut`, withdrawals can merge with personal partial stacks, but deposits move only whole stacks while preserving the pre-withdrawal floor. For example, withdrawing 10 into a personal stack of 20 produces 30; `sortPut` cannot deliver or return the entrusted 10. A cargo record alone cannot fix this, and another clerk cannot deliver items still in the previous holder’s inventory.  
   **Fix:** Specify a verified partial-stack transfer mechanism or prevent cargo from merging with personal inventory. Persist cargo ownership and transfer intent before mutation; retain cargo protection across interruption/restart and require recovery by the actual holder before ordinary inventory handling resumes.

4. **Queue alternation is conditional where it must be mandatory.**  
   **Where:** §7’s F placement follows groundskeeper-01 (P), inserting S only “if an S entry is queued by then.” The listed tail already contains consecutive P entries. That wording allows another P after P when no S is available.  
   **Fix:** Make F wait for the next valid P turn after an intervening S, with the existing queue’s alternation reconciled first. An absent S means waiting, not permission for consecutive P entries.

Non-blocking note: No files were edited; no tests, servers, or SSH were run.