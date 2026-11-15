/**
 * 17_场景：住处、医院、公司这些地方「长什么样」。
 *
 * 这些不是设定条目，是他在那个地方看见过的东西——光线、家具、声音、气味。
 * 写一场戏之前先翻这一页，屋子才不会每章换个样子。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export const SCENE_DIR = '17_场景'
export const SCENE_INDEX = '00_场景索引.md'

/** 常见的几类地方；以后从设定里发现新地点会追加在末尾 */
const SEEDS = [
  {
    name: '住处',
    keywords: ['住处', '家', '院子', '客厅', '书房', '卧室', '厨房', '餐厅', '玄关', '楼梯', '阳台'],
    people: '他、她、家里人',
  },
  {
    name: '医院',
    keywords: ['医院', '病房', 'ICU', '重症', '急诊', '诊室', '复查', '输液', '病床'],
    people: '他、她、医生、护士',
  },
  {
    name: '公司',
    keywords: ['公司', '办公室', '会议室', '工位', '项目组', '部门', '总部'],
    people: '他、助理、同事、下属',
  },
  {
    name: '学校',
    keywords: ['学校', '教室', '宿舍', '图书馆', '食堂', '操场', '学院', '导师', '组会'],
    people: '她、同学、老师',
  },
  {
    name: '酒店与席面',
    keywords: ['酒店', '会所', '包间', '宴', '酒局', '饭局'],
    people: '他、她、生意上的人、服务员',
  },
  {
    name: '机场与路上',
    keywords: ['机场', '车站', '高铁', '飞机', '车上', '车里', '候机'],
    people: '他、她、司机',
  },
  {
    name: '老家',
    keywords: ['老家', '父母家', '祖宅', '亲戚', '回乡'],
    people: '他、她、长辈、亲戚',
  },
  {
    name: '外地',
    keywords: ['外地', '出差', '异地', '项目现场', '分公司'],
    people: '他、她、项目上的人',
  },
  {
    name: '度假地',
    keywords: ['海边', '度假', '旅行', '山上', '湖'],
    people: '他、她、同行的人',
  },
]

/** 只有带这些词，才算「在写这个地方长什么样」 */
const LOOKS = /窗|门|墙|灯|沙发|桌|柜|床|走廊|台阶|电梯|玻璃|地毯|窗帘|院里|楼下|楼上|阳台|书架|椅子|茶几|屏风|挂画|味道|光线|阳光|雨|雪|空调|暖气|白墙|木地板|天花板|过道|门口|墙角|灯下|窗台/

const SENTENCE_SPLIT = /(?<=[。！？!?；;])|\n+/

function root(outDir) {
  return resolve(String(outDir ?? '.'))
}

