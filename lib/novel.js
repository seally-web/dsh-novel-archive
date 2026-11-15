/**
 * novel.json — the one file that decides what every deliverable says: names,
 * ages, the current scene, the writing rules.
 *
 * The user should not have to hand-write it before the first "one click
 * continue". So when it is missing we read the setting text that came with the
 * archive (share/setting.txt, or the files the user uploaded into 设定/) and
 * fill in what can be known for certain: two characters, ages, identity,
 * personality, the 注意/禁止 writing rules, and the current round taken from
 * the transcript. Everything guessed is marked with `_inferred` so the panel can
 * tell the user to look it over.
 */
import { join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { readJson, writeJson } from './util.js'

/** Lines like `姓名：某某` inside one character block. */
function field(block, name) {
  const match = new RegExp(`^[ \\t]*${name}[ \\t]*[：:][ \\t]*(\\S.*)$`, 'm').exec(block)
  const value = match?.[1]?.trim() ?? ''
  return value === '' || /^(无|没有|无设定|（没有就写无）)$/.test(value) ? '' : value
}

function splitList(text) {
  return String(text ?? '')
    .split(/[，,、；;。\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 40)
}

function age(text) {
  const match = /(\d{1,3})/.exec(String(text ?? ''))
  return match ? Number(match[1]) : null
}

/** Split the setting into the male block and the female block. */
export function parseSetting(text) {
  const source = String(text ?? '')
  const femaleAt = source.search(/\n\s*女[主人]人设\s*\n/)
  const maleText = femaleAt > 0 ? source.slice(0, femaleAt) : source
  const femaleText = femaleAt > 0 ? source.slice(femaleAt) : ''
  return { maleText, femaleText, source }
}

function characterFrom(block) {
  const name = field(block, '姓名')
  if (name === '') return null
  return {
    name,
    nickname: field(block, '小名'),
    genderSex: field(block, '性别'),
    age: age(field(block, '年龄')),
    birthday: field(block, '生日'),
    identity: field(block, '身份'),
    appearance: field(block, '外貌'),
    height: field(block, '身高'),
    personality: field(block, '性格'),
    likes: field(block, '喜好'),
    dislikes: field(block, '讨厌'),
    traits: [...splitList(field(block, '性格')), ...splitList(field(block, '喜好'))].slice(0, 8),
    block,
  }
}

/** The writing rules live in the `注意` section at the end of the setting. */
function rulesFrom(text) {
  const source = String(text ?? '')
  const at = source.search(/\n\s*注意\s*[：:]/)
  const tail = at >= 0 ? source.slice(at) : source
  const items = tail
    .split(/\n(?=\s*\d{1,2}[、.．])|\n(?=\s*[-*·])/)
    .map((line) => line.replace(/^\s*\d{1,2}[、.．]\s*/, '').replace(/^\s*[-*·]\s*/, '').trim())
    .filter((line) => line.length >= 6)
  const deny = items
    .filter((line) => /禁止|禁用|不要|不能|不许|不得/.test(line))
    .map((line) => line.replace(/\s+/g, ' ').slice(0, 80))
    .slice(0, 24)
  const style = items
    .filter((line) => !/禁止|禁用|不要|不能|不许|不得/.test(line) && /必须|要求|每|请|写给|保持/.test(line))
    .map((line) => line.replace(/\s+/g, ' ').slice(0, 80))
    .slice(0, 10)
  const hasStatusBar = /好感度|状态栏/.test(source)
  const rules = {
    pov: /禁止代替用户|禁止扮演用户/.test(source)
      ? '第三人称限知，只写男主的动作、台词、神态与一点心理；用户的动作和台词留给她自己写'
      : '',
    lengthLine: '一轮一百多到三百字，最多三段，一轮只推进一个小动作',
    style,
    deny,
  }
  if (hasStatusBar) rules.statusBar = { fields: ['心情', '好感度', '衣着', '想法'] }
  return rules
}

function dayLabel(value) {
  const text = String(value ?? '')
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!matched) return text
  return `${Number(matched[2])} 月 ${Number(matched[3])} 日`
}

function firstClause(value) {
  const text = String(value ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim()
  if (text === '') return ''
  return text.split(/(?<=[。！？!?])/)[0].replace(/^[「『“‘"'（(【\[]+/, '').slice(0, 60)
}

function memoryBullets(novel, hero, girl, last) {
  const lines = []
  const heroLine = `${hero?.name ?? novel.ai.name} ${hero?.age ?? novel.ai.age ?? ''} 岁`.trim()
  lines.push(`${heroLine}${hero?.identity ? `，${hero.identity}` : ''}。`)
  const girlLine = `${novel.user.name} ${novel.user.age ?? ''} 岁`.trim()
  const nickname = novel.user.nickname
  lines.push(`${girlLine}${nickname ? `，小名${nickname}` : ''}。`)
  if (novel.relationship) lines.push(`两个人的关系：${novel.relationship}。`)
  lines.push(`她叫他：${novel.user.callName ?? '哥哥'}；他叫她：${novel.user.name}${nickname ? `（${nickname}）` : ''}。`)
  if (novel.current.affection) lines.push(`感情进度：${novel.current.affection}。`)
  if (last?.i) lines.push(`现在从第 ${last.i + 1} 轮接：接住上一轮最后那一幕，不要跳时间，不要另起一件事。`)
  return lines.join('\n')
}

function lastAffection(rounds) {
  for (let index = rounds.length - 1; index >= 0 && index > rounds.length - 6; index -= 1) {
    const body = String(rounds[index]?.ai?.text ?? '')
    const match = /好感度[^\d%]{0,6}(\d{1,3})\s*%/.exec(body)
    if (match) return `${Number(match[1])}%`
  }
  return ''
}

/** The player may rename the character mid-transcript（「我叫某某」）；later self-declarations win. */
function declaredNames(rounds) {
  // Only lines that are actually about the naming (「纠正一下…我叫某某」), not
  // every 「把我叫起来」 that happens to contain 叫.
  const texts = rounds
    .map((round) => String(round?.user?.text ?? ''))
    .filter((text) => /纠正|改名|名字|设定|确认一下/.test(text))
  const pick = (regexp) => {
    let found = ''
    for (const text of texts) {
      const match = regexp.exec(text)
      if (match) found = match[1]
    }
    return found
  }
  return {
    name: pick(/我叫([\u4e00-\u9fa5]{2,3})(?=[，。、）)\s]|$)/),
    nickname: pick(/小名(?:是|叫|为)?([\u4e00-\u9fa5]{1,2})(?=[，。、）)\s]|$)/),
  }
}

function lastQuote(text) {
  const body = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*状态栏[\s\S]*$/m, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (body === '') return ''
  const cut = /^(.{1,80}?[。！？!?」”）)])/.exec(body)
  return (cut?.[1] ?? body.slice(0, 80)).trim().replace(/^[「『“‘"'（(【\[]+/, '').trim()
}

/** Build a novel object from what the archive already contains. */

const CN_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 「二十」「二十三」→ 20 / 23 */
export function cnNumber(text) {
  const value = String(text ?? '')
  if (/^\d+$/.test(value)) return Number(value)
  const ten = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(value)
  if (ten) return (ten[1] ? CN_DIGITS[ten[1]] : 1) * 10 + (ten[2] ? CN_DIGITS[ten[2]] : 0)
  return null
}

/** 从正文里找「她过了生日就是二十岁」「这回二十岁」这类成年/过生日的说法 */
export function currentAge(rounds, fallback) {
  let age = Number.isFinite(Number(fallback)) ? Number(fallback) : null
  for (const round of rounds ?? []) {
    const text = `${round.ai?.text ?? ''}\n${round.ai?.think ?? ''}`
    for (const match of text.matchAll(/(?:过了生日就是|这回|今年|已经)([一二三四五六七八九十]{2,3})岁/g)) {
      const value = cnNumber(match[1])
      if (value && value >= 12 && value <= 60) age = value
    }
    if (/法定年龄|领证/.test(text) && age !== null && age < 20) age = Math.max(age, 20)
  }
  return age
}

export function inferNovel(root, rounds = []) {
  const settingFile = join(root, 'share', 'setting.txt')
  const setting = existsSync(settingFile) ? readFileSync(settingFile, 'utf8') : ''
  const { maleText, femaleText } = parseSetting(setting)
  const hero = characterFrom(maleText)
  const girl = characterFrom(femaleText)
  const last = rounds[rounds.length - 1]
  const round = last?.i ?? rounds.length
  const novel = {
    _inferred: true,
    _note: '这份 novel.json 是按对话附件里的设定与最后几轮自动推断的。看一遍：名字、年龄、称呼、当前场景、感情进度，改对之后以后的续接就都按它来。',
    title: '',
    ai: hero
      ? { name: hero.name, age: hero.age, identity: hero.identity, traits: hero.traits }
      : { name: '男主', age: null, identity: '', traits: [] },
    user: girl
      ? { name: girl.name, age: girl.age, identity: girl.identity, traits: girl.traits }
      : { name: '女主', age: null, identity: '', traits: [] },
    relationship: /收养/.test(setting)
      ? '收养关系，称呼以设定为准'
      : '',
    storyline: '',
    current: {
      round,
      day: dayLabel(last?.user?.day ?? last?.ai?.day ?? ''),
      place: '',
      scene: firstClause(last?.user?.text),
      lastAiQuote: lastQuote(last?.ai?.text),
      lastUserQuote: firstClause(last?.user?.text),
      affection: lastAffection(rounds),
      openThreads: [],
    },
    rules: rulesFrom(setting),
    memory: '',
    voice: '',
    bible: '',
    volumes: [],
    pack: { tailRounds: 8 },
    _settingChars: setting.length,
  }
  // 故事是往前走的：年龄按后文里的生日/成年说法推进（附件里写的多是起点年龄）
  const aged = currentAge(rounds, novel.user.age)
  if (aged && novel.user.age && aged > Number(novel.user.age)) {
    novel.user.birthAge = Number(novel.user.age)
    novel.user.age = aged
  }
  const declared = declaredNames(rounds)
  if (declared.name) novel.user.name = declared.name
  if (declared.nickname) novel.user.nickname = declared.nickname
  novel.memory = memoryBullets(novel, hero, girl, last)
  novel.oneShotMemory = novel.memory.split('\n').filter(Boolean)
  if (hero?.block) novel._heroExtra = ''
  return novel
}

/**
 * Read novel.json; when it is missing, infer one, write it to disk (so the user
 * can open and correct it) and return it with `_inferred` set.
 */
export function loadNovel(root, { rounds = [], write = true } = {}) {
  const dir = resolve(String(root ?? '.'))
  const file = join(dir, 'novel.json')
  const existing = readJson(file, null)
  if (existing && typeof existing === 'object') return { novel: existing, inferred: false, file }
  const novel = inferNovel(dir, rounds)
  if (write) {
    try {
      writeJson(file, novel)
    } catch { /* read-only archive: keep the in-memory copy */ }
  }
  return { novel, inferred: true, file }
}
