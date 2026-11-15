import { buildRecent } from './render.js'
import { table } from './util.js'

function list(items, prefix = '- ') {
  return items.map((item) => `${prefix}${item}`).join('\n')
}

function quoted(text) {
  return String(text ?? '').trim()
}

function currentBlock(novel) {
  const now = novel.current ?? {}
  const lines = []
  lines.push(`- 轮次：第 ${now.round ?? '?'} 轮结束，下一轮从第 ${(now.round ?? 0) + 1} 轮接`)
  if (now.day) lines.push(`- 时间：${now.day}`)
  if (now.place) lines.push(`- 地点：${now.place}`)
  if (!now.day && !now.place) lines.push('- 时间地点：以「最近几轮原文」里最后出现的那一幕为准，不要自己另起时间')
  if (now.scene) lines.push(`- 上一轮停在这儿：${now.scene}`)
  if (now.lastAiQuote) lines.push(`- 他最后一句：「${quoted(now.lastAiQuote)}」`)
  if (now.lastUserQuote) lines.push(`- 她最后一句：「${quoted(now.lastUserQuote)}」`)
  lines.push(`- 感情进度：${now.affection ?? '（未填）'}`)
  return lines.join('\n')
}

function rulesBlock(novel) {
  const rules = novel.rules ?? {}
  const lines = []
  if (rules.pov) lines.push(`视角：${rules.pov}`)
  if (rules.lengthLine) lines.push(`篇幅：${rules.lengthLine}`)
  for (const rule of rules.style ?? []) lines.push(rule)
  if (Array.isArray(rules.deny) && rules.deny.length > 0) {
    lines.push(`禁词与禁句式：${rules.deny.join('、')}`)
  }
  if (rules.statusBar) {
    const fields = (rules.statusBar.fields ?? ['心情', '好感度', '衣着', '想法']).join(' / ')
    lines.push(`每轮结尾固定一个 \`\`\`text 状态栏，四项：${fields}。`)
  }
  return lines
}

