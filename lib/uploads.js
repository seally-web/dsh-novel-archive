/**
 * User-supplied source material.
 *
 * Besides the share link, the user can hand us their own 人设 (original
 * character setting) and 补充文件 (extra notes, rules, later plot). They come in
 * two shapes:
 *   - `uploads`: [{ name, kind: 'setting' | 'extra', text }] — sent by the panel
 *     UI, which reads the file in the browser.
 *   - `settingPaths` / `extraPaths`: absolute paths on disk, read here.
 *
 * Everything is merged into `share/setting.txt` so the agent (and the
 * continuation pack) sees one authoritative settings document.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { docxToText } from './docx.js'

const MAX_BYTES = 8 * 1024 * 1024

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
      if (code[0] === '#') {
        const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : whole
      }
      return ENTITIES[code.toLowerCase()] ?? whole
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decode(name, buffer) {
  if (/\.docx$/i.test(name)) return docxToText(buffer)
  if (/\.(html?|mht|mhtml)$/i.test(name)) return stripHtml(buffer.toString('utf8'))
  if (/\.pdf$/i.test(name)) throw new Error('PDF 先转成 docx/txt 再放进来（插件不解析 PDF）')
  return buffer.toString('utf8')
}

/** Read one file from disk into a setting/extra upload record. */
export function readUpload(path, kind) {
  const name = basename(String(path))
  const size = statSync(path).size
  if (size > MAX_BYTES) throw new Error(`${name} 超过 8MB，先拆小一点`)
  return { name, kind, text: decode(name, readFileSync(path)) }
}

/** Collect uploads from tool arguments; returns { uploads, problems }. */
export function collectUploads(args) {
  const uploads = []
  const problems = []

  const inline = Array.isArray(args?.uploads) ? args.uploads : []
  for (const item of inline) {
    const rawName = String(item?.name ?? '未命名文件').trim() || '未命名文件'
    const kind = item?.kind === 'setting' ? 'setting' : 'extra'
    let text = String(item?.text ?? '')
    if (text.trim() === '' && typeof item?.base64 === 'string' && item.base64 !== '') {
      try {
        text = decode(rawName, Buffer.from(item.base64, 'base64'))
      } catch (error) {
        problems.push(`${rawName}：${String(error?.message ?? error)}`)
        continue
      }
    }
    if (text.trim() === '') continue
    // Keep the human name for display; only plain-text files keep their suffix.
    const name = /\.(txt|md|markdown|docx|html?)$/i.test(rawName) ? rawName : `${rawName}.txt`
    uploads.push({ name, kind, text })
  }

  const groups = [
    ['setting', args?.settingPaths],
    ['extra', args?.extraPaths],
  ]
  for (const [kind, paths] of groups) {
    for (const path of Array.isArray(paths) ? paths : []) {
      const file = String(path ?? '').trim()
      if (file === '') continue
      try {
        if (!existsSync(file)) {
          problems.push(`找不到文件：${file}`)
          continue
        }
        uploads.push(readUpload(file, kind))
      } catch (error) {
        problems.push(`${basename(file)}：${String(error?.message ?? error)}`)
      }
    }
  }
  return { uploads, problems }
}

/** Merge uploads + the share attachment into the single settings document. */
export function mergeSettings({ uploads = [], attachmentText = '', attachmentName = '' }) {
  const settings = uploads.filter((item) => item.kind === 'setting' && item.text.trim() !== '')
  const extras = uploads.filter((item) => item.kind === 'extra' && item.text.trim() !== '')
  const parts = []

  if (settings.length > 0) {
    parts.push('# 一、原始人设')
    parts.push('')
    for (const item of settings) {
      parts.push(`## ${item.name}`)
      parts.push('')
      parts.push(item.text.trim())
      parts.push('')
    }
  }

  if (attachmentText.trim() !== '') {
    parts.push('# 二、对话附件里的设定')
    parts.push('')
    if (attachmentName) parts.push(`文件：${attachmentName}`)
    parts.push('')
    parts.push(attachmentText.trim())
    parts.push('')
  }

  if (extras.length > 0) {
    parts.push('# 三、补充文件')
    parts.push('')
    for (const item of extras) {
      parts.push(`## ${item.name}`)
      parts.push('')
      parts.push(item.text.trim())
      parts.push('')
    }
  }

  return {
    text: parts.join('\n').trim(),
    settingCount: settings.length,
    extraCount: extras.length,
  }
}
