/**
 * 模块化知识库：把工作目录整理成 AI 的「大脑」。
 *
 * 目录约定（稳定编号，便于检索与排序）：
 *   00_知识库.md        总索引：模块清单、当前状态、AI 的读取顺序
 *   01_剧情/            分卷与章目 + 每章一个文件（概述/节点/关系刻度/对白）
 *   02_角色_他/         AI 扮演的角色人设
 *   03_角色_我/         用户扮演的角色人设
 *   04_事件/            事件簿：一件一件，带轮次
 *   05_时间线/          时间线与当前这一幕
 *   06_特殊事件/        绑架、ICU、领证、交换这类节点
 *   07_其他人物/        配角的剧情与设定
 *   08_特殊物品/        戒指、手表、材料这类有分量的东西
 *   09_生活物品/        日常物件与生活细节
 *   10_规则/            用户上传的写法与输出要求
 *   11_记忆卡/          滚动记忆（每 20—30 轮一张）
 *   设定/               用户上传的原始人设与补充（保留兼容）
 *   记忆/               旧版记忆卡目录（只读兼容）
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { readTurns } from './state.js'
import { buildEmotion, buildSources, buildThreads, buildVoice } from './enrich.js'
import { buildScenes } from './scenes.js'
import { buildDigest, listCards, saveCard } from './memory.js'

export const KB_INDEX = '00_知识库.md'

export const MODULES = [
  { key: 'plot', dir: '01_剧情', label: '剧情', hint: '分卷、章目、每章概述与情节节点；写之前先看最近的章' },
  { key: 'hero', dir: '02_角色_他', label: '角色·他', hint: '他扮演的这个人：身份、脾气、说话方式、禁忌' },
  { key: 'girl', dir: '03_角色_我', label: '角色·我', hint: '用户演的这个人：身份、性子、身体、称呼' },
  { key: 'events', dir: '04_事件', label: '事件簿', hint: '发生过的事，一条一条带轮次' },
  { key: 'timeline', dir: '05_时间线', label: '时间线', hint: '现在是什么时候、在哪儿、接下来要办什么' },
  { key: 'milestones', dir: '06_特殊事件', label: '特殊事件', hint: '大节点：葬礼、绑架、ICU、领证、远行' },
  { key: 'others', dir: '07_其他人物', label: '其他人物', hint: '配角与他们的来历、和两人的关系' },
  { key: 'special', dir: '08_特殊物品', label: '特殊物品', hint: '戒指、手表、信件、材料这类有分量的物件' },
  { key: 'life', dir: '09_生活物品', label: '生活物品', hint: '家里的东西、吃穿用度、习惯性细节' },
  { key: 'rules', dir: '10_规则', label: '规则', hint: '用户上传的写法与输出要求，最高优先级' },
  { key: 'cards', dir: '11_记忆卡', label: '记忆卡', hint: '滚动记忆：每 20—30 轮一张，写这一段发生了什么' },
  { key: 'emotion', dir: '12_情感', label: '情感', hint: '他怎么动心、怎么克制：要求 + 原句样本 + 好感度曲线' },
  { key: 'threads', dir: '13_伏笔', label: '伏笔', hint: '还没落地的事：没办完的、没说开的、还没送出去的' },
  { key: 'voice', dir: '14_语感', label: '语感', hint: '按场景分类的原句，写之前挑两句找语气' },
  { key: 'sources', dir: '15_来源', label: '来源', hint: '每份设定的来历与版本；改设定前先看这里' },
  { key: 'world', dir: '16_世界观', label: '世界观', hint: '时代、地方、规矩、阶层、钱与身份；人物为什么只能这样活' },
  { key: 'scene', dir: '17_场景', label: '场景', hint: '住处、医院、公司这些地方长什么样：布局、光线、家具、常出现的人' },
]

export function moduleByKey(key) {
  return MODULES.find((item) => item.key === key) ?? null
}

function root(outDir) {
  return resolve(String(outDir ?? '.'))
}

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

function writeIfMissing(path, content) {
  if (existsSync(path)) return false
  writeFileSync(path, content, 'utf8')
  return true
}

function md(text) {
  return `${String(text ?? '').trimEnd()}\n`
}

const SKELETONS = {
  scene: '# 场景\n\n> 一个地方一份文件：布局、光线、家具、气味、常出现的人。写那场戏之前先看对应的一份。\n',
  plot: '# 剧情\n\n> 每章一个文件：`第NN章_标题.md`，开头一行写轮次区间，下面写概述、情节节点、关系刻度、关键对白。\n> 分卷目录在 `00_分卷与章目.md`。\n',
  hero: '# 角色·他\n\n> 他扮演的这个人。写清楚：身份、年龄、说话方式、习惯动作、忌讳、对「我」的态度。\n',
  girl: '# 角色·我\n\n> 用户扮演的这个人。写清楚：身份、年龄、性子、身体、称呼、怕什么、想要什么。\n',
  events: '# 事件簿\n\n> 一件一件往下记，格式：`- （第N轮）发生了什么。`\n',
  timeline: '# 时间线\n\n> 按时间往下记节点，格式：`- 第N轮｜时间地点｜一句话。`\n> 当前这一幕写在 `当前.md`。\n',
  milestones: '# 特殊事件\n\n> 只记大节点，格式：`## 事件名（第N—M轮）` + 三五行说明。\n',
  others: '# 其他人物\n\n> 一个配角一节，格式：`## 姓名（第N轮起）` + 身份、关系、关键剧情。\n',
  special: '# 特殊物品\n\n> 有分量的物件，格式：`## 物件名（第N轮）` + 来历、意义、现在在哪儿。\n',
  life: '# 生活物品\n\n> 日常细节：吃什么、穿什么、屋里有什么、习惯用什么。\n',
  rules: '# 输出规则\n\n> 用户要求优先于一切。写之前照这里来。\n',
  emotion: '# 情感要求\n\n> 先满足要求，再从 `情感样本.md` 里挑语句语气。\n',
  threads: '# 伏笔与未收线索\n\n> 可以往前推一点，但不要一次收完。\n',
  voice: '# 语感样本\n\n> 照着句子学语气。\n',
  sources: '# 来源与版本\n\n> 每份设定从哪来。\n',
}

/** 建立知识库骨架（已存在的文件不动）。 */
export function scaffold(outDir, { novel = null, settingText = '' } = {}) {
  const base = root(outDir)
  ensureDir(base)
  const created = []
  for (const item of MODULES) {
    const dir = join(base, item.dir)
    ensureDir(dir)
    // 记忆卡目录只放卡，不放骨架文件（否则会被当成一张卡读进 prompt）
    if (item.key === 'cards') continue
    const file = join(dir, `${item.label.replace('·', '_')}.md`)
    if (writeIfMissing(file, SKELETONS[item.key] ?? `# ${item.label}\n`)) created.push(relative(base, file))
  }
  const current = join(base, '05_时间线', '当前.md')
  if (writeIfMissing(current, currentSkeleton(novel))) created.push(relative(base, current))
  const rules = join(base, '10_规则', '输出规则.md')
  if (existsSync(rules) && settingText) {
    const body = readFileSync(rules, 'utf8')
    if (!body.includes('## 从设定里抽出来的硬要求')) writeFileSync(rules, `${body}\n${rulesFromSetting(settingText)}\n`, 'utf8')
  }
  rebuildIndex(base)
  return { dir: base, created }
}