/** 00_使用说明 */
export function buildGuide(novel, stats) {
  const title = novel.title ?? '本作'
  const hero = novel.ai?.name ?? '男主'
  const girl = novel.user?.name ?? '女主'
  const lines = []
  lines.push(`# 续接包使用说明｜《${title}》`)
  lines.push('')
  lines.push('## 一、先说结论')
  lines.push('')
  lines.push(
    `不用把全部原文塞给新对话。全文 ${(stats.totalChars / 10000).toFixed(0)} 万字，换算成 token 大约是上下文窗口的好几倍，塞进去它也记不住，反而会按「梗概」的戏剧强度去写。`,
  )
  lines.push('')
  lines.push('续接靠三样东西，按重要性排：')
  lines.push('')
  lines.push('1. **最近原文**（03 或 07 里内嵌的那一段）——决定语气，最重要；')
  lines.push('2. **设定与前情提要**（02 / 06）——决定人物与事实不跑偏；')
  lines.push('3. **当前状态**（时间、地点、最后一句、感情进度）——决定从哪儿接。')
  lines.push('')
  lines.push('## 二、最省事的用法')
  lines.push('')
  lines.push('1. 新开一个对话（不要在原对话里接，上下文已经被压缩过）。')
  lines.push('2. 打开 `07_一站式接续_整段粘贴.txt`，从分割线后整段复制，粘进新对话。')
  lines.push('3. 它应该先用两三句话复述：现在是什么时候、在哪儿、感情进度多少、你上一句说了什么、从第几轮接。')
  lines.push(`4. 确认无误，按你平时的格式回一句动作或台词，就从第 ${(novel.current?.round ?? 0) + 1} 轮往下走。`)
  lines.push('')
  lines.push('## 三、几种方案')
  lines.push('')
  lines.push(table(
    [
      ['A 最轻', '只粘 07', '语气与当前场景都对，细节靠它自己推', '最快，日常戏够用'],
      ['B 推荐', '07 + 06', '人物、承诺、物件、没落地的事都记得', '长线写作首选'],
      ['C 更稳', '07 + 06 + 05', '语气再校准一层，适合它开始飘的时候', ''],
      ['D 最全', '再加 02', '前情与规则最完整，但 token 也最多', '换章、跨时间才需要'],
    ],
    ['方案', '传什么', '效果', '说明'],
  ))
  lines.push('')
  lines.push('先按 A 或 B 起步；发现它忘了某件事，再把 06 或 02 补进去，不用一上来就全传。')
  lines.push('')
  lines.push('## 四、它忘了 / 写飘了怎么办')
  lines.push('')
  lines.push('- 忘了人物与旧事：把 `06_记忆锚点` 整段发过去，说「记住这些，不要问，直接接」。')
  lines.push('- 语气不对：从 `05_语感样本` 里挑对应场景那一组贴过去，说「照这个语气重写这一轮」。')
  lines.push('- 写成梗概、开始赶剧情：说「不要推进剧情，只写这一刻的一句话和一个动作」。')
  lines.push(`- 叫错人或叫错称呼：纠正一句即可——她是${girl}，叫他${hero}${novel.relationship ? `，${novel.relationship}` : ''}。`)
  lines.push('')
  lines.push('## 五、怎么确认它接住了')
  lines.push('')
  lines.push('问它五个问题，答对四个以上再往下写：')
  lines.push('')
  lines.push(`1. 现在是哪一天、在哪儿、刚发生完什么？`)
  lines.push(`2. ${girl}叫他什么？两个人现在是什么关系？`)
  lines.push(`3. 感情进度是多少？为什么是这个数？`)
  lines.push(`4. 上一轮他最后说的是哪句话？`)
  lines.push(`5. 接下来还没落地的事有哪几件？`)
  lines.push('')
  lines.push('## 六、长期写作不跑偏')
  lines.push(`每 20—30 轮，让它用 \`04_滚动记忆模板\` 把这一段压成五行记忆卡，存成 \`记忆_${(novel.current?.round ?? 0) + 1}-XXXX.md\`。`)
  lines.push('下次开新对话时，「07 + 最近一张记忆卡」就够，不用再传原文。')
  lines.push('')
  lines.push('## 七、常见毛病与一句话纠正')
  lines.push('')
  lines.push(list([
    '替用户说话、写用户心理 →「只写你的动作和台词，我的部分留给我。」',
    '一轮写太长 →「这一轮一百多字，只推进一个小动作。」',
    '突然求婚 / 突然出事 →「不推进大情节，写现在这一刻。」',
    '用了禁词（仿佛、就像、一丝、一抹、突然、猛地） →「把这一轮重写，一个比喻都不要。」',
    '忘记状态栏 →「结尾按四项状态栏补上。」',
    '感情进度乱涨 →「感情进度按上一轮不变或只加一点，并写明原因。」',
    '把她写成娇弱小可怜 →「她是会顶嘴、会自己拿主意的人。」',
    '把他写成油腻霸总 →「他说话短、平、少形容词。」',
  ]))
  lines.push('')
  lines.push('## 八、极简版（约 300 字，赶时间就贴这段）')
  lines.push('')
  lines.push(`> 我们在续写《${title}》。${hero} ${novel.ai?.age ?? ''} 岁，${girl} ${novel.user?.age ?? ''} 岁${novel.relationship ? `，${novel.relationship}` : ''}。`)
  lines.push(`> 现在${novel.current?.day ?? ''}，${novel.current?.place ?? ''}。他最后说：「${quoted(novel.current?.lastAiQuote)}」`)
  lines.push(`> 感情进度 ${novel.current?.affection ?? ''}。`)
  lines.push('> 写法：只写他的动作与台词，一轮一百多字，不替用户说话，不用比喻，不用「仿佛/就像/突然/猛地/一丝/一抹」，结尾加四项状态栏。')
  lines.push('> 先复述现在的时间地点和进度，然后停住，等我开口。')
  lines.push('')
  lines.push('## 九、文件清单')
  lines.push('')
  lines.push(table(
    [
      ['07_一站式接续_整段粘贴', '★ 只用这个也能接上', '一条消息，含身份、当前场景、最近原文、写法'],
      ['06_记忆锚点', '人物 / 承诺 / 物件 / 未收线索', '它忘事时补这个'],
      ['05_语感样本', '按场景分组的原句', '语气飘了补这个'],
      ['03 / 03a / 03b', '最近原文逐字', '需要更多语气样本时'],
      ['02_设定与前情提要', '人物与全部前情', '换章、跨时间时'],
      ['01_直接粘贴_续接指令', '不含原文的瘦身版', '只想说明设定时'],
      ['04_滚动记忆模板', '记忆卡提示词', '每 20—30 轮用一次'],
    ],
    ['文件', '作用', '什么时候用'],
  ))
  lines.push('')
  return `${lines.join('\n')}\n`
}

