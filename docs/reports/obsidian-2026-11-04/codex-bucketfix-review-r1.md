**One blocker: the fix activates an unsafe self-flooding pour path.**

In [bucketSkill](/Users/darrellmiller/Documents/.wt-bucketfix/bots/src/skills.mjs:20998), the first candidate is directly above the bot’s feet—its head cell. [emptyRefusal](/Users/darrellmiller/Documents/.wt-bucketfix/bots/src/bucket.mjs:255) excludes only the feet cell. Beside a solid wall, the ray can hit that wall and place water into the occupied head cell, flooding the bot’s pocket or shaft. There is no containment or drainage check. Additionally, the skill replaces the target’s integer block position with fractional entity coordinates, so even the feet-cell equality guard usually fails.

I reproduced both admission failures using the actual extracted `bucketSkill` and guard, with the pour stubbed. This verifies unsafe target selection, not a live-server drowning. The previously failing `lookAt` prevented this path from using the bucket; this commit enables it. Block deployment until occupied-cell protection and safe pour targeting are enforced.

Caller audit:

- **`bucketSkill`, fill** ([line 21031](/Users/darrellmiller/Documents/.wt-bucketfix/bots/src/skills.mjs:21031)): passes `bot.entity.position.offset(...)`, a Vec3. Requires an empty bucket, reachable water source, fewer than two horizontal source neighbours, no water/lava above, and protected-zone clearance. `scoopLiquid` repeats its liquid/reach guards.
- **`bucketSkill`, pour** ([line 21049](/Users/darrellmiller/Documents/.wt-bucketfix/bots/src/skills.mjs:21049)): also passes a Vec3. Requires a water bucket, reachable replaceable cell, no existing source/lava, and protected-zone clearance. Its occupied-cell guard has the blocker above.
- **Reflexes/escapes:** no scoop/pour callers. `scoopWouldHelp` only observes and logs. No autonomous bucket rescue becomes active. Both primitives limit retries to three aims.

No plain-position production caller exists. `aimPoint` alone preserves a plain aim for a plain position; `scoopLiquid` would already fail earlier at `pos.offset`. That remains unchanged.

The three new test assertions passed with mutant creation/import redirected entirely into memory to preserve read-only operation. They prove Vec3 conversion, successful mocked pour/scoop, and failure of the unconverted **pour** mutant. They do not prove server ray targeting, fluid safety, or production caller coordinates; the fake changes water regardless of aim. The mutant returns a caught failure rather than throwing outward.

Reviewed `771b18ae`, whose parent is the specified `3a7badea`. No files changed.

VERDICT: BLOCK (1)
done
Resolved: `88c981a1` floors candidate coordinates and rejects both feet and head cells, closing the reported fractional-coordinate bypass.

No new blocker found in this fix.

Body-guard and coordinate tests passed. Two mutation tests were blocked by the read-only sandbox; no files changed. No live-world validation performed.

VERDICT: PASS — round-1 blocker resolved; no new blocker found.
done