function currentSkeleton(novel) {
  const current = novel?.current ?? {}
  const lines = ['# 当前这一幕', '']
  lines.push(`- 轮次：第 ${current.round ?? 0} 轮结束`)
  if (current.day || current.place) lines.push(`- 时间地点：${[current.day, current.place].filter(Boolean).join('，')}`)
  if (current.scene) lines.push(`- 正在发生：${current.scene}`)
  if (current.affection) lines.push(`- 感情进度：${current.affection}`)
  if (current.lastAiQuote) lines.push(`- 他最后一句：「${current.lastAiQuote}」`)
  lines.push('')
  lines.push('> 每次续接前，插件会按档案里的最新一轮重写这一页。')
  return md(lines.join('\n'))
}

/** 从设定里抽「注意：」之后的硬要求，写进 10_规则。 */
function rulesFromSetting(text) {
  const at = String(text ?? '').indexOf('注意')
  if (at === -1) return ''
  const tail = String(text).slice(at)
  const lines = tail.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 40)
  const out = ['## 从设定里抽出来的硬要求', '']
  for (const line of lines) out.push(`- ${line.replace(/^[-*\d.、\s]+/, '').slice(0, 120)}`)
  out.push('')
  return out.join('\n')
}

export function readModule(outDir, key) {
  const item = moduleByKey(key)
  if (!item) throw new Error(`没有这个模块：${key}`)
  const base = root(outDir)
  const dir = join(base, item.dir)
  const files = []
  const walk = (folder, depth) => {
    if (!existsSync(folder) || depth > 2) return
    for (const name of readdirSync(folder)) {
      const file = join(folder, name)
      let info = null
      try {
        info = statSync(file)
      } catch {
        continue
      }
      if (info.isDirectory()) {
        walk(file, depth + 1)
        continue
      }
      if (!/\.(md|markdown|txt)$/i.test(name)) continue
      const text = readFileSync(file, 'utf8')
      files.push({ name: relative(dir, file), file, rel: relative(base, file), chars: text.length, text })
    }
  }
  walk(dir, 0)
  files.sort((a, b) => a.name.localeCompare(b.name))
  return { ...item, dir, files, chars: files.reduce((sum, file) => sum + file.chars, 0) }
}

