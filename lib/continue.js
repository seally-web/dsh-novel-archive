/**
 * The "one click continue" payload.
 *
 * Reads the last few rounds verbatim plus novel.json and builds the same
 * 07_一站式接续 prompt the continuation pack ships with — the text the panel
 * drops straight into the composer so the model answers in character as the
 * next round.
 */
import { join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { buildOneShot } from './pack.js'
import { buildRecent } from './render.js'
import { ensureDir, writeText } from './util.js'
import { loadNovel } from './novel.js'
import { readTurns } from './state.js'
import { listSettingFiles, recall, recentCards, rebuildIndex } from './memory.js'
import { readKb, scaffold, syncKb } from './kb.js'

export function buildContinuation({ outDir, tailRounds = 8, write = true, recallLimit = 5 }) {
  const root = resolve(String(outDir ?? '.'))
  const turnsFile = join(root, 'analysis', 'turns.jsonl')
  if (!existsSync(turnsFile)) throw new Error(`找不到 ${turnsFile}，先把对话整理进来`)

  const rounds = readTurns(turnsFile)
  if (rounds.length === 0) throw new Error('analysis/turns.jsonl 是空的')
  // novel.json 缺失时按设定与最后几轮自动推断并落盘，用户再改
  const { novel, inferred } = loadNovel(root, { rounds })

  const tail = Math.max(2, Math.min(rounds.length, Number(tailRounds ?? novel.pack?.tailRounds ?? 8)))
  const tailFrom = rounds[rounds.length - tail].i
  const tailTo = rounds[rounds.length - 1].i
  // Everything below is read fresh from the work folder on every call, so a
  // card or a rule file edited by the user takes effect on the next round.
  const settings = listSettingFiles(root)
  const cards = recentCards(root, 2).map((card) => ({ name: card.name, from: card.from, to: card.to, text: card.text }))
  const indexFile = join(root, '记忆', '00_索引.md')
  const legacyIndex = existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : ''
  // 知识库：先补齐骨架与「当前这一幕」，再按模块取用（工作目录就是大脑）
  const settingText = (() => {
    const file = join(root, 'share', 'setting.txt')
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  })()
  scaffold(root, { novel, settingText })
  syncKb(root, { novel, settingText, light: true })
  const kb = readKb(root, { budget: 15500 })
  const index = legacyIndex || kb.index
  const lastUser = String(rounds[rounds.length - 1]?.user?.text ?? '')
  const threads = (novel.current?.openThreads ?? []).join(' ')
  const recalls = recall(root, `${lastUser} ${threads}`, { limit: recallLimit })
  const context = { settings, cards, index, recalls, kb }

  const prompt = buildOneShot(novel, rounds, tailFrom, tailTo, context)

  const hero = novel.ai?.name ?? novel.aiLabel ?? '男主'
  const girl = novel.user?.name ?? novel.userLabel ?? '女主'

  let written = null
  if (write) {
    const packDir = ensureDir(join(root, '续接包'))
    const base = join(packDir, '07_一站式接续_整段粘贴')
    writeText(`${base}.md`, prompt)
    writeText(`${base}.txt`, prompt)
    written = `${base}.txt`
  }

  return {
    dir: root,
    inferred,
    title: novel.title ?? '',
    hero,
    girl,
    nextRound: tailTo + 1,
    tailFrom,
    tailTo,
    affection: novel.current?.affection ?? '',
    day: novel.current?.day ?? '',
    place: novel.current?.place ?? '',
    lastAiQuote: novel.current?.lastAiQuote ?? '',
    lastUserText: String(rounds[rounds.length - 1]?.user?.text ?? ''),
    lastAiText: String(rounds[rounds.length - 1]?.ai?.text ?? ''),
    prompt,
    written,
    memory: { cards: cards.length, rows: cards.map((card) => `${card.name} ${card.from}-${card.to}`), recalls: recalls.length, settings: settings.map((item) => item.name), kbChars: kb.chars },
    // Kept for callers that want a plain-language caption.
    recent: buildRecent(rounds, tailFrom, tailTo, girl, hero),
  }
}
