/**
 * Rolling memory (rolling summary cards) + work-folder knowledge base.
 *
 * The plugin never invents prose: it keeps the cards on disk, indexes them,
 * and at continuation time reads them back together with whatever the user
 * keeps in 设定/ so the prompt is built from files, not from a stale paste.
 */
import { join, relative, resolve } from 'node:path'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { ensureDir, readJson, writeText } from './util.js'
import { readTurns } from './state.js'

export const MEMORY_DIR = '记忆'
export const CARD_DIR = '11_记忆卡'
export const SETTING_DIR = '设定'

const CARD_RE = /^记忆_(\d+)-(\d+)\.md$/
const SETTING_RE = /\.(md|markdown|txt)$/i
const SETTING_HINT = /^(人设|规则|设定|补充|写作|限制|世界)/

/** 有知识库时用 11_记忆卡/，没有时退回旧的 记忆/。 */
export function cardDirs(outDir) {
  const root = resolve(String(outDir ?? '.'))
  const dirs = [join(root, CARD_DIR), join(root, MEMORY_DIR)].filter((dir) => existsSync(dir))
  return dirs
}

export function memoryPath(outDir) {
  const root = resolve(String(outDir ?? '.'))
  const dirs = cardDirs(root)
  return dirs[0] ?? join(root, MEMORY_DIR)
}

/** Every card on disk, oldest range first. */
export function listCards(outDir) {
  const cards = []
  const seen = new Set()
  for (const dir of cardDirs(outDir)) {
    for (const name of readdirSync(dir)) {
      const match = CARD_RE.exec(name)
      if (!match) continue
      if (seen.has(name)) continue
      seen.add(name)
      cards.push({ file: join(dir, name), name, from: Number(match[1]), to: Number(match[2]), size: statSync(join(dir, name)).size })
    }
  }
  cards.sort((a, b) => a.from - b.from)
  return cards
}

/** Rounds covered by cards: [{from,to}], gaps included as null spans. */
export function coverage(outDir, totalRound) {
  const cards = listCards(outDir)
  const covered = cards.reduce((sum, card) => sum + Math.max(0, card.to - card.from + 1), 0)
  return {
    cards: cards.length,
    covered,
    from: cards.length > 0 ? cards[0].from : 0,
    to: cards.length > 0 ? cards[cards.length - 1].to : 0,
    lastCard: cards.length > 0 ? cards[cards.length - 1] : null,
    totalRound: Number(totalRound ?? 0),
  }
}

export function readCard(outDir, name) {
  for (const dir of cardDirs(outDir)) {
    const file = join(dir, name)
    if (existsSync(file)) return readFileSync(file, 'utf8')
  }
  return null
}

/** Latest cards, newest last. */
export function recentCards(outDir, count = 2) {
  const cards = listCards(outDir)
  return cards.slice(Math.max(0, cards.length - count)).map((card) => ({
    ...card,
    text: readFileSync(card.file, 'utf8'),
  }))
}

