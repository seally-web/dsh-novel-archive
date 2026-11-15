import { compressStatusBar, pad, chars, sum } from './util.js'

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export function cnNumber(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return String(value)
  if (n <= 10) return CN_NUM[n]
  if (n < 20) return `十${CN_NUM[n - 10]}`
  return String(n)
}

export function dayTitle(day) {
  const [year, month, date] = String(day).split('-')
  return `${year}年${Number(month)}月${Number(date)}日`
}

function details(think) {
  const text = String(think ?? '').trim()
  if (text === '') return ''
  return `<details><summary>思考过程</summary>\n\n${text}\n\n</details>\n\n`
}

/** 没有 analysis/stats.json 时，按 turns.jsonl 现算一份统计。 */
function deriveStats(rounds) {
  const byDay = new Map()
  let bodyChars = 0
  let thinkChars = 0
  for (const round of rounds) {
    const day = String(round.user?.day ?? round.ai?.day ?? '').slice(0, 10)
    const index = Number(round.i ?? 0)
    if (day) {
      const bucket = byDay.get(day)
      if (!bucket) byDay.set(day, { day, from: index, to: index, count: 1 })
      else {
        bucket.to = index
        bucket.count += 1
      }
    }
    thinkChars += String(round.ai?.think ?? '').length
    bodyChars += String(round.user?.text ?? '').length + String(round.ai?.text ?? '').length
  }
  const days = [...byDay.values()]
  return {
    rounds: rounds.length,
    totalChars: bodyChars + thinkChars,
    bodyChars,
    thinkChars,
    firstAt: String(rounds[0]?.user?.time ?? ''),
    lastAt: String(rounds[rounds.length - 1]?.ai?.time ?? ''),
    byDay: days,
  }
}