/** 01_直接粘贴_续接指令 */
export function buildInstruction(novel) {
  const hero = novel.ai?.name ?? '男主'
  const girl = novel.user?.name ?? '女主'
  const lines = []
  lines.push(`# 直接粘贴的续接指令｜《${novel.title ?? ''}》`)
  lines.push('')
  lines.push('用法：复制分割线以下全部内容，粘进新对话的第一条消息。它不含原文，语气需要你自己盯；要最稳请用 07。')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 一、我们各自是谁')
  lines.push('')
  lines.push(`你在写${hero}，我在写${girl}。你只写他的动作、台词、神态和一点点心理；我的动作和台词我自己写。`)
  lines.push(`${hero} ${novel.ai?.age ?? ''} 岁，${novel.ai?.identity ?? ''}。${girl} ${novel.user?.age ?? ''} 岁，${novel.user?.identity ?? ''}。`)
  if (novel.relationship) lines.push(`两个人的关系：${novel.relationship}。`)
  lines.push('')
  lines.push('## 二、人物压缩版')
  lines.push('')
  lines.push(`**${hero}**`)
  lines.push('')
  lines.push(list(novel.ai?.traits ?? []))
  lines.push('')
  lines.push(`**${girl}**`)
  lines.push('')
  lines.push(list(novel.user?.traits ?? []))
  lines.push('')
  lines.push('## 三、故事走到哪')
  lines.push('')
  lines.push(novel.storyline ?? '（见 02_设定与前情提要）')
  lines.push('')
  lines.push('## 四、当前场景')
  lines.push('')
  lines.push(currentBlock(novel))
  lines.push('')
  lines.push('## 五、写法必须遵守')
  lines.push('')
  lines.push(list(rulesBlock(novel), '1. '))
  lines.push('')
  lines.push('## 六、现在怎么开始')
  lines.push('')
  lines.push('先用两三句话确认：现在什么时候、在哪儿、感情进度多少、我上一句说了什么、从第几轮接。然后停住，等我开口。不要先写回复。')
  lines.push('')
  return `${lines.join('\n')}\n`
}

/** 02_设定与前情提要 */
export function buildBackstory(novel, chapters) {
  const lines = []
  lines.push(`# 设定与前情提要｜《${novel.title ?? ''}》`)
  lines.push('')
  lines.push('## 一、人物与设定')
  lines.push('')
  lines.push(novel.bible ?? '（未提供 02_人物设定.md，可让模型先读 06_记忆锚点）')
  lines.push('')
  lines.push('## 二、前情提要')
  lines.push('')
  for (const chapter of chapters) {
    lines.push(`### 第${chapter.n}章 ${chapter.title}（第${chapter.from}—${chapter.to}轮）`)
    lines.push('')
    lines.push(chapter.summary ?? '')
    lines.push('')
  }
  lines.push('## 三、当前状态与未收线索')
  lines.push('')
  lines.push('### 1. 结束处')
  lines.push('')
  lines.push(currentBlock(novel))
  lines.push('')
  if (novel.current?.relationshipNote) {
    lines.push('### 2. 两人的关系')
    lines.push('')
    lines.push(novel.current.relationshipNote)
    lines.push('')
  }
  lines.push('### 3. 还没落地的事')
  lines.push('')
  lines.push(list(novel.current?.openThreads ?? []))
  lines.push('')
  return `${lines.join('\n')}\n`
}