function firstSentence(text) {
  const compact = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const cut = compact.split(/(?<=[。！？!?])/)[0] ?? compact
  return cut.replace(/^[「『“‘"'（(【\[]+/, '').slice(0, 80)
}

/**
 * A deterministic draft card for one round span. It is raw material — the agent
 * can rewrite it into five lines and save it back through the tool.
 */
export function buildDigest(outDir, { from, to, every = 8 } = {}) {
  const root = resolve(String(outDir ?? '.'))
  const turnsFile = join(root, 'analysis', 'turns.jsonl')
  if (!existsSync(turnsFile)) throw new Error(`找不到 ${turnsFile}，先把对话整理进来`)
  const rounds = readTurns(turnsFile).filter((round) => round.i >= from && round.i <= to)
  if (rounds.length === 0) throw new Error(`第 ${from}—${to} 轮不在这份档案里`)

  const novel = readJson(join(root, 'novel.json'), null) ?? {}
  const last = rounds[rounds.length - 1]
  const lines = []
  lines.push(`# 记忆_${from}-${String(to).padStart(4, '0')}`)
  lines.push('')
  lines.push(`> 覆盖第 ${from}—${to} 轮（${rounds.length} 轮）。这是插件按原文抽出的底稿，可以改写成五行记忆卡再存回。`)
  lines.push('')
  lines.push('## 这段时间在哪儿')
  lines.push('')
  if (novel.current && Number(novel.current.round) === to && (novel.current.day || novel.current.place || novel.current.scene)) {
    lines.push(`- ${[novel.current.day, novel.current.place].filter(Boolean).join('，')}。${novel.current.scene ?? ''}`)
    if (novel.current.relationshipNote) lines.push(`- 关系：${novel.current.relationshipNote}`)
  } else {
    const beatFile = findChapterFor(root, to)
    const beat = beatFile ? readFileSync(join(root, 'analysis', 'beats', beatFile), 'utf8') : ''
    const overview = /##\s*概述\s*\n+([\s\S]*?)(?:\n##|\n\*\*情节节点)/.exec(beat)
    lines.push(overview ? overview[1].trim() : `- 以第 ${to} 轮（轮次）那一幕为准：这段时间没有分章概述，按下面「说过的话」和最近原文还原。`)
  }
  lines.push('')
  lines.push('## 说过的话')
  lines.push('')
  for (const round of rounds) {
    if ((round.i - from) % every !== 0 && round.i !== to) continue
    const said = firstSentence(round.user?.text)
    const answered = firstSentence(round.ai?.text)
    lines.push(`- **第${round.i}轮** 她：${said || '（只有动作）'}`)
    lines.push(`  他：${answered || '（只有动作）'}`)
  }
  lines.push('')
  lines.push('## 末轮状态')
  lines.push('')
  lines.push(`- 她最后一句：${firstSentence(last.user?.text) || '（只有动作）'}`)
  lines.push(`- 他最后一句：${firstSentence(last.ai?.text) || '（只有动作）'}`)
  const status = /```(?:text)?\s*\n?状态栏([\s\S]*?)```/.exec(String(last.ai?.text ?? ''))
  if (status) {
    lines.push('')
    lines.push('```text')
    lines.push(`状态栏${status[1].trimEnd()}`)
    lines.push('```')
  }
  if ((novel.current?.openThreads ?? []).length > 0) {
    lines.push('')
    lines.push('## 还没落地的事')
    lines.push('')
    for (const thread of novel.current.openThreads) lines.push(`- ${thread}`)
  }
  return `${lines.join('\n')}\n`
}

function findChapterFor(root, round) {
  const beatsDir = join(root, 'analysis', 'beats')
  try {
    const files = readdirSync(beatsDir).filter((name) => /^block_.*\.md$/.test(name))
    for (const name of files) {
      const text = readFileSync(join(beatsDir, name), 'utf8')
      const heading = /###\s*第\d+章[^\n]*（第(\d+)—(\d+)轮）/.exec(text)
      if (heading && round >= Number(heading[1]) && round <= Number(heading[2])) return name
    }
  } catch { /* beats not written yet */ }
  return null
}

export function saveCard(outDir, { from, to, text, title }) {
  if (!Number.isFinite(Number(from)) || !Number.isFinite(Number(to))) {
    throw new Error('记忆卡要写清楚覆盖的起始轮与结束轮')
  }
  const start = Number(from)
  const end = Number(to)
  if (end < start) throw new Error(`轮次区间反了：${start}—${end}`)
  const dir = ensureDir(memoryPath(outDir))
  const name = `记忆_${String(start).padStart(4, '0')}-${String(end).padStart(4, '0')}.md`
  const body = String(text ?? '').trim()
  if (body === '') throw new Error('记忆卡是空的')
  const head = /^#\s/.test(body) ? '' : `# 记忆_${start}-${end}${title ? ` · ${title}` : ''}\n\n`
  const payload = `${head}${body}\n`
  const file = join(dir, name)
  writeText(file, payload)
  rebuildIndex(outDir)
  return { file, name, from: start, to: end, chars: payload.length }
}

/** One md file listing every card plus the work-folder settings. */
export function rebuildIndex(outDir) {
  const root = resolve(String(outDir ?? '.'))
  const cards = listCards(root)
  const settings = listSettingFiles(root)
  const lines = []
  lines.push('# 记忆与设定索引')
  lines.push('')
  lines.push('> 这个文件由插件维护。续接时它会被读进 prompt：先看索引，再翻最近两张卡与检索到的片段。')
  lines.push('')
  lines.push('## 记忆卡')
  lines.push('')
  if (cards.length === 0) {
    lines.push('（还没有记忆卡。整理完对话后，在面板里点「生成记忆卡」，或者让 agent 每 20—50 轮存一张。）')
  } else {
    lines.push('| 文件 | 轮次 | 字数 | 标题 |')
    lines.push('| --- | --- | --- | --- |')
    for (const card of cards) {
      const text = readFileSync(card.file, 'utf8')
      const title = (/^#\s*记忆_\d+-\d+(?:\s*·\s*(.+))?$/m.exec(text)?.[1] ?? '').trim()
      lines.push(`| ${card.name} | 第 ${card.from}—${card.to} 轮 | ${Math.round(card.size / 2)} | ${title} |`)
    }
  }
  lines.push('')
  lines.push('## 工作目录里的设定')
  lines.push('')
  if (settings.length === 0) {
    lines.push('（没有找到人设/规则文件。把 .md/.txt 放进 `设定/`，或直接用面板上传。）')
  } else {
    for (const item of settings) lines.push(`- ${item.name}（${item.chars} 字）`)
  }
  lines.push('')
  const file = join(ensureDir(memoryPath(root)), '00_索引.md')
  writeText(file, `${lines.join('\n')}\n`)
  return { file, cards: cards.length, settings: settings.length }
}

/** Setting/rule files the user keeps in the work folder. */
export function listSettingFiles(outDir) {
  const root = resolve(String(outDir ?? '.'))
  const found = []
  const dir = join(root, SETTING_DIR)
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name)
      if (!SETTING_RE.test(name) || !statSync(file).isFile()) continue
      found.push(folderItem(root, file, name))
    }
  }
  for (const name of readdirSync(root)) {
    if (!SETTING_RE.test(name)) continue
    if (!SETTING_HINT.test(name)) continue
    const file = join(root, name)
    if (!statSync(file).isFile()) continue
    found.push(folderItem(root, file, name))
  }
  // The setting that came with the share link counts as the base 人设 too.
  const shared = join(root, 'share', 'setting.txt')
  if (existsSync(shared) && !found.some((item) => item.file === shared)) {
    found.push(folderItem(root, shared, '对话附件里的设定.txt'))
  }
  // The character bible the agent writes is the authoritative 人设 once it exists.
  const bible = join(root, '02_人物设定.md')
  if (existsSync(bible) && !found.some((item) => item.file === bible)) found.push(folderItem(root, bible, '02_人物设定.md'))
  return found.sort((a, b) => a.rel.localeCompare(b.rel))
}

