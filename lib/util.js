import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const TZ = 'Asia/Shanghai'

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** Epoch seconds (fractional allowed) -> { day: '2026-10-17', time: '02:29:48' } */
export function stamp(epochSeconds) {
  const date = new Date(Number(epochSeconds) * 1000)
  return { day: dayFmt.format(date), time: timeFmt.format(date) }
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
  return dir
}

export function writeText(file, text) {
  ensureDir(dirname(file))
  writeFileSync(file, text, 'utf8')
  return file
}

export function writeJson(file, value) {
  return writeText(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function readText(file) {
  return readFileSync(file, 'utf8')
}

export function has(file) {
  return existsSync(file)
}

export function listFiles(dir, pattern) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => pattern.test(name)).sort()
}

/** Collapse the trailing ```text status block of an assistant reply into one line. */
export function compressStatusBar(body) {
  const fence = /```(?:text)?\s*\n([\s\S]*?)```/g
  return String(body ?? '').replace(fence, (match, inner) => {
    const lines = inner.split('\n').map((line) => line.trim()).filter(Boolean)
    if (lines.length === 0) return ''
    const joined = lines
      .map((line) => line.replace(/^状态栏[：:]?\s*/, ''))
      .join('；')
      .replace(/\s*\n\s*/g, ' ')
    return `【状态栏】${joined}`
  })
}

export function pad(n, width = 2) {
  return String(n).padStart(width, '0')
}

export function chars(text) {
  return String(text ?? '').length
}

export function shareIdOf(url) {
  const match = /(?:share\/|share_id=)([A-Za-z0-9]+)/.exec(String(url ?? ''))
  if (!match) throw new Error('URL 里找不到分享 id（形如 https://chat.deepseek.com/share/xxxxxxxx）')
  return match[1]
}

export function sum(numbers) {
  return numbers.reduce((total, value) => total + value, 0)
}

export function bullet(lines, prefix = '- ') {
  return lines.map((line) => `${prefix}${line}`).join('\n')
}

export function table(rows, header) {
  const head = `| ${header.join(' | ')} |`
  const sep = `| ${header.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n')
  return `${head}\n${sep}\n${body}`
}

export function relFrom(base, file) {
  return file.startsWith(base) ? file.slice(base.length).replace(/^\//, '') : file
}

export { join }