function ensure(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

function clean(value) {
  let text = String(value ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  for (let i = 0; i < 3; i += 1) {
    const before = text
    text = text
      .replace(/^[「『“‘"'（(【\[」』”’）)】\]]+/, '')
      .replace(/[「『“‘（(【\[]+$/, '')
      .trim()
    if (text === before) break
  }
  return text
}

function sentencesOf(text) {
  return clean(text)
    .split(SENTENCE_SPLIT)
    .map((line) => clean(line))
    .filter((line) => line.length >= 8 && line.length <= 80)
}

function sceneOf(sentence) {
  let best = null
  let hits = 0
  for (const seed of SEEDS) {
    const count = seed.keywords.filter((word) => sentence.includes(word)).length
    if (count > hits) {
      hits = count
      best = seed
    }
  }
  return best
}

function fileOf(seed) {
  return `${String(SEEDS.indexOf(seed) + 1).padStart(2, '0')}_${seed.name}.md`
}

/** 扫原文，把「在写这个地方」的句子按地方归堆 */
export function collectScenes(rounds, { perScene = 16 } = {}) {
  const map = new Map()
  for (const seed of SEEDS) map.set(seed.name, { seed, lines: [] })
  const seen = new Set()
  for (const round of rounds ?? []) {
    const text = String(round.ai?.text ?? '')
    if (text === '') continue
    for (const sentence of sentencesOf(text)) {
      if (!LOOKS.test(sentence)) continue
      const seed = sceneOf(sentence)
      if (!seed) continue
      const key = sentence.slice(0, 18)
      if (seen.has(key)) continue
      const bucket = map.get(seed.name)
      if (bucket.lines.length >= perScene) continue
      seen.add(key)
      bucket.lines.push(`- ${sentence}（第 ${round.i} 轮）`)
    }
  }
  return [...map.values()].filter((bucket) => bucket.lines.length > 0)
}

function existingCustom(base) {
  const dir = join(base, SCENE_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => /\.md$/.test(name) && name !== SCENE_INDEX && name !== '场景.md' && !/^\d\d_/.test(name))
    .map((name) => ({ name: name.replace(/\.md$/, ''), file: name, text: readFileSync(join(dir, name), 'utf8') }))
}

function placeFromBible(bibleText) {
  const text = String(bibleText ?? '')
  const section = /## [^\n]*关键地点[^\n]*\n([\s\S]*?)(?=\n## |\n# |$)/.exec(text)
  if (!section) return []
  return section[1]
    .split('\n')
    .filter((line) => /^[-*] /.test(line.trim()))
    .map((line) => line.replace(/^[-*] /, '').replace(/\*\*/g, '').trim())
    .filter(Boolean)
    .slice(0, 24)
}

export function buildScenes(outDir, { novel = null, bibleText = '', rounds = [] } = {}) {
  const base = root(outDir)
  const dir = join(base, SCENE_DIR)
  ensure(dir)
  const buckets = collectScenes(rounds)
  const biblePlaces = placeFromBible(bibleText)
  const written = []
  const rows = ['| 场景 | 文件 | 写下的细节 |', '| --- | --- | --- |']

  for (const bucket of buckets) {
    const file = fileOf(bucket.seed)
    const body = [
      `# 场景：${bucket.seed.name}`,
      '',
      `> 常出现的人：${bucket.seed.people}`,
      '',
      '## 这里是什么样子',
      '',
      ...bucket.lines,
      '',
    ]
    if (biblePlaces.length > 0 && bucket.seed.name === '住处') {
      body.push('## 设定里写到的', '')
      body.push(...biblePlaces.map((line) => `- ${line}`))
      body.push('')
    }
    writeFileSync(join(dir, file), body.join('\n'), 'utf8')
    written.push(`${SCENE_DIR}/${file}`)
    rows.push(`| ${bucket.seed.name} | \`${file}\` | ${bucket.lines.length} 条 |`)
  }

  for (const custom of existingCustom(base)) {
    rows.push(`| ${custom.name} | \`${custom.file}\` | 手写 |`)
  }

  if (written.length === 0) {
    writeFileSync(join(dir, '01_待补.md'), '# 场景\n\n> 还没从原文里认出具体的地方。写的时候在面板里手动补一份，格式随意。\n', 'utf8')
    written.push(`${SCENE_DIR}/01_待补.md`)
    rows.push('| （待补） | `01_待补.md` | 0 条 |')
  }

  const index = [
    '# 场景索引',
    '',
    '> 写一场戏之前先翻这里：屋子、光线、家具、气味都在各自文件里；不要每章换一个样子。',
    '',
    ...rows,
    '',
    `> 由插件从最近 ${rounds.length} 轮原文里抓的「外貌句」，每个地方最多 16 条。手动补的文件会一起列出来。`,
    '',
  ].join('\n')
  writeFileSync(join(dir, SCENE_INDEX), index, 'utf8')
  written.push(`${SCENE_DIR}/${SCENE_INDEX}`)
  return { dir: relative(base, dir), files: written, scenes: buckets.length }
}