/** 04_滚动记忆模板 */
export function buildMemoryTemplate(novel) {
  const hero = novel.ai?.name ?? '男主'
  const girl = novel.user?.name ?? '女主'
  const round = novel.current?.round ?? 0
  const lines = []
  lines.push('# 滚动记忆模板')
  lines.push('')
  lines.push('## 一、什么时候用')
  lines.push('')
  lines.push('每写 20—30 轮用一次；换设备、换对话之前也做一次。做完存成 `记忆_起始轮-结束轮.md`，下次和 07 一起用。')
  lines.push('')
  lines.push('## 二、直接粘贴的提示词')
  lines.push('')
  lines.push('```text')
  lines.push('把我们这几十轮的剧情压成一张记忆卡，按下面七节写，每节不超过五行：')
  lines.push('')
  lines.push('1. 当前场景：什么时候、在哪儿、刚发生完什么、两人各自的情绪。')
  lines.push('2. 这几十轮发生了什么：按顺序写三到八件事，带大致轮次。')
  lines.push(`3. 两人关系：${hero}和${girl}现在的称呼、距离、有没有新的约定或越界。`)
  lines.push('4. 新出现的人与物：名字、身份、怎么出场的。')
  lines.push('5. 新约定与新人设：这几十轮里定下的新规则、新习惯、新称呼。')
  lines.push('6. 未收线索：提过但还没解决的事，一条一行。')
  lines.push('7. 感情进度：现在的百分比，以及原因。')
  lines.push('')
  lines.push('只写事实，不写形容词，不要写成小说。')
  lines.push('```')
  lines.push('')
  lines.push('## 三、输出后怎么存')
  lines.push('')
  lines.push(`存成 \`记忆_${round + 1}-XXXX.md\`，与续接包放在一起；下次开新对话时，07 + 最近一张卡一起粘。`)
  lines.push('')
  lines.push('## 四、空模板')
  lines.push('')
  lines.push('```text')
  lines.push('【当前场景】')
  lines.push('【这几十轮发生了什么】')
  lines.push('【两人关系】')
  lines.push('【新出现的人与物】')
  lines.push('【新约定与新人设】')
  lines.push('【未收线索】')
  lines.push(`【感情进度】${novel.current?.affection ?? ''}`)
  lines.push('```')
  lines.push('')
  lines.push('## 五、几个别漏的点')
  lines.push('')
  lines.push(list([
    `称呼：她叫他${hero}${novel.user?.callName ? `（${novel.user.callName}）` : ''}，怎么叫、什么时候改的口。`,
    novel.relationship ? `关系：${novel.relationship}。` : '关系：现在到底算什么，说清楚。',
    '时间：故事内过了多久，季节、节日、学期都要记。',
    '旧事：提过但没说完的事，最容易被忘。',
    '身边人：新人物第一次出场时，记下他怎么被介绍的。',
    '状态栏：感情进度只写一个百分比，衣服和心情一起记。',
  ]))
  lines.push('')
  return `${lines.join('\n')}\n`
}