function folderItem(root, file, name) {
  const text = readFileSync(file, 'utf8')
  return { name, rel: relative(root, file), file, chars: text.length, text }
}

/**
 * Keyword recall over memory cards, chapter beats and setting files — the
 * "knowledge base" lookup used when a continuation prompt is assembled.
 */
export function recall(outDir, query, { limit = 6, budget = 4000 } = {}) {
  const root = resolve(String(outDir ?? '.'))
  const terms = String(query ?? '')
    .split(/[\s,，、。；;：:\n]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
  if (terms.length === 0) return []

  const files = []
  for (const card of listCards(root)) {
    files.push({ kind: '记忆卡', name: card.name, file: card.file, text: readFileSync(card.file, 'utf8') })
  }
  const beatsDir = join(root, 'analysis', 'beats')
  if (existsSync(beatsDir)) {
    for (const name of readdirSync(beatsDir)) {
      if (!/^block_.*\.md$/.test(name)) continue
      files.push({ kind: '章节', name, file: join(beatsDir, name), text: readFileSync(join(beatsDir, name), 'utf8') })
    }
  }
  for (const setting of listSettingFiles(root)) files.push({ kind: '设定', name: setting.name, file: setting.file, text: setting.text })

  const hits = []
  for (const item of files) {
    let score = 0
    for (const term of terms) {
      let index = item.text.indexOf(term)
      let times = 0
      while (index !== -1 && times < 20) {
        times += 1
        score += item.kind === '记忆卡' ? 3 : item.kind === '设定' ? 2 : 1
        index = item.text.indexOf(term, index + term.length)
      }
    }
    if (score === 0) continue
    hits.push({ ...item, score })
  }
  hits.sort((a, b) => b.score - a.score)
  const picked = []
  let used = 0
  for (const hit of hits) {
    const snippet = snippetAround(hit.text, terms, 240)
    if (used + snippet.length > budget) break
    used += snippet.length
    picked.push({ kind: hit.kind, name: hit.name, score: hit.score, snippet })
    if (picked.length >= limit) break
  }
  return picked
}

function snippetAround(text, terms, span) {
  let at = -1
  for (const term of terms) {
    const index = text.indexOf(term)
    if (index !== -1 && (at === -1 || index < at)) at = index
  }
  if (at === -1) at = 0
  const start = Math.max(0, at - Math.floor(span / 3))
  const body = text.slice(start, start + span).replace(/\s*\n\s*/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${body}${start + span < text.length ? '…' : ''}`
}
