import { MilestoneController } from '../src/milestones.mjs'
import { SUSTAINING } from '../src/milestones.mjs'

let pass=0, fail=0
const t=(n,g,w)=>{const ok=g===w;ok?pass++:fail++;console.log(`  ${ok?'PASS':'FAIL'}  ${n}${ok?'':`  (got ${g}, want ${w})`}`)}

// a bot holding exactly what Miner01 holds right now
const inv = { oak_planks: 4, stick: 40, oak_log: 2 }
const bot = {
  entity: { position: { x:28, y:79, z:0, distanceTo: () => 3 } },
  inventory: { items: () => Object.entries(inv).map(([name,count]) => ({ name, count })) },
}
const mkLessons = (progress) => ({
  getProgress: () => progress,
  setProgress: (a,s,sa,sc) => { progress.attempts=a; progress.skipped=s; progress.skippedAt=sa; progress.skipCount=sc },
  save(){},
})

console.log('the sustaining loop is reachable')
const c0 = new MilestoneController(bot, 'miner', mkLessons({attempts:{},skipped:[],skippedAt:{},skipCount:{}}))
t('chain includes sustaining goals', c0.chain.length > 7, true)
t('and ends with a repeating one', SUSTAINING.some(m => m.id === c0.chain[c0.chain.length-1].id), true)

console.log('\na fresh give-up still stands')
const recent = { attempts:{}, skipped:['craft_wooden_pickaxe_1'],
                 skippedAt:{craft_wooden_pickaxe_1: Date.now()}, skipCount:{craft_wooden_pickaxe_1:1} }
const c1 = new MilestoneController(bot, 'miner', mkLessons(recent))
c1.refresh()
t('not retried immediately', recent.skipped.includes('craft_wooden_pickaxe_1'), true)

console.log('\nan old give-up expires and the goal comes back')
const old = { attempts:{}, skipped:['craft_wooden_pickaxe_1'],
              skippedAt:{craft_wooden_pickaxe_1: Date.now() - 3*60*60*1000}, skipCount:{craft_wooden_pickaxe_1:1} }
const c2 = new MilestoneController(bot, 'miner', mkLessons(old))
c2.refresh()
t('give-up cleared after cooldown', old.skipped.includes('craft_wooden_pickaxe_1'), false)

console.log('\nMiner01 today: every goal skipped, chain exhausted, holds the materials')
const dead = { attempts:{},
  skipped:['gather_oak_log_8','craft_oak_planks_16','craft_stick_8','craft_crafting_table_1',
           'craft_wooden_pickaxe_1','gather_cobblestone_12','craft_stone_pickaxe_1'],
  skippedAt:{}, skipCount:{} }   // no timestamps = pre-fix records
const c3 = new MilestoneController(bot, 'miner', mkLessons(dead))
c3.refresh()
const cur = c3.current()
console.log(`    current milestone -> ${cur ? cur.id : 'NULL (still idle)'}`)
t('the bot has a goal again', cur !== null, true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail?1:0)
