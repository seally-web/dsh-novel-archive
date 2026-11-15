/**
 * 知识库里的「软」模块：情感、语感、伏笔、来源。
 *
 * 共同原则：每一条都带来源（轮次或文件），这样 AI 不是在「遵守规则」，
 * 而是在照着已经发生过的句子与要求往下写。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const STATUS_RE = /好感度\s*[：:]\s*(\d{1,3})\s*%/
const CLEAN_RE = /```[\s\S]*?```/g

function base(outDir) {
  return resolve(String(outDir ?? '.'))
}

function read(file) {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  } catch {
    return ''
  }
}

function write(dir, name, text) {
  const target = join(dir, name)
  writeFileSync(target, String(text).trimEnd() + '\n', 'utf8')
  return target
}

/** 去掉代码块（状态栏），压成一行，去掉开头引号。 */
export function cleanLine(value, cap = 70) {
  const text = String(value ?? '')
    .replace(CLEAN_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text === '') return ''
  const first = text.split(/(?<=[。！？!?])/)[0] ?? text
  return first.replace(/^[「『“‘"'（(【[]+/, '').slice(0, cap)
}

/** 优先取引号里的话；没有引号再退回首句（动作）。 */
export function sampleLine(value, cap = 80) {
  const text = String(value ?? '').replace(CLEAN_RE, ' ').replace(/\s+/g, ' ').trim()
  if (text === '') return ''
  const quoted = /[「『“‘"]([^」』”’"]{4,})[」』”’"]/.exec(text)
  if (quoted) return quoted[1].replace(/\s+/g, ' ').trim().slice(0, cap)
  const first = text.split(/(?<=[。！？!?])/)[0] ?? text
  return first.replace(/^[「『“‘"'（(【[]+/, '').slice(0, cap)
}

function quoteLines(rounds, cap = 90) {
  return rounds.map((round) => {
    const user = sampleLine(round.user?.text, cap)
    const ai = sampleLine(round.ai?.text, cap)
    return { round: Number(round.i), user, ai }
  })
}

function sceneOf(ai) {
  if (/(我认|是急了|对不起|吓着|别怕)/.test(ai)) return '认错与哄'
  if (/(不许|不准|别|记住|该|得先|给我|听我的)/.test(ai)) return '管束'
  if (/(抱|亲|手|贴|靠|睡|额头|怀里)/.test(ai)) return '亲近'
  if (/(行|那就|依你|随你|不必|我记着|你说得对)/.test(ai)) return '松口'
  if (/(吃|睡|药|冷|暖|路|雨|饭|茶|几点了)/.test(ai)) return '日常照看'
  return '平常说话'
}

function pickSamples(rounds, perScene = 6) {
  const buckets = new Map()
  for (const item of quoteLines(rounds)) {
    if (!item.ai) continue
    const scene = sceneOf(item.ai)
    const bucket = buckets.get(scene) ?? []
    if (bucket.length < perScene) bucket.push(item)
    buckets.set(scene, bucket)
  }
  return buckets
}

/** 12_情感：要求（怎么处理情感输出）+ 样本（原句与轮次）+ 曲线。 */
export function buildEmotion(outDir, { novel = null, rounds = [] } = {}) {
  const dir = join(base(outDir), '12_情感')
  const rulesDir = join(base(outDir), '10_规则')
  const ruleFiles = existsSync(rulesDir) ? readdirSync(rulesDir).filter((name) => /\.md$/i.test(name) && !/^00_/.test(name)).sort() : []
  const rulesText = ruleFiles.map((name) => read(join(rulesDir, name))).join('\n')
  const ruleSource = ruleFiles.length > 0 ? `10_规则/（${ruleFiles.join('、')}）` : '设定文件'

  const requirements = []
  requirements.push('## 一、情感戏的写法（硬要求）', '')
  requirements.push('- 只写他这一半：她的动作、台词、心理都由用户来写；他只能「看到」她，不能替她想。')
  requirements.push('- 情绪先落在身体上：先一个动作（放下杯子、看了她一眼、把话停住），再一句短话；不写「他感到/他明白/他觉得」。')
  requirements.push('- 一句里只放一个意思：不解释，不总结，不把上一句翻译一遍。')
  requirements.push('- 一轮只往前挪一小步：她给了多少，他回多少；不许借机把关系推到大场面。')
  requirements.push('- 克制的地方留白：想说的话咽回去，比说出来更有分量；不要用比喻去加温。')
  requirements.push('- 不写露骨：亲近停在动作与距离上（额头、手腕、衣领、背后），不写身体细节。')
  requirements.push('- 语气跟着现在走：眼下是日常就写日常，不翻旧账、不忽然发火、不无端抒情。')
  requirements.push('')
  requirements.push(`> 以上不是凭空定的，来源：${ruleSource}（用户上传的规则与设定里的「注意」段）`)
  const deny = []
  const denyMatch = /^(?:[-*]\s*)?((?:不要|不能|不许|不得|禁)[^\n|]{0,80})/gm
  for (const match of rulesText.matchAll(denyMatch)) {
    const line = match[1].replace(/\s+/g, ' ').trim()
    if (line.length > 6 && !deny.includes(line)) deny.push(line)
    if (deny.length >= 18) break
  }
  if (deny.length > 0) {
    requirements.push('')
    requirements.push('## 二、他不能有的情绪表达（从规则里抄的）', '')
    for (const line of deny) requirements.push(`- ${line.slice(0, 90)}`)
    requirements.push('')
    requirements.push(`> 来源：${ruleSource}`)
  }
  const current = novel?.current ?? {}
  requirements.push('')
  requirements.push('## 三、此刻的情感刻度', '')
  requirements.push(`- 轮次：第 ${current.round ?? 0} 轮结束`)
  requirements.push(`- 感情进度：${current.affection ?? '（状态栏里写着，按最近一轮）'}`)
  if (novel?.relationship) requirements.push(`- 关系：${novel.relationship}`)
  requirements.push('- 读法：这个百分比只说明「他让到哪一步」，不说明「他会不会说」；越到后面，他越是用做事代替说话。')
  requirements.push('')
  write(dir, '情感要求.md', ['# 情感要求', '', '> 写情感戏之前先看这里：先满足要求，再从样本里挑语气。', '', ...requirements].join('\n'))

  const samples = ['# 情感样本', '', '> 全部来自原文，带轮次；写之前挑同一场景的两三句，照着那个语气来。', '']
  const buckets = pickSamples(rounds.slice(-120), 6)
  for (const [scene, items] of buckets) {
    samples.push(`## ${scene}`, '')
    for (const item of items) {
      samples.push(`- 第${item.round}轮｜他：「${item.ai}」`)
      if (item.user) samples.push(`  - 她：「${item.user}」`)
    }
    samples.push('')
  }
  if (buckets.size === 0) samples.push('（档案里还没有可抽的轮次）', '')
  write(dir, '情感样本.md', samples.join('\n'))

  const series = []
  for (const round of rounds) {
    const match = STATUS_RE.exec(String(round.ai?.text ?? ''))
    if (!match) continue
    const value = Number(match[1])
    const last = series[series.length - 1]
    if (!last || last.value !== value) series.push({ round: Number(round.i), value })
  }
  const curve = ['# 情感曲线', '', '> 状态栏里的好感度，按变化记；写的时候别让它倒退或跳级。', '']
  if (series.length > 0) {
    const step = Math.max(1, Math.floor(series.length / 40))
    for (let index = 0; index < series.length; index += step) {
      const point = series[index]
      curve.push(`- 第${point.round}轮：${point.value}%`)
    }
    const lastPoint = series[series.length - 1]
    curve.push(`- 第${lastPoint.round}轮：${lastPoint.value}%（最近）`)
  } else {
    curve.push('（状态栏里还没有好感度）')
  }
  curve.push('')
  write(dir, '情感曲线.md', curve.join('\n'))

  return { dir, files: ['情感要求.md', '情感样本.md', '情感曲线.md'] }
}

/** 14_语感：按场景的原句摘录。 */
export function buildVoice(outDir, { rounds = [] } = {}) {
  const dir = join(base(outDir), '14_语感')
  const lines = ['# 语感样本', '', '> 照句子学语气，比照规则学更快。每条都带轮次，可回原文。', '']
  const buckets = pickSamples(rounds.slice(-200), 5)
  for (const [scene, items] of buckets) {
    lines.push(`## ${scene}`, '')
    for (const item of items) lines.push(`- 第${item.round}轮：「${item.ai}」`)
    lines.push('')
  }
  if (buckets.size === 0) lines.push('（还没有样本）', '')
  lines.push('## 他的常用词', '')
  lines.push('- 行 / 得 / 这事儿 / 往后 / 不必 / 别 / 一样样 / 我心里有数 / 这话我记着 / 你说得对')
  lines.push('- 不用：我这边 / 实在 / 稳 / 忽然 / 猛地 / 仿佛 / 就像 / 一丝 / 一抹')
  lines.push('')
  write(dir, '语感样本.md', lines.join('\n'))
  return { dir, files: ['语感样本.md'] }
}

/** 13_伏笔：还没落地的事。优先取 02 前情提要的「未收线索」一节，其次 novel.current.openThreads。 */
export function buildThreads(outDir, { novel = null } = {}) {
  const root = base(outDir)
  const dir = join(root, '13_伏笔')
  const lines = ['# 伏笔与未收线索', '', '> 写的时候可以往前推一点，但不要一次收完；每收一条，自己把它划掉。', '']
  const pack = ['续接包/02_设定与前情提要.md', '续接包/02_设定与前情提要.txt'].map((name) => join(root, name)).find((file) => existsSync(file))
  const packText = pack ? read(pack) : ''
  const sectionAt = packText.indexOf('## 三、当前状态')
  const fallbackAt = sectionAt === -1 ? packText.indexOf('未收线索') : sectionAt
  if (fallbackAt !== -1) {
    const pendingAt = packText.lastIndexOf('还没落地的事')
    const tail = packText.slice(pendingAt === -1 ? fallbackAt : pendingAt).split('\n').slice(0, 14).filter((line) => /^-\s/.test(line.trim()) || /^>\s/.test(line.trim())).join('\n').trim()
    if (/^- /m.test(tail)) {
      lines.push(tail)
      lines.push('')
      lines.push(`> 来源：${relative(root, pack)}`)
    }
  }
  // 兜底：从最近两章的概述里挑「还没 / 没定 / 回头 / 等着」这类句子
  const plotDir = join(root, '01_剧情', '章节')
  const derived = []
  if (existsSync(plotDir)) {
    const files = readdirSync(plotDir).filter((name) => /\.md$/i.test(name)).sort().slice(-2)
    for (const name of files) {
      const body = read(join(plotDir, name)).replace(/^#.*$/gm, '')
      for (const sentence of body.split(/(?<=[。！？!?])/)) {
        if (!/(还没|没定|未定|没说开|欠着)/.test(sentence) && !/(交换|领证|酒席|婚礼|护照|签证|回家|过年|见面|说开)/.test(sentence)) continue
        const line = sentence.replace(/\s+/g, ' ').trim()
        if (line.length < 12 || line.length > 110) continue
        if (/(产业|地产|重心|方向|研究|项目|钱|道了谢|寒颤)/.test(line)) continue
        if (derived.some((item) => item.text.slice(0, 18) === line.slice(0, 18))) continue
        derived.push({ text: line, source: name })
        if (derived.length >= 12) break
      }
      if (derived.length >= 12) break
    }
  }
  if (derived.length > 0) {
    lines.push('## 从最近两章里挑出来的', '')
    for (const item of derived) lines.push(`- ${item.text}（来源：01_剧情/章节/${item.source}）`)
    lines.push('')
  }
  const threads = Array.isArray(novel?.current?.openThreads) ? novel.current.openThreads.filter(Boolean) : []
  if (threads.length > 0) {
    lines.push('## 从当前状态里记下的', '')
    for (const item of threads) lines.push(`- ${item}`)
    lines.push('')
  }
  if (fallbackAt === -1 && threads.length === 0 && derived.length === 0) {
    lines.push('（还没有自动抽到线索；下一步可写：她还没办的事、他还没认的话、还没送出去的东西）')
    lines.push('')
  }
  write(dir, '伏笔.md', lines.join('\n'))
  return { dir, files: ['伏笔.md'] }
}

/** 15_来源：每份设定从哪来、什么时候写进来的。 */
export function buildSources(outDir, { novel = null, chapters = [], beats = 0 } = {}) {
  const root = base(outDir)
  const dir = join(root, '15_来源')
  const lines = ['# 来源与版本', '', '> 改设定之前，先看这一份是从哪儿来的；改完重跑一次同步。', '']
  lines.push('## 对话')
  const stats = read(join(root, 'analysis', 'stats.json'))
  let statsJson = {}
  try {
    statsJson = stats ? JSON.parse(stats) : {}
  } catch {
    statsJson = {}
  }
  if (statsJson.sourceUrl) lines.push(`- 分享链接：${statsJson.sourceUrl}`)
  if (statsJson.rounds) lines.push(`- 轮次：${statsJson.rounds}`)
  const shareDir = join(root, 'share')
  if (existsSync(shareDir)) {
    for (const name of readdirSync(shareDir)) {
      if (/\.(docx|txt|md)$/i.test(name)) lines.push(`- 对话里的附件：share/${name}`)
    }
    const uploads = read(join(shareDir, 'uploads', 'index.json'))
    if (uploads) {
      try {
        for (const item of JSON.parse(uploads)) lines.push(`- 面板上传（${item.kind === 'extra' ? '补充' : '人设'}）：share/uploads/${item.file ?? item.name}`)
      } catch {
        /* 索引损坏就跳过 */
      }
    }
  }
  lines.push('')
  lines.push('## 设定文件')
  const rulesDir = join(root, '10_规则')
  if (existsSync(rulesDir)) {
    for (const name of readdirSync(rulesDir).filter((item) => /\.md$/i.test(item)).sort()) {
      const text = read(join(rulesDir, name))
      const provenance = /^> 来源：(.+)$/m.exec(text)?.[1] ?? '手写'
      lines.push(`- 10_规则/${name}（${text.length} 字，来源：${provenance}）`)
    }
  }
  if (existsSync(join(root, '02_人物设定.md'))) lines.push('- 02_人物设定.md（整理时由模型从原文写出）')
  lines.push('')
  lines.push('## 知识库')
  lines.push(`- 章节：${chapters.length} 章`)
  if (beats) lines.push(`- 分章素材：analysis/beats/ 共 ${beats} 块`)
  if (novel?._inferred) lines.push('- novel.json：按设定自动推断（`_inferred: true`），建议核对人物与当前场景后改一遍')
  else if (novel) lines.push('- novel.json：手写/已核对')
  const current = novel?.current ?? {}
  if (current.round) lines.push(`- 当前轮次：第 ${current.round} 轮`)
  lines.push('')
  write(dir, '来源清单.md', lines.join('\n'))
  return { dir, files: ['来源清单.md'] }
}
