// SANDRUNG-01 (wasted attempts, 2026-11-07; docs/reports/wasted-attempts-2026-11-07.md): the gatherer chain's sand rung is
// RETIRED by default. One switch, read by milestones.mjs (the chain) and towndeposit.mjs (the 8 sand the town deposit keeps
// for the rung), so the two cannot disagree. Its own file because towndeposit cannot import milestones (milestones imports it).
//
// MEASURED (fleet .31, 80 bots, 24 h to 11-07 13:25Z, 1,920 bot-h; 211,218 decision rows, 155,944 skill runs):
//   - "Collect 8 sand. Found near water." was the TASK of 15,493 decisions (7.3% of all), on all 80 bots, 483 episodes:
//     140.5 bot-h on the rung (7.5% of fleet time), 78.4 bot-h of it in failed or vetoed decisions -- the highest failing
//     share of any rung;
//   - its HINT ("gather with block=sand") wrote 4,086 of the 4,281 `gather sand` proposals; 4,758 sand gathers ran at
//     11.7% success (3,132 no_safe_target: "all N candidates are beside water or under falling blocks" -- sand is a falling
//     block that lies on beaches), 36.1 bot-h failing; 23.5 bot-h of it the same bot failing the same way within 16 blocks
//     and 10 minutes of its last try;
//   - the sand it does get does not reach a town: 11 of 16 town indexes hold 0 sand (max 126), glass 0-2. The rung re-opens
//     on the next lap (16 of 20 persisted slots show 50+ completions of gather_sand_8).
// Builds that need glass keep their own sand demand (mats.mjs glass inputs, stocktarget.mjs sand 64): nothing that USES sand
// reads this rung. The chain keeps dirt -> wood -> cobblestone; a bot that would have hunted sand takes the next rung.
//
// Rollback: SANDRUNG=1 restores the four-rung chain and the 8 held sand exactly.
export const sandRungOn = (env = process.env) => String(env?.SANDRUNG ?? '0').trim() === '1'
