// sysprompt.mjs <bots-dir> -- rebuild the fleet's SYSTEM prompt template at one code version (learning loop M1).
//
// The llm rows carry only prompt.system_hash; training needs the text. This imports the version's own prompt
// builder, schema and hash function (the /tmp/brain01-sysprompt.mjs recipe that rebuilt 3 of 3 hashes of 10-20 from
// both live versions, design s.1.1) and prints {hash: {scope, template, skills, schema}}. The hash is
// logger.mjs:promptTemplateHash -- the bot name and role are replaced by <BOT>/<ROLE> before hashing, so the template
// does not depend on which bot it is rebuilt for. MEMORY_SCOPE comes from the environment (the caller loops over the
// fleet's scopes). Read-only: logs go to a private temp dir, nothing connects anywhere.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/learnloop-sp-logs'
process.env.LOG_LEVEL = 'error'
const base = process.argv[2]
const { config } = await import(base + '/src/config.mjs')
const { SKILLS } = await import(base + '/src/skills.mjs')
const { buildSystemPrompt } = await import(base + '/src/prompt.mjs')
const { promptTemplateHash } = await import(base + '/src/logger.mjs')
const { skillSchema } = await import(base + '/src/llm.mjs')
const HAS_BOARD = config.memory.scope === 'board' || config.memory.scope === 'checkpoint'
const names = Object.keys(SKILLS).filter(n => !SKILLS[n].chatOnly).filter(n => n !== 'board' || HAS_BOARD)
const sp = buildSystemPrompt(names)
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
let tpl = sp.replace(new RegExp(esc(config.bot.name), 'g'), '<BOT>')
if (config.bot.role) tpl = tpl.replace(new RegExp(esc(config.bot.role), 'g'), '<ROLE>')
console.log(JSON.stringify({ [promptTemplateHash(sp)]: { scope: config.memory.scope, template: tpl, skills: names, schema: skillSchema(names) } }))
process.exit(0)