/** The single-file reading copy: 01_完整对话记录.md */
export function buildTranscript(rounds, options) {
  const { title, sourceUrl, exportedAt, userLabel, aiLabel, intro } = options
  // stats.json 缺失（或字段不全）时用轮次现算，避免老档案装配时崩
  const derived = deriveStats(rounds)
  const given = options.stats ?? {}
  const stats = {
    ...derived,
    ...given,
    rounds: given.rounds ?? derived.rounds,
    totalChars: given.totalChars ?? derived.totalChars,
    bodyChars: given.bodyChars ?? derived.bodyChars,
    thinkChars: given.thinkChars ?? derived.thinkChars,
    byDay: (given.byDay ?? derived.byDay).length > 0 ? (given.byDay ?? derived.byDay) : derived.byDay,
  }
  const now = exportedAt ?? new Date().toISOString()
  const lines = []

  lines.push(`# 完整对话记录｜《${title}》`)
  lines.push('')
  lines.push(`> **来源**：${sourceUrl}`)
  lines.push(`> **导出时间**：${now}`)
  lines.push(`> **规模**：${stats.rounds} 轮 · ${userLabel} ${stats.rounds} 条 · AI ${stats.rounds} 条`)
  lines.push(
    `> **字数**：正文＋思考 ${stats.totalChars.toLocaleString('en-US')} 字符（约 ${(stats.totalChars / 10000).toFixed(1)} 万字）；其中正文 ${stats.bodyChars.toLocaleString('en-US')}、思考 ${stats.thinkChars.toLocaleString('en-US')}`,
  )
  lines.push(`> **时间跨度**：${stats.firstAt} — ${stats.lastAt}（Asia/Shanghai）`)
  lines.push('> **整理口径**：逐轮完整保留，不改写、不略去；用户正文与 AI 正文逐字保留，AI 思考过程折叠在 `<details>` 内。')
  lines.push('> **轮次编号**：按「一问一答」计为一轮，编号即整理顺序，与原始对话顺序一致。')
  lines.push('')
  lines.push('## 阅读说明')
  lines.push('')
  lines.push('1. 按日期分卷，卷首标出该日的轮次区间；轮次编号全书连续。')
  lines.push('2. 每轮先列用户发言，再列 AI 回复；AI 回复若带思考过程，先折叠显示思考，再列正文。')
  lines.push('3. 状态栏、代码块、附件说明等原文格式一律保留，未做美化。')
  lines.push('4. 用户在同一轮里夹带的「题外话」写作要求，按原文保留，属于创作指令的一部分。')
  lines.push(`5. 本文件是完整底稿，体量大（约 ${(stats.totalChars / 10000).toFixed(0)} 万字），适合检索与存档；通读建议先看情节发展与人物设定。`)
  if (intro) {
    lines.push('')
    lines.push('## 卷首说明')
    lines.push('')
    lines.push(intro)
  }
  lines.push('')
  lines.push('## 日期目录')
  lines.push('')
  lines.push('| 日期 | 轮次 | 条数 |')
  lines.push('| --- | --- | --- |')
  for (const bucket of stats.byDay) {
    lines.push(`| ${dayTitle(bucket.day)} | 第 ${bucket.from}—${bucket.to} 轮 | ${bucket.count} |`)
  }
  lines.push('')

  let currentDay = null
  const buckets = new Map(stats.byDay.map((bucket) => [bucket.day, bucket]))
  for (const round of rounds) {
    const day = round.user.day ?? round.ai?.day ?? ''
    if (day !== currentDay) {
      currentDay = day
      const bucket = buckets.get(currentDay)
      lines.push(bucket
        ? `## ${dayTitle(currentDay)}（第 ${bucket.from}—${bucket.to} 轮）`
        : `## ${dayTitle(currentDay) || '未注明日期'}`)
      lines.push('')
    }

    lines.push(`### 第 ${round.i} 轮`)
    lines.push('')
    lines.push(`**${userLabel}（用户）**`)
    lines.push('')
    const userText = String(round.user.text ?? '').trim()
    lines.push(userText === '' ? '（本轮消息正文为空）' : userText)
    if (round.user.files.length > 0) {
      lines.push('')
      lines.push('**附件**')
      lines.push('')
      for (const file of round.user.files) {
        lines.push(`- ${file.name}（${(file.size / 1024).toFixed(1)}KB${file.isImage ? '，图片' : ''}）`)
      }
    }
    lines.push('')
    lines.push('**AI 回复**')
    lines.push('')
    if (!round.ai) {
      lines.push('（本轮没有 AI 回复）')
      lines.push('')
      continue
    }
    const think = details(round.ai.think)
    if (think) lines.push(think.trimEnd())
    const aiText = String(round.ai.text ?? '').trim()
    lines.push(aiText === '' ? '（AI 回复正文为空）' : aiText)
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

/** Chunk files used by the chapter-writing fan-out: 80 rounds each by default. */
export function buildChunk(rounds, from, to, userLabel, aiLabel) {
  const slice = rounds.filter((round) => round.i >= from && round.i <= to)
  const lines = []
  lines.push(`# 分章素材 · 第 ${from}—${to} 轮`)
  lines.push('')
  lines.push('> 用法：为这一区间写出「第 N 章」的概述、情节节点、关系刻度。只依据本文件的对话，不要臆造。')
  lines.push('> 说明：AI 回复末尾的状态栏已压成一行「【状态栏】」；其余正文逐字保留。')
  lines.push('')
  for (const round of slice) {
    lines.push(`## 第 ${round.i} 轮`)
    lines.push('')
    lines.push(`**${userLabel}**：${String(round.user.text ?? '').trim() || '（空）'}`)
    lines.push('')
    lines.push(`**${aiLabel}**：${compressStatusBar(round.ai?.text ?? '').trim() || '（空）'}`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

/** Verbatim tail rounds for the continuation pack. */
function stamp(part) {
  if (!part) return ''
  const day = String(part.day ?? '')
  let time = part.time
  if (typeof time === 'number' && Number.isFinite(time)) {
    const date = new Date(time * 1000)
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date).reduce((map, item) => ({ ...map, [item.type]: item.value }), {})
    time = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
  }
  time = String(time ?? '').trim()
  if (time === 'undefined' || time === 'null') time = ''
  if (time.startsWith(day) && day !== '') return time
  return [day, time].filter(Boolean).join(' ')
}

export function buildRecent(rounds, from, to, userLabel, aiLabel) {
  const slice = rounds.filter((round) => round.i >= from && round.i <= to)
  const lines = []
  lines.push(`# 最近原文：第 ${from}—${to} 轮`)
  lines.push('')
  lines.push('> 用途：续接时喂给模型的语言样本。它模仿最近看到的句子，比遵守规则可靠。')
  lines.push(`> 覆盖：第 ${from}—${to} 轮，共 ${slice.length} 轮，逐字原文，含状态栏。`)
  lines.push('')
  for (const round of slice) {
    lines.push(`## 第 ${round.i} 轮 · ${userLabel}（用户）`)
    lines.push('')
    lines.push(`> ${stamp(round.user) || '（时间未记）'}`)
    lines.push('')
    lines.push(String(round.user.text ?? '').trim() || '（空）')
    lines.push('')
    if (!round.ai) continue
    lines.push(`## 第 ${round.i} 轮 · AI（${aiLabel}）`)
    lines.push('')
    lines.push(`> ${stamp(round.ai) || '（时间未记）'}`)
    lines.push('')
    const think = String(round.ai.think ?? '').trim()
    if (think) {
      lines.push('**【思考过程】**')
      lines.push('')
      lines.push(think)
      lines.push('')
    }
    lines.push('**【正文】**')
    lines.push('')
    lines.push(String(round.ai.text ?? '').trim() || '（空）')
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

/** Split a long verbatim block in two halves at a round boundary. */
export function splitRounds(rounds) {
  const half = Math.ceil(rounds.length / 2)
  return [rounds.slice(0, half), rounds.slice(half)]
}

export { pad, chars, sum }