/** 模块清单 + 每个模块最新的文件；供索引与面板使用。 */
export function kbIndex(outDir) {
  const base = root(outDir)
  return MODULES.map((item) => {
    const mod = readModule(base, item.key)
    const latest = mod.files[mod.files.length - 1]
    return {
      key: item.key,
      dir: item.dir,
      label: item.label,
      hint: item.hint,
      files: mod.files.length,
      chars: mod.chars,
      latest: latest ? latest.name : '',
    }
  })
}

/** 写 00_知识库.md：模块表 + 当前状态 + AI 的读取顺序。 */
export function rebuildIndex(outDir, { novel = null } = {}) {
  const base = root(outDir)
  const rows = kbIndex(base)
  const lines = ['# 知识库', '']
  lines.push('> 这个文件夹就是「大脑」：写之前先看这里，按模块取用；写完把新发生的事补回去。')
  lines.push('')
  lines.push('## 模块')
  lines.push('')
  lines.push('| 编号 | 模块 | 放着什么 | 文件 | 字数 | 最近一份 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const row of rows) {
    lines.push(`| ${row.dir} | ${row.label} | ${row.hint} | ${row.files} | ${row.chars} | ${row.latest || '—'} |`)
  }
  lines.push('')
  const current = novel?.current ?? null
  if (current) {
    lines.push('## 当前状态')
    lines.push('')
    lines.push(`- 第 ${current.round ?? 0} 轮结束，下一轮从第 ${Number(current.round ?? 0) + 1} 轮接`)
    if (current.day || current.place) lines.push(`- ${[current.day, current.place].filter(Boolean).join('，')}`)
    if (current.affection) lines.push(`- 感情进度：${current.affection}`)
    if (current.lastAiQuote) lines.push(`- 他最后一句：「${current.lastAiQuote}」`)
    lines.push('')
  }
  lines.push('## 怎么用（给 AI）')
  lines.push('')
  lines.push('1. 先看 `10_规则`，写法与禁忌最优先。')
  lines.push('2. 再读 `02_角色_他`、`03_角色_我`，把人定住。')
  lines.push('3. 看 `05_时间线/当前.md` 与 `01_剧情` 最近一章，接住眼前这一幕。')
  lines.push('4. 需要回顾时翻 `04_事件`、`06_特殊事件`、`07_其他人物`、`08`/`09` 的物品。')
  lines.push('5. 每轮只写他那一半，不替「我」做决定；不跳时间，不另起一件事。')
  lines.push('')
  lines.push('## 更新方式')
  lines.push('')
  lines.push('- 插件在「生成续接包 / 一键继续 / 同步知识库」时按档案重写 `05_时间线/当前.md`、补齐 `01_剧情`，并把新事件追加进 `04_事件/事件簿.md`。')
  lines.push('- 每 20—30 轮存一张 `11_记忆卡/记忆_起始-结束.md`；索引会自动重建。')
  lines.push('')
  const file = join(base, KB_INDEX)
  writeFileSync(file, lines.join('\n'), 'utf8')
  return { file, modules: rows }
}

