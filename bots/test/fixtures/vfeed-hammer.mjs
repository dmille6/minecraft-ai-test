// child for villagefeed.test.mjs: N read-modify-writes of the town file through skills.mjs vfUpdate (each adds one toss)
const n = +(process.argv[2] || 40)
const SK = await import('../../src/skills.mjs')
let ok = 0
for (let i = 0; i < n; i++) if (SK._feedTest.vfUpdate(s => ({ ...s, tosses: [...s.tosses, { at: Date.now(), n: 1 }] }))) ok++
console.log(`OK ${ok}`)
process.exit(0)
