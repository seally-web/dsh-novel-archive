import { readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { listFiles, readJson, writeText, writeJson, ensureDir, relFrom, shareIdOf } from './util.js'
import { loadNovel } from './novel.js'
import { buildTranscript, buildChunk, buildRecent, dayTitle } from './render.js'
import { listSettingFiles, recall, rebuildIndex, recentCards } from './memory.js'
import { readKb, scaffold, syncKb, writeRuleSources } from './kb.js'
import { readTurns } from './state.js'
import {
  buildGuide,
  buildInstruction,
  buildBackstory,
  buildMemoryTemplate,
  buildVoice,
  buildAnchor,
  buildOneShot,
} from './pack.js'
import { zipBuffer } from './zip.js'

/* ------------------------------------------------------------------ */
/* extract                                                             */
/* ------------------------------------------------------------------ */

export function writeArchive({
  outDir,
  rounds,
  stats,
  messages,
  sourceUrl,
  contentBuffer,
  attachment,
  settingText,
  uploads,
  chunkSize,
}) {
  ensureDir(outDir)
  const shareDir = ensureDir(join(outDir, 'share'))
  const analysisDir = ensureDir(join(outDir, 'analysis'))
  const chunksDir = ensureDir(join(analysisDir, 'chunks'))
  const beatsDir = ensureDir(join(analysisDir, 'beats'))
  const charsDir = ensureDir(join(analysisDir, 'chars'))
  ensureDir(join(outDir, '续接包'))

  writeFileSync(join(shareDir, 'content.json'), contentBuffer)

  // Keep every user upload verbatim next to the share payload ...
  const uploadList = Array.isArray(uploads) ? uploads : []
  if (uploadList.length > 0) {
    const uploadsDir = ensureDir(join(shareDir, 'uploads'))
    uploadList.forEach((item, index) => {
      const name = `${String(index + 1).padStart(2, '0')}_${item.kind === 'setting' ? '人设' : '补充'}_${item.name}`
      writeFileSync(join(uploadsDir, name.replace(/[\\/:*?"<>|]/g, '_')), String(item.text ?? ''), 'utf8')
    })
    writeJson(join(shareDir, 'uploads', 'index.json'), uploadList.map((item, index) => ({
      index: index + 1,
      name: item.name,
      kind: item.kind,
      chars: String(item.text ?? '').length,
    })))
    // Mirror them into 设定/ so every later continuation reads the work folder
    // directly instead of relying on one pasted prompt.
    const settingDir = ensureDir(join(outDir, '设定'))
    uploadList.forEach((item, index) => {
      const kind = item.kind === 'setting' ? '人设' : '补充'
      const base = `${String(index + 1).padStart(2, '0')}_${kind}_${item.name}`.replace(/[\\/:*?"<>|]/g, '_')
      const target = `${base}.md`.replace(/\.md\.md$/i, '.md')
      writeFileSync(join(settingDir, target), String(item.text ?? ''), 'utf8')
    })
  }

  // ... and write the merged settings document the agent actually reads.
  let settingFile = null
  if (attachment) writeFileSync(join(shareDir, attachment.name), attachment.buffer)
  const mergedText = String(settingText ?? attachment?.text ?? '')
  if (mergedText !== '') {
    settingFile = join(shareDir, 'setting.txt')
    writeFileSync(settingFile, mergedText, 'utf8')
    // 上传的规则按段拆进 10_规则/，每份带出处（改哪条改哪份）
    try {
      writeRuleSources(outDir, { settingText: mergedText, uploads: uploadList })
    } catch {
      /* 拆规则失败不影响整理 */
    }
  }

  const turnsFile = join(analysisDir, 'turns.jsonl')
  const lines = rounds.map((round) => JSON.stringify(round))
  writeFileSync(turnsFile, `${lines.join('\n')}\n`, 'utf8')

  writeFileSync(join(analysisDir, 'fulltext.txt'), rounds.map((round) => String(round.ai?.text ?? '')).join('\n'), 'utf8')
  writeJson(join(analysisDir, 'stats.json'), { sourceUrl, stats, chunkSize, settingFile })

  const chunkFiles = []
  for (let index = 0; index < rounds.length; index += chunkSize) {
    const from = rounds[index].i
    const to = rounds[Math.min(index + chunkSize, rounds.length) - 1].i
    const file = join(chunksDir, `chunk_${String(chunkFiles.length + 1).padStart(2, '0')}.md`)
    writeFileSync(file, buildChunk(rounds, from, to, '用户', 'AI'), 'utf8')
    chunkFiles.push({ index: chunkFiles.length + 1, from, to, file })
  }
  writeJson(join(analysisDir, 'chunks.json'), chunkFiles)

  const transcript = buildTranscript(rounds, {
    title: '待定（写完 novel.json 后可用 novel_archive_assemble 重建）',
    sourceUrl,
    exportedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    userLabel: '用户',
    aiLabel: 'AI',
    stats,
  })
  const transcriptFile = join(outDir, '01_完整对话记录.md')
  writeFileSync(transcriptFile, transcript, 'utf8')

  const plan = buildPlan({ outDir, stats, chunkFiles, sourceUrl })
  writeFileSync(join(outDir, 'PLAN.md'), plan, 'utf8')

  const novelStub = {
    title: '（填书名）',
    userLabel: '（女主名）',
    aiLabel: '（男主名）',
    user: { name: '', age: null, identity: '', home: '', body: '', callName: '' },
    ai: { name: '', age: null, identity: '', home: '', body: '', traits: [] },
    relationship: '',
    storyline: '',
    current: {
      round: stats.rounds,
      day: '',
      place: '',
      scene: '',
      lastUserQuote: '',
      lastAiQuote: '',
      affection: '',
      relationshipNote: '',
      openThreads: [],
    },
    rules: { pov: '', lengthLine: '', style: [], deny: [], statusBar: { fields: ['心情', '好感度', '衣着', '想法'] } },
    memory: { people: [], events: [], objects: [], promises: [], mistakes: [] },
    voice: { samples: [], allowWords: [], denyWords: [], nowTone: [] },
    volumes: { mainline: '', lines: [], items: [] },
    pack: { tailRounds: 60, partRounds: 30 },
    oneShotMemory: [],
  }
  writeJson(join(outDir, 'analysis', 'novel.example.json'), novelStub)

  return {
    outDir,
    transcriptFile,
    turnsFile,
    chunksDir,
    beatsDir,
    charsDir,
    shareDir,
    settingFile,
    chunkCount: chunkFiles.length,
    chunkFiles,
    stats,
  }
}

function buildPlan({ outDir, stats, chunkFiles, sourceUrl }) {
  const lines = []
  lines.push('# 整理计划（给 agent 读的，不是给用户读的）')
  lines.push('')
  lines.push(`- 来源：${sourceUrl}`)
  lines.push(`- 规模：${stats.rounds} 轮，正文＋思考 ${stats.totalChars} 字符`)
  lines.push(`- 工作目录：\`${outDir}\``)
  lines.push('')
  lines.push('## 已完成（插件自动做的）')
  lines.push('')
  lines.push('- `01_完整对话记录.md`：逐轮全文（这一步先给用户看规模，书名等写完 novel.json 后会重建）')
  lines.push('- `analysis/turns.jsonl`：每行一轮，`{i, user:{text,think,files,day,time}, ai:{...}}`')
  lines.push('- `analysis/chunks/chunk_NN.md`：每块一章的素材，AI 状态栏已压成一行')
  lines.push('- `analysis/stats.json`、`analysis/novel.example.json`、本文件')
  lines.push('')
  lines.push('## 下一步：写 novel.json（决定所有交付物的口径）')
  lines.push('')
  lines.push('把 `analysis/novel.example.json` 复制成 `<工作目录>/novel.json`，按真实内容填：')
  lines.push('')
  lines.push('- `title` / `userLabel` / `aiLabel`：书名、女主名、男主名（用对话里真实的称呼）')
  lines.push('- `user` / `ai`：年龄、身份、住处、身体、称呼、性格要点')
  lines.push('- `relationship`：两人关系一句话')
  lines.push('- `current`：最后一轮的时间、地点、场景、双方最后一句、感情进度、未收线索')
  lines.push('- `rules`：视角、篇幅、风格、禁词、状态栏四项')
  lines.push('- `memory`：身边人、关键事件（带轮次）、物件、他说过的原话（带轮次）、最容易记错的事')
  lines.push('- `voice.samples`：按场景分组的原句摘录，每条带轮次')
  lines.push('- `volumes`：全书主线一句话、三条线、分卷表（标题/起止轮/卷首语）')
  lines.push('')
  lines.push('## 下一步：分章（LLM 部分，逐块并行）')
  lines.push('')
  lines.push(`共 ${chunkFiles.length} 块、每块一章。对每块让一个子代理读 \`chunk_NN.md\`，写出：`)
  lines.push('')
  lines.push('- `analysis/beats/block_NN.md`：')
  lines.push('')
  lines.push('```markdown')
  lines.push('### 第N章 四到八字标题（第a—b轮）')
  lines.push('')
  lines.push('**概述**：250—400 字，写清这一段发生了什么、关系怎么变。')
  lines.push('')
  lines.push('**情节节点**')
  lines.push('')
  lines.push('1. （第 a—b 轮）……（10—14 条，每条带轮次）')
  lines.push('')
  lines.push('**关系刻度**：80—150 字，写这一章结束时两人的距离与情绪。')
  lines.push('```')
  lines.push('')
  lines.push('- `analysis/chars/chunk_NN.json`：`{"characters":[{"name","facts":[]}],"settings":[],"places":[],"objects":[],"timeline":[]}`')
  lines.push('')
  lines.push('## 下一步：写人物设定')
  lines.push('')
  lines.push('写 `<工作目录>/02_人物设定.md`（照 02 的旧体例：故事世界 → 男主 → 女主 → 配角 → 关系 → 地点 → 物件 → 写作规则 → 人物小传）。')
  lines.push('')
  lines.push('## 最后：装配')
  lines.push('')
  lines.push('调 `novel_archive_assemble`：它会重建 01、生成 03、续接包 00—07，并打 zip。')
  lines.push('')
  return `${lines.join('\n')}\n`
}

/* ------------------------------------------------------------------ */
/* assemble                                                            */
/* ------------------------------------------------------------------ */

function readRounds(turnsFile) {
  // 走 readTurns：兼容老档案（body/files/unix 秒）并补出 day 与 i
  return readTurns(turnsFile)
}

function parseBeat(text, fallbackIndex) {
  const heading = /^###\s*第\s*(\d+)\s*章\s*(.*?)（第\s*(\d+)\s*[—\-–~]\s*(\d+)\s*轮）/m.exec(text)
  if (!heading) return null
  const body = text.slice(heading.index + heading[0].length).trim()
  const summaryMatch = /\*\*概述\*\*[：:]\s*([\s\S]*?)(?=\n\s*\*\*|$)/.exec(body)
  return {
    n: Number(heading[1]) || fallbackIndex,
    title: heading[2].trim(),
    from: Number(heading[3]),
    to: Number(heading[4]),
    body,
    summary: summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim() : '',
  }
}

/**
 * `volumes` may be written either in the plugin's own shape
 * (`{ mainline, lines, items: [{ title, from, to, intro }] }`) or as the
 * chapter-number form a writer often produces
 * (`{ mainline, volumes: [{ name, chapters: [1, 2, …], intro }] }`).
 * Normalise both to round ranges before laying out the outline.
 */
function normaliseVolumes(novel, chapters) {
  const raw = novel.volumes ?? {}
  const byChapter = new Map(chapters.map((chapter) => [chapter.n, chapter]))
  const spanOf = (entry) => {
    if (Number.isFinite(entry?.from) && Number.isFinite(entry?.to)) return { from: entry.from, to: entry.to }
    const numbers = Array.isArray(entry?.chapters) ? entry.chapters.filter((n) => byChapter.has(n)) : []
    if (numbers.length === 0) return { from: 0, to: 0 }
    const picked = numbers.map((n) => byChapter.get(n))
    return { from: Math.min(...picked.map((c) => c.from)), to: Math.max(...picked.map((c) => c.to)) }
  }
  const source = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.items) && raw.items.length > 0
      ? raw.items
      : Array.isArray(raw.volumes)
        ? raw.volumes
        : []
  const items = []
  for (const entry of source) {
    const title = entry.title ?? entry.name ?? '（未命名卷）'
    const { from, to } = spanOf(entry)
    items.push({ title, from, to, intro: entry.intro ?? entry.preface ?? '' })
  }
  return { mainline: (Array.isArray(raw) ? '' : raw.mainline) ?? '', lines: !Array.isArray(raw) && Array.isArray(raw.lines) ? raw.lines : [], items: items.filter((entry) => entry.from > 0) }
}

function buildPlot(novel, chapters) {
  const volumes = normaliseVolumes(novel, chapters)
  // 没配分卷时给一个兜底卷，否则章目表与正文会整段消失
  if (volumes.items.length === 0 && chapters.length > 0) {
    const from = Math.min(...chapters.map((chapter) => chapter.from))
    const to = Math.max(...chapters.map((chapter) => chapter.to))
    volumes.items.push({ title: '全书', from, to, intro: '' })
  }
  const lines = []
  lines.push(`# 情节发展｜《${novel.title ?? ''}》`)
  lines.push('')
  lines.push('> **整理范围**：全书逐轮梳理，按 80 轮一章切分，共 ' + `${chapters.length} 章。`)
  lines.push('> **体例**：每章标题带轮次区间；概述 250—400 字；情节节点 10—14 条，每条带轮次；关系刻度 80—150 字。')
  lines.push('> **提醒**：轮次编号与《完整对话记录》一致，可以对着原文核对。')
  lines.push('')
  lines.push('## 全书主线')
  lines.push('')
  lines.push(volumes.mainline || '（未配置 volumes.mainline）')
  lines.push('')
  const storyLines = volumes.lines
  if (storyLines.length > 0) {
    lines.push('### 三条线')
    lines.push('')
    lines.push('| 线 | 内容 |')
    lines.push('| --- | --- |')
    for (const item of storyLines) lines.push(`| ${item.line} | ${item.content} |`)
    lines.push('')
  }
  lines.push('### 分卷与章目')
  lines.push('')
  lines.push('| 卷 | 章 | 轮次 | 标题 |')
  lines.push('| --- | --- | --- | --- |')
  for (const volume of volumes.items) {
    const inside = chapters.filter((chapter) => chapter.from >= volume.from && chapter.from <= volume.to)
    for (const chapter of inside) {
      lines.push(`| ${volume.title} | 第${chapter.n}章 | 第${chapter.from}—${chapter.to}轮 | ${chapter.title} |`)
    }
  }
  lines.push('')

  for (const volume of volumes.items) {
    const inside = chapters.filter((chapter) => chapter.from >= volume.from && chapter.from <= volume.to)
    if (inside.length === 0) continue
    lines.push(`## ${volume.title}（第 ${volume.from}—${volume.to} 轮）`)
    lines.push('')
    if (volume.intro) {
      lines.push(volume.intro)
      lines.push('')
    }
    for (const chapter of inside) {
      lines.push(`### 第${chapter.n}章 ${chapter.title}（第${chapter.from}—${chapter.to}轮）`)
      lines.push('')
      lines.push(chapter.body)
      lines.push('')
    }
  }
  return `${lines.join('\n')}\n`
}

function txtPair(dir, name, content) {
  const md = writeText(join(dir, `${name}.md`), content)
  const txt = writeText(join(dir, `${name}.txt`), content)
  return [md, txt]
}

export function assembleArchive({ outDir, makeZip = true, tailRounds, partRounds }) {
  const root = resolve(outDir)
  const analysisDir = join(root, 'analysis')
  const turnsFile = join(analysisDir, 'turns.jsonl')
  if (!existsSync(turnsFile)) throw new Error(`找不到 ${turnsFile}，先运行 novel_archive_extract`)

  const rounds = readRounds(turnsFile)
  const stats = readJson(join(analysisDir, 'stats.json'), null)?.stats ?? { rounds: rounds.length, totalChars: 0 }
  // 没有 novel.json 时按设定自动推断一份（并在结果里提醒用户过一遍）
  const loaded = loadNovel(root, { rounds })
  const novel = loaded.novel

  const warnings = []
  const beatsDir = join(analysisDir, 'beats')
  const beatFiles = listFiles(beatsDir, /^block_.*\.md$/)
  const chapters = []
  for (const [index, name] of beatFiles.entries()) {
    const text = readFileSync(join(beatsDir, name), 'utf8')
    const chapter = parseBeat(text, index + 1)
    if (chapter) chapters.push(chapter)
    else warnings.push(`${name} 里没有「### 第N章 …（第a—b轮）」标题，已跳过`)
  }
  chapters.sort((a, b) => a.n - b.n)

  const chunkInfo = readJson(join(analysisDir, 'chunks.json'), [])
  if (chunkInfo.length > 0 && chapters.length < chunkInfo.length) {
    warnings.push(`章节不齐：应有 ${chunkInfo.length} 章，现有 ${chapters.length} 章（还差 ${chunkInfo.length - chapters.length} 块）`)
  }

  const bibleFile = join(root, '02_人物设定.md')
  let bibleRaw = ''
  if (existsSync(bibleFile)) {
    bibleRaw = readFileSync(bibleFile, 'utf8')
    const bible = bibleRaw.replace(/^# .*\n+/, '').replace(/^## /gm, '### ')
    novel.bible = bible
  } else {
    warnings.push('没有 02_人物设定.md：续接包里的「设定与前情提要」会缺人物部分')
  }

  const built = []

  // 知识库：把剧情、角色、规则、时间线、事件簿写进模块化目录（工作目录就是大脑）
  const settingText = existsSync(join(root, 'share', 'setting.txt')) ? readFileSync(join(root, 'share', 'setting.txt'), 'utf8') : ''
  scaffold(root, { novel, settingText })
  const kbSync = syncKb(root, { novel, chapters, settingText, bibleText: bibleRaw || novel.bible || '' })

  // 01 transcript with real labels
  const transcript = buildTranscript(rounds, {
    title: novel.title ?? '未命名',
    sourceUrl: readJson(join(analysisDir, 'stats.json'), null)?.sourceUrl ?? '',
    exportedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    userLabel: novel.userLabel ?? novel.user?.name ?? '用户',
    aiLabel: novel.aiLabel ?? novel.ai?.name ?? 'AI',
    stats,
    intro: novel.readingNote,
  })
  const transcriptFile = writeText(join(root, '01_完整对话记录.md'), transcript)
  built.push(transcriptFile)

  // 03 plot
  const plotFile = writeText(join(root, '03_情节发展.md'), buildPlot(novel, chapters))
  built.push(plotFile)

  // 续接包
  const packDir = ensureDir(join(root, '续接包'))
  const hero = novel.ai?.name ?? novel.aiLabel ?? '男主'
  const girl = novel.user?.name ?? novel.userLabel ?? '女主'
  const tail = Math.max(8, Math.min(rounds.length, Number(tailRounds ?? novel.pack?.tailRounds ?? 60)))
  const tailFrom = rounds[rounds.length - tail].i
  const tailTo = rounds[rounds.length - 1].i

  const guide = buildGuide(novel, stats)
  built.push(...txtPair(packDir, '00_使用说明', guide))

  const instruction = buildInstruction(novel)
  built.push(...txtPair(packDir, '01_直接粘贴_续接指令', instruction))

  const backstory = buildBackstory(novel, chapters)
  built.push(...txtPair(packDir, '02_设定与前情提要', backstory))

  const recent = buildRecent(rounds, tailFrom, tailTo, girl, hero)
  built.push(...txtPair(packDir, `03_最近原文_第${tailFrom}-${tailTo}轮`, recent))

  const part = Math.max(4, Math.ceil(tail / 2))
  const firstPartTo = rounds[rounds.length - tail + part - 1].i
  built.push(...txtPair(packDir, `03a_最近原文_第${tailFrom}-${firstPartTo}轮`, buildRecent(rounds, tailFrom, firstPartTo, girl, hero)))
  built.push(...txtPair(packDir, `03b_最近原文_第${firstPartTo + 1}-${tailTo}轮`, buildRecent(rounds, firstPartTo + 1, tailTo, girl, hero)))

  const memory = buildMemoryTemplate(novel)
  built.push(...txtPair(packDir, '04_滚动记忆模板', memory))

  const voice = buildVoice(novel)
  built.push(...txtPair(packDir, '05_语感样本', voice))

  const anchor = buildAnchor(novel)
  built.push(...txtPair(packDir, '06_记忆锚点', anchor))

  const oneShotTail = Math.min(8, tail)
  const oneShotFrom = rounds[rounds.length - oneShotTail].i
  const indexFile = join(root, '11_记忆卡', '00_索引.md')
  const oneShotContext = {
    kb: readKb(root, { budget: 15500 }),
    settings: listSettingFiles(root),
    cards: recentCards(root, 2).map((card) => ({ name: card.name, from: card.from, to: card.to, text: card.text })),
    index: existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : '',
    recalls: recall(root, `${rounds[rounds.length - 1]?.user?.text ?? ''} ${(novel.current?.openThreads ?? []).join(' ')}`, { limit: 5 }),
  }
  const oneShot = buildOneShot(novel, rounds, oneShotFrom, tailTo, oneShotContext)
  built.push(...txtPair(packDir, '07_一站式接续_整段粘贴', oneShot))

  rebuildIndex(root)
  const files = listFiles(packDir, /\.(md|txt)$/)
  let zipFile = null
  if (makeZip) {
    const entries = files.map((name) => ({ name: `续接包/${name}`, data: readFileSync(join(packDir, name)) }))
    zipFile = join(root, '小说续接包.zip')
    writeFileSync(zipFile, zipBuffer(entries))
    built.push(zipFile)
  }

  if (loaded.inferred) warnings.push('novel.json 是按设定自动推断的，人物/场景/进度请打开看一眼再改（改完重跑一次装配）')

  const report = {
    outDir: root,
    inferredNovel: loaded.inferred,
    chapters: chapters.length,
    expectedChapters: chunkInfo.length || null,
    tail: { from: tailFrom, to: tailTo },
    kb: { files: kbSync.written.length, events: kbSync.events },
    files: built.map((file) => ({ file: relFrom(root, file), bytes: statSync(file).size })),
    warnings,
  }
  writeJson(join(analysisDir, 'assemble-report.json'), report)
  return report
}