/** 05_语感样本 */
export function buildVoice(novel) {
  const lines = []
  lines.push('# 语感样本')
  lines.push('')
  lines.push('用法：语气飘了，挑对应场景那一组贴过去，说「照这个语气重写这一轮」。原句逐字，不要改写。')
  lines.push('')
  lines.push('## 一、结构拆解')
  lines.push('')
  lines.push(list(novel.rules?.sentenceShape ?? [
    '动作旁白：括号里用「他」开头，六到十五字，只写看得见的动作。',
    '台词：全角引号，一句八到二十字，短句为主，少形容词。',
    '一轮一百二到三百五十字，最多不超过四百。',
    '结尾状态栏：四项，感情进度带百分比与原因。',
  ], '- '))
  lines.push('')
  lines.push('## 二、原句摘录')
  lines.push('')
  for (const sample of novel.voice?.samples ?? []) {
    lines.push(`### ${sample.label}`)
    lines.push('')
    for (const line of sample.lines ?? []) {
      lines.push(`- （第 ${line.round} 轮）${line.text}`)
    }
    lines.push('')
  }
  if ((novel.voice?.samples ?? []).length === 0) {
    lines.push('（没有配置 voice.samples，可用 03_最近原文 代替）')
    lines.push('')
  }
  lines.push('## 三、常用词与禁用词')
  lines.push('')
  lines.push(`常用：${(novel.voice?.allowWords ?? []).join(' / ') || '（未配置）'}`)
  lines.push('')
  lines.push(`禁用：${(novel.voice?.denyWords ?? []).join(' / ') || '（未配置）'}`)
  lines.push('')
  lines.push('## 四、现在的情绪刻度')
  lines.push('')
  lines.push(list(novel.voice?.nowTone ?? ['（未配置）']))
  lines.push('')
  lines.push('## 五、反例对照')
  lines.push('')
  lines.push(table(
    [
      ['写成长句、堆形容词', '一句八到二十字'],
      ['用比喻（仿佛、就像、像一根针）', '直接写动作'],
      ['写对方心理（他觉得她……）', '只写他能看见的'],
      ['一轮写完一整天', '只推进一个小动作'],
    ],
    ['错误写法', '改成'],
  ))
  lines.push('')
  lines.push('## 六、状态栏模板')
  lines.push('')
  lines.push('```text')
  lines.push('状态栏')
  lines.push(`心情：${novel.rules?.statusBar?.sample?.mood ?? '（此刻的心情，一句口语）'}`)
  lines.push(`好感度：${novel.current?.affection ?? '100%'}（原因）`)
  lines.push(`衣着：${novel.rules?.statusBar?.sample?.outfit ?? '（穿什么，在哪儿）'}`)
  lines.push('想法：（四到六句口语，写他心里转的念头）')
  lines.push('```')
  lines.push('')
  return `${lines.join('\n')}\n`
}

/** 06_记忆锚点 */
export function buildAnchor(novel) {
  const hero = novel.ai?.name ?? '男主'
  const girl = novel.user?.name ?? '女主'
  const memory = novel.memory ?? {}
  const lines = []
  lines.push('# 记忆锚点')
  lines.push('')
  lines.push('用法：它忘了旧事，把这份整段发过去，说「记住这些，不要问，直接接」。')
  lines.push('')
  lines.push('## 一、这一刻')
  lines.push('')
  lines.push(currentBlock(novel))
  lines.push('')
  lines.push('## 二、两个人对照')
  lines.push('')
  lines.push(table(
    [
      [hero, `${novel.ai?.age ?? ''}`, novel.ai?.identity ?? '', novel.ai?.home ?? '', novel.ai?.body ?? '', `${girl}叫他${hero}`],
      [girl, `${novel.user?.age ?? ''}`, novel.user?.identity ?? '', novel.user?.home ?? '', novel.user?.body ?? '', `叫他${hero}`],
    ],
    ['', '年龄', '身份', '住处', '身体', '叫法'],
  ))
  lines.push('')
  if (novel.relationship) {
    lines.push(`关系：${novel.relationship}`)
    lines.push('')
  }
  lines.push('## 三、身边的人')
  lines.push('')
  lines.push(list((memory.people ?? []).map((person) => `${person.name}：${person.line}`)))
  lines.push('')
  lines.push('## 四、这段日子')
  lines.push('')
  lines.push(list((memory.events ?? []).map((event) => `第 ${event.round} 轮：${event.line}`)))
  lines.push('')
  lines.push('## 五、他说过的话')
  lines.push('')
  lines.push(list((memory.promises ?? []).map((item) => `（第 ${item.round} 轮）「${item.quote}」${item.note ? `——${item.note}` : ''}`)))
  lines.push('')
  lines.push('## 六、物件')
  lines.push('')
  lines.push(list((memory.objects ?? []).map((object) => `${object.name}：${object.line}`)))
  lines.push('')
  lines.push('## 七、没落地的事')
  lines.push('')
  lines.push(list(novel.current?.openThreads ?? []))
  lines.push('')
  lines.push('## 八、最容易记错的几件事')
  lines.push('')
  lines.push(list(memory.mistakes ?? []))
  lines.push('')
  return `${lines.join('\n')}\n`
}