/** 供续接 prompt 用：按优先级取各模块正文，控制在 budget 内。 */
export function readKb(outDir, { budget = 15500 } = {}) {
  const base = root(outDir)
  const indexFile = join(base, KB_INDEX)
  const index = existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : ''
  const parts = []
  const order = ['rules', 'world', 'emotion', 'hero', 'girl', 'scene', 'timeline', 'milestones', 'plot', 'voice', 'threads', 'events', 'others', 'special', 'life', 'cards']
  const perModule = { rules: 2200, world: 1000, emotion: 1800, hero: 1700, girl: 1700, scene: 1400, timeline: 1300, milestones: 1000, plot: 2200, voice: 1000, threads: 800, events: 1000, others: 900, special: 600, life: 500, cards: 1400 }
  let used = 0
  for (const key of order) {
    const mod = readModule(base, key)
    if (mod.files.length === 0) continue
    let text = ''
    let moduleUsed = 0
    const moduleCap = perModule[key] ?? 1200
    // 剧情只看最近两章；事件簿看最新的；时间线先「当前」再整条线
    const files = pickFiles(mod, key)
    for (const file of files) {
      if (moduleUsed >= moduleCap || used >= budget) break
      const cap = Math.max(200, Math.min(moduleCap - moduleUsed, budget - used))
      if (cap < 200) break
      const body = clip(file.text, cap)
      text += `### ${mod.label} · ${file.name}\n\n${body}\n\n`
      used += body.length + mod.label.length + file.name.length + 10
      moduleUsed += body.length
    }
    if (text.trim() !== '') parts.push(text.trimEnd())
    if (used >= budget) break
  }
  return { index, parts, text: parts.join('\n\n'), chars: used }
}

function pickFiles(mod, key) {
  const files = mod.files
  if (key === 'plot') return files.slice(-2)
  if (key === 'timeline') {
    const current = files.filter((file) => file.name === '当前.md')
    const rest = files.filter((file) => file.name !== '当前.md').slice(-1)
    return [...current, ...rest]
  }
  if (key === 'events') return files.map((file) => ({ ...file, text: tailText(file.text, 2600) }))
  if (key === 'cards') return files.filter((file) => file.name !== '记忆卡.md').slice(-2)
  const skeleton = `${mod.label}.md`
  const others = files.filter((file) => file.name !== skeleton)
  const usable = others.length > 0 ? others : files
  if (key === 'world') {
    const order = ['世界观设定.md', '世界观.md', '场所与规矩.md']
    const picked = order.map((name) => usable.find((file) => file.name === name)).filter(Boolean)
    return [...picked, ...usable.filter((file) => !picked.includes(file))]
  }
  if (key === 'emotion') {
    const order = ['情感要求.md', '情感样本.md']
    const picked = order.map((name) => usable.find((file) => file.name === name)).filter(Boolean)
    return [...picked, ...usable.filter((file) => !picked.includes(file))]
  }
  if (key === 'scene') {
    // 场景：先索引，再挑与「当前这一幕」最像的几份（按文件里的地点词命中）；没有当前场景时按顺序取前 3 份
    const index = files.find((file) => file.name === '00_场景索引.md')
    const rest = usable.filter((file) => file.name !== '00_场景索引.md')
    return [...(index ? [index] : []), ...rest.slice(0, 4)]
  }
  if (key === 'threads') return usable
  if (key === 'voice') return usable.slice(0, 1)
  if (key === 'rules') {
    const order = ['输出规则.md', '00_规则清单.md']
    const picked = []
    for (const name of order) {
      const hit = files.find((file) => file.name === name)
      if (hit) picked.push(hit)
    }
    const rest = usable.filter((file) => !picked.some((item) => item.name === file.name))
    return [...picked, ...rest].slice(0, 3)
  }
  return usable.slice(0, 3)
}

function tailText(text, cap) {
  if (text.length <= cap) return text
  return `……（前略）\n${text.slice(text.length - cap)}`
}

function clip(text, budget) {
  const value = String(text ?? '').trim()
  if (value.length <= budget) return value
  return `${value.slice(0, Math.max(0, budget - 30))}\n……（后面省略）`
}

/** 追加一段到某个模块文件（默认追加到该模块第一份文件）。 */
export function appendKb(outDir, key, text, { file = null } = {}) {
  const mod = moduleByKey(key)
  if (!mod) throw new Error(`没有这个模块：${key}`)
  const base = root(outDir)
  const dir = join(base, mod.dir)
  ensureDir(dir)
  const name = file ?? (key === 'plot' ? '00_分卷与章目.md' : `${mod.label.replace('·', '_')}.md`)
  const target = join(dir, name)
  const body = String(text ?? '').trim()
  const existing = existsSync(target) ? readFileSync(target, 'utf8') : `# ${mod.label}\n`
  writeFileSync(target, `${existing.trimEnd()}\n\n${body}\n`, 'utf8')
  rebuildIndex(base)
  return { file: target, chars: body.length }
}


function stamp() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

function readRoundsSafe(base) {
  const file = join(base, 'analysis', 'turns.jsonl')
  if (!existsSync(file)) return []
  try {
    return readTurns(file)
  } catch {
    return []
  }
}

/**
 * 把合并过的设定拆成一份份带出处的规则文件，放在 10_规则/。
 * 这样「用户上传的规则」只改那一份，不必重跑整个整理。
 */
