import { readText } from './util.js'

function snippet(text, at, length, context) {
  const start = Math.max(0, at - context)
  const end = Math.min(text.length, at + length + context)
  const before = start === 0 ? '' : '…'
  const after = end === text.length ? '' : '…'
  return `${before}${text.slice(start, end).replace(/\s*\n\s*/g, ' ')}${after}`
}

/** Search all rounds for literal terms or one regular expression, with context. */
export function searchTurns(turnsFile, options) {
  const terms = Array.isArray(options.terms) ? options.terms.filter(Boolean).map(String) : []
  if (terms.length === 0) throw new Error('terms 至少给一个关键词')

  const context = Math.max(0, Math.min(2000, options.context ?? 160))
  const maxHits = Math.max(1, Math.min(50, options.maxHits ?? 3))
  const asRegex = Boolean(options.regex)
  const matchers = terms.map((term) => {
    if (!asRegex) return { term, pattern: null, literal: term }
    try {
      return { term, pattern: new RegExp(term, 'g'), literal: null }
    } catch (error) {
      throw new Error(`正则写错了（${term}）：${error.message}`)
    }
  })

  const lines = readText(turnsFile).split('\n').filter(Boolean)
  const perTerm = new Map(terms.map((term) => [term, []]))
  const counts = new Map(terms.map((term) => [term, 0]))

  for (const line of lines) {
    let turn
    try {
      turn = JSON.parse(line)
    } catch {
      continue
    }
    const fields = [
      ['用户', turn?.user?.text],
      ['AI 正文', turn?.ai?.text],
      ['AI 思考', turn?.ai?.think],
    ]
    for (const matcher of matchers) {
      for (const [label, raw] of fields) {
        const text = String(raw ?? '')
        if (text === '') continue
        const found = matcher.pattern
          ? [...text.matchAll(matcher.pattern)]
          : [...text.matchAll(new RegExp(escapeRegExp(matcher.literal), 'g'))]
        if (found.length === 0) continue
        counts.set(matcher.term, counts.get(matcher.term) + found.length)
        const hits = perTerm.get(matcher.term)
        for (const match of found) {
          if (hits.length >= maxHits) break
          hits.push({ round: turn.i, label, text: snippet(text, match.index ?? 0, match[0].length, context) })
        }
      }
    }
  }

  const out = []
  for (const matcher of matchers) {
    const hits = perTerm.get(matcher.term)
    out.push(`【${matcher.term}】共 ${counts.get(matcher.term)} 处，显示前 ${hits.length} 处`)
    if (hits.length === 0) {
      out.push('  （没有命中）')
    } else {
      for (const hit of hits) {
        const time = timeOf(turnsFile, hit.round)
        out.push(`  · 第 ${hit.round} 轮${time ? `（${time}）` : ''} · ${hit.label}：${hit.text}`)
      }
    }
    out.push('')
  }
  return out.join('\n').trimEnd()
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const timeIndex = new Map()
function timeOf(turnsFile, round) {
  if (timeIndex.has(turnsFile)) {
    return timeIndex.get(turnsFile).get(round) ?? ''
  }
  const map = new Map()
  for (const line of readText(turnsFile).split('\n')) {
    if (!line) continue
    try {
      const turn = JSON.parse(line)
      map.set(turn.i, `${turn?.user?.day ?? ''} ${turn?.user?.time ?? ''}`.trim())
    } catch {
      /* ignore */
    }
  }
  timeIndex.set(turnsFile, map)
  return map.get(round) ?? ''
}
