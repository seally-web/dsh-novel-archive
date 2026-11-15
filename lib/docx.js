import { inflateRawSync } from 'node:zlib'

function readUInt16(buffer, offset) {
  return buffer.readUInt16LE(offset)
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32LE(offset)
}

/** Minimal ZIP reader: enough for .docx (word/document.xml is deflate or stored). */
export function unzipEntries(buffer) {
  const signature = 0x06054b50
  let end = buffer.length - 22
  while (end >= 0 && readUInt32(buffer, end) !== signature) end -= 1
  if (end < 0) throw new Error('不是 zip 文件（找不到 central directory）')

  const count = readUInt16(buffer, end + 10)
  let cursor = readUInt32(buffer, end + 16)
  const entries = new Map()

  for (let index = 0; index < count; index += 1) {
    if (readUInt32(buffer, cursor) !== 0x02014b50) break
    const method = readUInt16(buffer, cursor + 10)
    const compressedSize = readUInt32(buffer, cursor + 20)
    const size = readUInt32(buffer, cursor + 24)
    const nameLength = readUInt16(buffer, cursor + 28)
    const extraLength = readUInt16(buffer, cursor + 30)
    const commentLength = readUInt16(buffer, cursor + 32)
    const localOffset = readUInt32(buffer, cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')

    const localNameLength = readUInt16(buffer, localOffset + 26)
    const localExtraLength = readUInt16(buffer, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    const data = method === 0 ? raw : inflateRawSync(raw)
    entries.set(name, { data, size })
    cursor += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': '\u00a0',
}

function decodeEntities(text) {
  return text
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (match) => ENTITIES[match] ?? match)
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
}

/** Extract plain text from a .docx buffer; paragraphs become lines. */
export function docxToText(buffer) {
  const entries = unzipEntries(buffer)
  const document = entries.get('word/document.xml')
  if (!document) throw new Error('.docx 里没有 word/document.xml')

  const xml = document.data.toString('utf8')
  const withBreaks = xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')

  const text = withBreaks
    .replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, '')
    .replace(/<w:delText[\s\S]*?<\/w:delText>/g, '')
    .replace(/<[^>]+>/g, '')

  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').replace(/\u0000/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