export function writeRuleSources(outDir, { settingText = '', novel = null, uploads = [] } = {}) {
  const base = root(outDir)
  const dir = join(base, '10_规则')
  ensureDir(dir)
  const written = []
  const rows = []
  const put = (name, provenance, body) => {
    const text = String(body ?? '').trim()
    if (text.length < 20) return
    const file = join(dir, name)
    writeFileSync(file, `# 规则来源：${provenance}\n\n> 来源：${provenance}\n> 写入时间：${stamp()}\n\n${text}\n`, 'utf8')
    written.push(relative(base, file))
    rows.push({ name, provenance, chars: text.length })
  }
  const seen = new Set()
  let index = 0
  const text = String(settingText ?? '')
  const chapters = text.split(/^#\s+/m).slice(1)
  if (chapters.length === 0 && text.trim() !== '') chapters.push(text.trim())
  for (const chapter of chapters) {
    const headAt = chapter.indexOf('\n')
    const headTitle = (headAt === -1 ? chapter : chapter.slice(0, headAt)).trim()
    const rest = headAt === -1 ? '' : chapter.slice(headAt + 1)
    const leaves = rest.split(/^##\s+/m).slice(1)
    if (leaves.length === 0) {
      // 整段没有子标题：按顶层标题存一份
      const title = headTitle.replace(/^[一二三四五六七八九十]+、/, '')
      if (title !== '' && !seen.has(title)) {
        seen.add(title)
        index += 1
        put(`来源${String(index).padStart(2, '0')}_${sanitize(title)}.md`, `对话/上传里的「${title}」`, rest)
      }
      continue
    }
    for (const leaf of leaves) {
      const at = leaf.indexOf('\n')
      const title = (at === -1 ? leaf : leaf.slice(0, at)).trim()
      const body = at === -1 ? '' : leaf.slice(at + 1).trim()
      if (title === '' || seen.has(title)) continue
      seen.add(title)
      index += 1
      put(`来源${String(index).padStart(2, '0')}_${sanitize(title)}.md`, `对话/上传里的「${title}」`, body)
    }
  }
  const list = Array.isArray(uploads) ? uploads : []
  for (const item of list) {
    const title = String(item?.name ?? '').trim()
    if (title === '' || seen.has(title)) continue
    seen.add(title)
    index += 1
    put(`来源${String(index).padStart(2, '0')}_${sanitize(title)}.md`, `面板上传（${item.kind === 'extra' ? '补充' : '人设'}）：${title}`, item.text)
  }
  const lines = ['# 规则清单', '', `> 每一份规则都带着出处；改哪条就改哪一份，改完重跑一次「同步知识库」。最后更新：${stamp()}`, '']
  lines.push('| 文件 | 出处 | 字数 |')
  lines.push('| --- | --- | --- |')
  for (const row of rows) lines.push(`| ${row.name} | ${row.provenance} | ${row.chars} |`)
  if (rows.length === 0) lines.push('| — | 还没有拆出单独的规则来源 | — |')
  lines.push('')
  const currentRules = read(join(dir, '输出规则.md'))
  if (currentRules) {
    lines.push('## 兜底：输出规则.md', '', '> 从人物设定与 novel.json 里抽出的写法要求，优先级低于上面按出处拆开的文件。', '')
    lines.push(`- 见 \`输出规则.md\`（${currentRules.length} 字）`)
    lines.push('')
  }
  writeFileSync(join(dir, '00_规则清单.md'), lines.join('\n'), 'utf8')
  written.push(relative(base, join(dir, '00_规则清单.md')))
  return { written, rows }
}

function read(file) {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  } catch {
    return ''
  }
}

/** 从档案同步进知识库：剧情章节、角色、规则、当前这一幕、事件簿增量。 */
function worldFromSetting(settingText) {
  const text = String(settingText ?? '')
  if (text.trim() === '') return ''
  const truthy = []
  const patterns = [
    /^.*(?:住处|房子|宅子|院子).*$/gm,
    /^.*(?:城|市|地方|乡下).*$/gm,
    /^.*(?:收养|家庭|亲属|规矩|对外|露面|避人).*$/gm,
    /^.*(?:阶层|门第|圈子|上头|位置|规矩).*$/gm,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const line = match[0].replace(/^[-*\s]+/, '').trim()
      if (line.length < 8 || line.length > 120) continue
      if (truthy.includes(line)) continue
      truthy.push(line)
      if (truthy.length >= 24) break
    }
    if (truthy.length >= 24) break
  }
  if (truthy.length === 0) return ''
  return ['## 从设定里摘出来的世界细节', '', ...truthy.map((line) => `- ${line}`)].join('\n')
}