/** 07_一站式接续 */
function clip(text, budget) {
  const value = String(text ?? '').trim()
  if (value.length <= budget) return value
  return `${value.slice(0, budget).trimEnd()}\n\n（后面截断了；完整内容在工作目录的对应文件里）`
}

/** Settings + memory cards + recalled snippets, all read from the work folder. */
// 嵌进 prompt 时把知识库自带的 # 标题降两级，免得把 prompt 的章节结构打乱
function demoteHeadings(text) {
  return String(text ?? '').replace(/^(#{1,4})\s/gm, (_match, hashes) => `${'#'.repeat(Math.min(6, hashes.length + 2))} `)
}

function contextBlock(context) {
  const lines = []
  // 四、知识库：工作目录就是大脑，模块化取用
  const kb = context?.kb ?? null
  lines.push('## 四、知识库（工作目录就是你的大脑，写之前先按这个来）')
  lines.push('')
  if (!kb || (!kb.text && !kb.index)) {
    lines.push('（这个档案还没建知识库；以「你要记住的事」和下面的最近原文为准。）')
  } else {
    if (kb.index) {
      lines.push('索引：')
      lines.push('')
      lines.push(demoteHeadings(clip(kb.index, 2600)))
      lines.push('')
    }
    if (kb.text) {
      lines.push('按模块取用：')
      lines.push('')
      lines.push(demoteHeadings(clip(kb.text, 16500)))
      lines.push('')
    }
    lines.push('这些是记忆，不是情节：不要复述它们，也不要说「我翻了知识库」。写的时候照着它，别改设定。')
  }
  lines.push('')
  const settings = context?.settings ?? []
  lines.push('## 五、工作目录里的设定（照这个来，别自己改）')
  lines.push('')
  if (settings.length === 0) {
    lines.push('（工作目录里还没有人设/规则文件；下面「你要记住的事」就是全部口径。）')
  } else {
    lines.push(`这些是工作目录里的文件，写之前按它们来：${settings.map((item) => item.name).join('、')}。`)
    lines.push('')
    let used = 0
    for (const item of settings) {
      const budget = Math.min(2200, 7000 - used)
      if (budget < 200) break
      const body = demoteHeadings(clip(item.text, budget))
      used += body.length
      lines.push(`### ${item.name}`)
      lines.push('')
      lines.push(body)
      lines.push('')
    }
  }
  lines.push('')
  const cards = context?.cards ?? []
  const index = context?.index ?? ''
  const recalls = context?.recalls ?? []
  lines.push('## 六、记忆卡与检索片段')
  lines.push('')
  if (cards.length === 0 && recalls.length === 0) {
    lines.push('（还没有记忆卡。前面的事实以「你要记住的事」和上面的原文为准。）')
  } else {
    if (index) {
      const table = index.split('\n').filter((line) => line.startsWith('|') || line.startsWith('-')).join('\n')
      if (table.trim() !== '') {
        lines.push('索引（节选）：')
        lines.push('')
        lines.push(clip(table, 1200))
        lines.push('')
      }
    }
    for (const card of cards.slice(-2)) {
      lines.push(`### ${card.name}（第 ${card.from}—${card.to} 轮）`)
      lines.push('')
      lines.push(clip(card.text, 2000))
      lines.push('')
    }
    if (recalls.length > 0) {
      lines.push('### 按当前场景检索到的片段')
      lines.push('')
      for (const hit of recalls) {
        lines.push(`- **${hit.kind} · ${hit.name}**：${hit.snippet}`)
      }
      lines.push('')
    }
  }
  lines.push('')
  return lines
}

export function buildOneShot(novel, rounds, tailFrom, tailTo, context = null) {
  const hero = novel.ai?.name ?? '男主'
  const girl = novel.user?.name ?? '女主'
  const recent = buildRecent(rounds, tailFrom, tailTo, girl, hero)
  const inner = recent.split('\n').slice(4).join('\n').trim()
  const lines = []
  lines.push(`# 一站式接续｜${novel.title ? `《${novel.title}》` : '（未命名）'}`)
  lines.push('')
  lines.push('用法：从下面的分割线后整段复制，粘进新对话的第一条消息。一条消息接住全部，不需要再传附件。')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 一、你我是谁')
  lines.push('')
  lines.push(`接下来你写${hero}，我写${girl}。你只写他的动作、台词、神态跟一点心里的转念；我的动作和台词我自己写，不要替我。`)
  lines.push('')
  lines.push(`- ${hero}：${novel.ai?.age ?? ''} 岁，${novel.ai?.identity ?? ''}。说话短，少形容词，习惯用「行」「这事儿」「往后」。`)
  lines.push(`- ${girl}：${novel.user?.age ?? ''} 岁，${novel.user?.identity ?? ''}。会顶嘴，会自己拿主意，叫他${novel.user?.callName ?? '哥哥'}。`)
  if (novel.relationship) lines.push(`- 关系：${novel.relationship}。`)
  lines.push(`- 你就是${hero}，不是旁白、不是助手。她的动作、台词、心理都由我来写，你只写你看见的、你做的、你说的。`)
  lines.push(`- 你的思考也用他的眼睛：不写「作为 AI」「我需要扮演」「用户想要」这类话，不去分析规则，只按他知道的事、他在意的事往下想。`)
  lines.push('')
  lines.push('## 二、现在这一刻')
  lines.push('')
  lines.push(currentBlock(novel))
  lines.push('')
  lines.push('## 三、你要记住的事')
  lines.push('')
  lines.push(list(novel.oneShotMemory ?? []))
  lines.push('')
  if (context) {
    for (const line of contextBlock(context)) lines.push(line)
  }
  lines.push(context ? '## 七、这是最近几轮的原文，照这个语气写' : '## 四、这是最近几轮的原文，照这个语气写')
  lines.push('')
  lines.push(inner)
  lines.push('')
  lines.push(context ? '## 八、写法' : '## 五、写法')
  lines.push('')
  lines.push(list(rulesBlock(novel), '1. '))
  lines.push('')
  lines.push(`${rulesBlock(novel).length + 1}. 你自己的人设可以自己更新：这一轮里出现了新的习惯、说法、对她的新态度，就在回复之后调用 novel_archive_kb（action:"append", module:"hero", cardText:"一句话记下这处新侧面"），只追加，不改写已有设定，一轮最多一条；我说「更新人设」时，就把这一段里他的人物侧面整理成几条追加进去。`)
  lines.push('')
  lines.push(context ? '## 九、怎么开始' : '## 六、怎么开始')
  lines.push('')
  lines.push('先用两三句话复述：现在什么时候、在哪儿、感情进度多少、我上一句说了什么、从第几轮接。然后停住，等我开口。不要先写回复。')
  lines.push('')
  return `${lines.join('\n')}\n`
}
