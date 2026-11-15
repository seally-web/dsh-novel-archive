/**
 * A compact snapshot of one archive directory, used by the panel UI and by
 * `novel_archive_continue`. Everything here is read-only and cheap: stats.json,
 * novel.json, a directory listing, and the last round of turns.jsonl.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readJson, listFiles } from './util.js'

function countLines(file) {
  if (!existsSync(file)) return 0
  const text = readFileSync(file, 'utf8')
  if (text.trim() === '') return 0
  return text.split('\n').filter((line) => line.trim() !== '').length
}

/** Last turn from turns.jsonl without loading the whole file. */
export function lastRound(turnsFile) {
  if (!existsSync(turnsFile)) return null
  const text = readFileSync(turnsFile, 'utf8').trim()
  if (text === '') return null
  const at = text.lastIndexOf('\n')
  const line = at === -1 ? text : text.slice(at + 1)
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

/** All rounds. Only call this when the transcript is actually needed. */
export function readTurns(turnsFile) {
  if (!existsSync(turnsFile)) throw new Error(`找不到 ${turnsFile}，先整理一次`)
  const text = readFileSync(turnsFile, 'utf8')
  const rounds = []
  let index = 0
  for (const line of text.split('\n')) {
    index += 1
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      rounds.push(normaliseRound(JSON.parse(trimmed), index))
    } catch {
      /* skip a broken line rather than failing the whole pack */
    }
  }
  return rounds
}

/** Accept both the plugin's shape ({i,user:{text},ai:{text}}) and the older
 *  hand-made one ({user:{id,body,think},ai:{id,body,think}}). */
function normaliseRound(raw, index) {
  if (!raw || typeof raw !== 'object') return raw
  const user = raw.user ?? {}
  const ai = raw.ai ?? {}
  // 老档案的 time 是 unix 秒，补出可读时间与日期卷名
  const stamp = timeOf(user.time ?? ai.time)
  return {
    ...raw,
    i: raw.i ?? index,
    user: {
      ...user,
      text: user.text ?? user.body ?? '',
      ...(user.day ? {} : stamp.day ? { day: stamp.day } : {}),
      ...(typeof user.time === 'string' ? {} : stamp.time ? { time: stamp.time } : {}),
    },
    ai: ai && typeof ai === 'object' ? { ...ai, text: ai.text ?? ai.body ?? '', think: ai.think ?? '' } : null,
  }
}

function timeOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value * 1000)
    if (Number.isNaN(date.getTime())) return {}
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date).reduce((map, item) => ({ ...map, [item.type]: item.value }), {})
    const day = `${parts.year}-${parts.month}-${parts.day}`
    return { day, time: `${day} ${parts.hour}:${parts.minute}:${parts.second}` }
  }
  if (typeof value === 'string' && value.length >= 10) return { day: value.slice(0, 10), time: value }
  return {}
}

export function readState(outDir) {
  const root = resolve(String(outDir ?? '.'))
  const analysisDir = join(root, 'analysis')
  const turnsFile = join(analysisDir, 'turns.jsonl')
  if (!existsSync(turnsFile)) {
    return {
      dir: root,
      exists: false,
      reason: '这个目录还没整理过（缺 analysis/turns.jsonl）',
    }
  }

  const statsFile = readJson(join(analysisDir, 'stats.json'), {})
  const stats = statsFile?.stats ?? {}
  const novel = readJson(join(root, 'novel.json'), null)
  const chunksFile = readJson(join(analysisDir, 'chunks.json'), null)
  const chunks = Array.isArray(chunksFile)
    ? chunksFile
    : listFiles(join(analysisDir, 'chunks'), /^chunk_.*\.md$/)
  const beats = listFiles(join(analysisDir, 'beats'), /^block_.*\.md$/)
  const packDir = join(root, '续接包')
  const packFiles = listFiles(packDir, /^0[0-9].*\.(md|txt)$/)
  const oneShot = listFiles(packDir, /^07_.*\.md$/)
  const last = lastRound(turnsFile)
  const roundCount = stats.rounds ?? countLines(turnsFile)
  const roundEnd = typeof last?.i === 'number' ? last.i : roundCount

  return {
    dir: root,
    exists: true,
    sourceUrl: statsFile?.sourceUrl ?? '',
    rounds: roundCount,
    lastRound: roundEnd || null,
    nextRound: (roundEnd || 0) + 1,
    totalChars: stats.totalChars ?? 0,
    firstAt: stats.firstAt ?? '',
    lastAt: stats.lastAt ?? '',
    days: (stats.byDay ?? []).length,
    chunks: chunks.length,
    beats: beats.length,
    hasNovel: Boolean(novel),
    hasBible: existsSync(join(root, '02_人物设定.md')),
    hasPlot: existsSync(join(root, '03_情节发展.md')),
    hasPack: packFiles.length > 0,
    hasOneShot: oneShot.length > 0,
    hasZip: listFiles(root, /\.zip$/).length > 0,
    settings: existsSync(join(root, 'share', 'setting.txt'))
      ? readFileSync(join(root, 'share', 'setting.txt'), 'utf8').length
      : 0,
    novel: novel
      ? {
          title: novel.title ?? '',
          hero: novel.ai?.name ?? novel.aiLabel ?? '',
          girl: novel.user?.name ?? novel.userLabel ?? '',
          affection: novel.current?.affection ?? '',
          day: novel.current?.day ?? '',
          place: novel.current?.place ?? '',
          lastAiQuote: novel.current?.lastAiQuote ?? '',
          volumes: Array.isArray(novel.volumes)
            ? novel.volumes.length
            : (novel.volumes?.items ?? novel.volumes?.volumes ?? []).length,
        }
      : null,
    lastUserText: String(last?.user?.text ?? '').slice(0, 200),
    lastAiText: String(last?.ai?.text ?? '').slice(0, 200),
  }
}