export function syncKb(outDir, { novel = null, chapters = [], settingText = '', bibleText = '', light = false } = {}) {
  const base = root(outDir)
  scaffold(base, { novel, settingText })
  const written = []
  // light：续接前只刷新「当前这一幕」、补事件、重建索引，不动剧情与角色正文
  if (light) {
    ensureDir(join(base, '05_时间线'))
    writeFileSync(join(base, '05_时间线', '当前.md'), currentSkeleton(novel), 'utf8')
    written.push('05_时间线/当前.md')
    const events = appendEvents(base, novel)
    // 情感样本跟着最近几十轮刷新（只重写 12_情感 下的样本，不动要求）
    const rounds = readRoundsSafe(base)
    if (rounds.length > 0) {
      const emotion = buildEmotion(base, { novel, rounds })
      written.push(...emotion.files.map((name) => `12_情感/${name}`))
    }
    const round = Number(novel?.current?.round ?? rounds[rounds.length - 1]?.i ?? 0)
    // 场景每满 20 轮重认一次，新出现的地方与新的屋子细节会自己补进去
    try {
      const mark = join(base, '17_场景', '.last')
      const lastScene = existsSync(mark) ? Number(readFileSync(mark, 'utf8').trim() || 0) : 0
      if (round > 0 && round - lastScene >= 20) {
        const scenes = buildScenes(base, { novel, bibleText: '', rounds })
        written.push(...scenes.files)
        writeFileSync(mark, String(round), 'utf8')
      }
    } catch {
      /* 场景重认失败不影响续接 */
    }
    // 每满 20 轮自动落一张滚动记忆卡
    const cards = listCards(base)
    const coveredTo = cards.length > 0 ? cards[cards.length - 1].to : 0
    if (round > 0 && round - coveredTo >= 20) {
      const from = coveredTo > 0 ? coveredTo + 1 : Math.max(1, round - 19)
      try {
        const digest = buildDigest(base, { from, to: round })
        const saved = saveCard(base, { from, to: round, text: digest })
        written.push(`11_记忆卡/${saved.name}`)
      } catch {
        /* 素材不足就不落卡，不影响续接 */
      }
    }
    rebuildIndex(base, { novel })
    return { dir: base, written, events }
  }
  // 01 剧情：章目 + 每章一个文件
  const plotDir = join(base, '01_剧情')
  if (chapters.length > 0) {
    const rows = ['# 分卷与章目', '', '| 章 | 轮次 | 标题 |', '| --- | --- | --- |']
    for (const chapter of chapters) rows.push(`| 第${chapter.n}章 | 第${chapter.from}—${chapter.to}轮 | ${chapter.title} |`)
    rows.push('')
    const chaptersDir = join(plotDir, '章节')
    ensureDir(chaptersDir)
    for (const chapter of chapters) {
      const name = `第${String(chapter.n).padStart(2, '0')}章_${sanitize(chapter.title)}.md`
      const body = [`# 第${chapter.n}章 ${chapter.title}`, '', `> 第 ${chapter.from}—${chapter.to} 轮`, '', String(chapter.body ?? '').trim(), ''].join('\n')
      writeFileSync(join(chaptersDir, name), body, 'utf8')
    }
    written.push(relative(base, join(plotDir, '00_分卷与章目.md')))
    writeFileSync(join(plotDir, '00_分卷与章目.md'), rows.join('\n'), 'utf8')
    const old = join(plotDir, '剧情.md')
    if (existsSync(old) && chapters.length > 0) {
      /* 骨架文件保留，作为总说明；章节都在 章节/ 里 */
    }
  }
  // 06 特殊事件：从章节标题里挑大节点
  const milestoneRows = chapters
    .filter((chapter) => /绑架|ICU|重症|病|葬礼|结婚|婚礼|登台|除夕|过年|远行|庭审|交换|生日/.test(chapter.title))
    .map((chapter) => `- 第${chapter.n}章 ${chapter.title}（第 ${chapter.from}—${chapter.to} 轮）`)
  if (milestoneRows.length > 0) {
    const file = join(base, '06_特殊事件', '特殊事件.md')
    writeFileSync(file, `# 特殊事件\n\n> 大节点，从章目里筛出来的；细节回 01_剧情/章节 里看。\n\n${milestoneRows.join('\n')}\n`, 'utf8')
    written.push('06_特殊事件/特殊事件.md')
  }

  // 02/03 角色、10 规则：从 novel 与人物设定里取
  const bible = String(bibleText ?? '')
  const sections = mdSections(bible)
  writeSection(join(base, '02_角色_他', '角色_他.md'), '角色·他', [
    novel?.ai ? heroBlock(novel.ai) : '',
    sectionByKeywords(sections, ['男主', '他', '霍']),
  ])
  written.push('02_角色_他/角色_他.md')
  writeSection(join(base, '03_角色_我', '角色_我.md'), '角色·我', [
    novel?.user ? girlBlock(novel.user, novel) : '',
    sectionByKeywords(sections, ['女主', '我', '夏']),
  ])
  written.push('03_角色_我/角色_我.md')
  const rulesBody = [rulesBlock(novel), sectionByKeywords(sections, ['写作规则', '设定与写作']), sectionByKeywords(sections, ['设定与写作规则'])].filter(Boolean)
  if (rulesBody.length > 0) {
    writeSection(join(base, '10_规则', '输出规则.md'), '输出规则', rulesBody)
    written.push('10_规则/输出规则.md')
  }
  // 16 世界观：时代、地方、规矩、场所；从人物设定与上传设定里取
  const worldParts = []
  const worldSection = sectionByKeywords(sections, ['故事世界', '世界观', '故事背景', '时代背景'])
  if (worldSection) worldParts.push(worldSection)
  const placeSection = sectionByKeywords(sections, ['关键地点', '地点', '场所'])
  if (placeSection) worldParts.push(placeSection)
  const settingWorld = worldFromSetting(settingText)
  if (settingWorld) worldParts.push(settingWorld)
  if (worldParts.length === 0) {
    worldParts.push([
      `## 时代与地方`,
      '',
      `当代都市。${novel?.title ? `故事发生在《${novel.title}》里。` : ''}${novel?.current?.place ? `眼下在${novel.current.place}。` : ''}`,
      '',
      '## 规矩',
      '',
      '- 没有超现实设定，没有黑道火并、没有跨国追杀；一切后果按现实里的规矩来。',
      '- 两人的关系在外人面前是另一套说法，说话先看在场有谁。',
    ].join('\n'))
  }
  writeSection(join(base, '16_世界观', '世界观设定.md'), '世界观设定', worldParts)
  written.push('16_世界观/世界观设定.md')
  // 17 场景：从原文里认出「这地方长什么样」的句子，按地方归档
  const scenes = buildScenes(base, { novel, bibleText: bible, rounds: readRoundsSafe(base) })
  written.push(...scenes.files.map((name) => `${name}`))
  // 05 时间线/当前
  writeFileSync(join(base, '05_时间线', '当前.md'), currentSkeleton(novel), 'utf8')
  written.push('05_时间线/当前.md')
  // 07 其他人物、08/09 物件：从人物设定里挑对应节
  const others = sectionByKeywords(sections, ['其他人物', '配角', '身边的人', '商界', '人物关系'])
  if (others) {
    writeSection(join(base, '07_其他人物', '其他人物.md'), '其他人物', [others])
    written.push('07_其他人物/其他人物.md')
  }
  const special = sectionByKeywords(sections, ['关键物件', '特殊物品', '物件'])
  if (special) {
    writeSection(join(base, '08_特殊物品', '特殊物品.md'), '特殊物品', [special])
    written.push('08_特殊物品/特殊物品.md')
  }
  const places = sectionByKeywords(sections, ['关键地点', '地点'])
  if (places) {
    writeSection(join(base, '05_时间线', '地点.md'), '地点', [places])
    written.push('05_时间线/地点.md')
  }
  // 10_规则：把合并过的设定拆成一份份带出处的文件
  const ruleSplit = writeRuleSources(base, { settingText, novel })
  written.push(...ruleSplit.written)
  // 12 情感 / 13 伏笔 / 14 语感 / 15 来源
  const rounds = readRoundsSafe(base)
  const emotion = buildEmotion(base, { novel, rounds })
  written.push(...emotion.files.map((name) => `12_情感/${name}`))
  const threads = buildThreads(base, { novel })
  written.push(...threads.files.map((name) => `13_伏笔/${name}`))
  const voice = buildVoice(base, { rounds })
  written.push(...voice.files.map((name) => `14_语感/${name}`))
  const sources = buildSources(base, { novel, chapters, beats: existsSync(join(base, 'analysis', 'beats')) ? readdirSync(join(base, 'analysis', 'beats')).filter((name) => /^block_.*\.md$/.test(name)).length : 0 })
  written.push(...sources.files.map((name) => `15_来源/${name}`))
  // 04 事件簿增量：从上次记到的轮次补到 novel.current.round
  const appended = appendEvents(base, novel)
  if (appended) written.push('04_事件/事件簿.md')
  rebuildIndex(base, { novel })
  return { dir: base, written, events: appended }
}

function appendEvents(base, novel) {
  const round = Number(novel?.current?.round ?? 0)
  if (!round) return 0
  const file = join(base, '04_事件', '事件簿.md')
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '# 事件簿\n'
  const rounds = [...existing.matchAll(/（第(\d+)轮）/g)].map((match) => Number(match[1]))
  const last = rounds.length > 0 ? Math.max(...rounds) : 0
  const from = Math.max(last + 1, round - 60)
  if (from > round) return 0
  const turnsFile = join(base, 'analysis', 'turns.jsonl')
  if (!existsSync(turnsFile)) return 0
  const lines = []
  for (const item of readTurns(turnsFile)) {
    const round_ = Number(item.i)
    if (!Number.isFinite(round_) || round_ < from || round_ > round) continue
    const user = firstSentence(item.user?.text)
    const ai = firstSentence(item.ai?.text)
    lines.push(`- （第${round_}轮）${user || '（动作）'}${ai ? ` → ${ai}` : ''}`)
  }
  if (lines.length === 0) return 0
  writeFileSync(file, `${existing.trimEnd()}\n\n${lines.join('\n')}\n`, 'utf8')
  return lines.length
}

function firstSentence(value) {
  const text = String(value ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim()
  if (text === '') return ''
  const cut = text.split(/(?<=[。！？!?])/)[0] ?? text
  return cut.replace(/^[「『“‘"'（(【\[]+/, '').slice(0, 60)
}

function writeSection(file, title, blocks) {
  const body = blocks.filter((block) => String(block ?? '').trim() !== '').join('\n\n')
  const content = `# ${title}\n\n${body.trim()}\n`
  ensureDir(resolve(file, '..'))
  writeFileSync(file, content, 'utf8')
}

function heroBlock(ai) {
  const lines = [`## ${ai.name ?? ''}`, '']
  if (ai.age) lines.push(`- 年龄：${ai.age}`)
  if (ai.identity) lines.push(`- 身份：${ai.identity}`)
  if (ai.home) lines.push(`- 住处：${ai.home}`)
  if ((ai.traits ?? []).length > 0) lines.push(`- 性子：${ai.traits.join('、')}`)
  if (ai.callName) lines.push(`- 称呼：叫他${ai.callName}`)
  return lines.join('\n')
}

function girlBlock(user, novel) {
  const lines = [`## ${user.name ?? ''}`, '']
  if (user.nickname) lines.push(`- 小名：${user.nickname}`)
  if (user.age) lines.push(`- 年龄：${user.age}`)
  if (user.identity) lines.push(`- 身份：${user.identity}`)
  if ((user.traits ?? []).length > 0) lines.push(`- 性子：${user.traits.join('、')}`)
  if (novel?.relationship) lines.push(`- 关系：${novel.relationship}`)
  return lines.join('\n')
}

function rulesBlock(novel) {
  const rules = novel?.rules ?? {}
  const lines = []
  if (rules.pov) lines.push(`- 视角：${rules.pov}`)
  if (rules.lengthLine) lines.push(`- 篇幅：${rules.lengthLine}`)
  for (const item of rules.style ?? []) lines.push(`- 要：${item}`)
  for (const item of rules.deny ?? []) lines.push(`- 不要：${item}`)
  if (rules.statusBar?.fields?.length) lines.push(`- 状态栏：${rules.statusBar.fields.join(' / ')}`)
  return lines.length > 0 ? ['## 写法', '', ...lines].join('\n') : ''
}

function mdSections(text) {
  const sections = []
  const parts = String(text ?? '').split(/^##\s+/m)
  for (const part of parts.slice(1)) {
    const at = part.indexOf('\n')
    const title = (at === -1 ? part : part.slice(0, at)).trim()
    const body = (at === -1 ? '' : part.slice(at + 1)).trim()
    sections.push({ title, body })
  }
  return sections
}

function sectionByKeywords(sections, keywords) {
  for (const section of sections) {
    if (keywords.some((keyword) => section.title.includes(keyword))) {
      if (section.body.length > 60) return `## ${section.title}\n\n${section.body}`
    }
  }
  return ''
}

function sanitize(name) {
  return String(name ?? '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
}
