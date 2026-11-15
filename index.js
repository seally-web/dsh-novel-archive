/**
 * dsh-novel-archive — Host plugin.
 *
 * Turns a DeepSeek share link into the archive set the user asked for:
 * a full transcript, per-chapter source chunks, a plot outline assembled from
 * the chapters, and a zip continuation pack. The LLM parts (chapter summaries,
 * the character bible) stay with the agent; everything deterministic lives here.
 */
import { isAbsolute, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { runExtract } from './lib/extract.js'
import { assembleArchive } from './lib/assemble.js'
import { searchTurns } from './lib/search.js'
import { buildContinuation } from './lib/continue.js'
import { readState } from './lib/state.js'
import { buildDigest, coverage, listCards, recall, rebuildIndex, saveCard } from './lib/memory.js'
import { appendKb, kbIndex, readKb, readModule, rebuildIndex as rebuildKbIndex, scaffold, syncKb } from './lib/kb.js'
import { createApiHandler, PREFIX } from './lib/api.js'
import { listFiles, readJson } from './lib/util.js'

/** Runtime-identity stand-in for the host's typing helper. */
const defineTool = (definition) => definition

export const inject = ['tools', 'webServer', 'workspaceRegistry', 'workingDirectory']

const toolEffect = (ctx, definition) =>
  ctx.effect(() => ctx.tools.register(defineTool(definition)), `dsh-novel-archive: ${definition.name}`)

export function apply(ctx) {
  // Panel <-> host channel: the conversation dock opens a dialog that talks to
  // these routes; the tools below share the same implementation.
  const activeWorkspace = () => {
    try {
      const list = ctx.workspaceRegistry?.list?.() ?? []
      const first = Array.isArray(list) ? list.find((item) => typeof item?.path === 'string' && item.path !== '') : undefined
      return first?.path ?? process.cwd()
    } catch {
      return process.cwd()
    }
  }
  const absDir = (value, base = activeWorkspace()) => {
    const text = String(value ?? '').trim()
    if (text === '') return ''
    return isAbsolute(text) ? text : resolve(base, text)
  }
  // Tools run on behalf of one Session: relative paths mean that Session's
  // working directory, not the host process's.
  const sessionCwd = (exec) => {
    try {
      const session = exec?.agent?.session
      const current = ctx.workingDirectory?.get?.(session)
      if (typeof current === 'string' && current !== '') return current
    } catch { /* fall through to the active workspace */ }
    return activeWorkspace()
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: createApiHandler({ cwd: activeWorkspace }),
  }), 'dsh-novel-archive: api')

  toolEffect(ctx, {
    name: 'novel_archive_extract',
    description:
      'Stage 1 of 小说整理: fetch a DeepSeek share link, download its attachment, and lay out the working directories. '
      + 'Writes 01_完整对话记录.md (provisional labels), analysis/turns.jsonl, analysis/chunks/chunk_NN.md (80 rounds each), '
      + 'share/setting.txt, and PLAN.md with the exact next steps. Run this once per share link, then follow PLAN.md.',
    parameters: {
      url: { type: 'string', required: true, description: 'DeepSeek share link, e.g. https://chat.deepseek.com/share/xxxxxxxx' },
      outDir: { type: 'string', description: 'Working directory. Defaults to ./小说整理_<share-id> under the current directory.' },
      chunkSize: { type: 'integer', description: 'Rounds per chapter chunk. Default 80.' },
      attachment: { type: 'boolean', description: 'Download the first attached file and extract its text. Default true.' },
      settingPaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Absolute paths of the user\'s own 人设 files (.txt/.md/.docx). They are read and placed above the share attachment in share/setting.txt.',
      },
      extraPaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Absolute paths of supplementary files (extra rules, later plot, notes). Merged into share/setting.txt after the 人设.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 600000,
    async execute(args, exec) {
      return runExtract({ ...args, outDir: absDir(args.outDir, sessionCwd(exec)) }, exec.signal)
    },
  })

  toolEffect(ctx, {
    name: 'novel_archive_search',
    description:
      'Search the extracted rounds of a novel archive by literal keyword or regular expression, with surrounding context and round numbers. '
      + 'Use it to build character dossiers and to check facts before writing 人物设定 or 情节发展.',
    parameters: {
      outDir: { type: 'string', required: true, description: 'Working directory created by novel_archive_extract.' },
      terms: { type: 'array', items: { type: 'string' }, required: true, description: 'Keywords or patterns to look up.' },
      regex: { type: 'boolean', description: 'Treat terms as JavaScript regular expressions. Default false (literal).' },
      context: { type: 'integer', description: 'Characters of context on each side. Default 160.' },
      maxHits: { type: 'integer', description: 'Hits shown per term. Default 3.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 120000,
    async execute(args, exec) {
      const root = resolve(absDir(args.outDir, sessionCwd(exec)))
      const turnsFile = join(root, 'analysis', 'turns.jsonl')
      if (!existsSync(turnsFile)) throw new Error(`找不到 ${turnsFile}，先运行 novel_archive_extract`)
      return searchTurns(turnsFile, args)
    },
  })

  toolEffect(ctx, {
    name: 'novel_archive_status',
    description:
      'Report how far a novel archive has progressed: rounds extracted, chapter beats written, novel.json filled, character bible present. '
      + 'Returns the missing piece so the agent knows whether to fan out chapters or assemble.',
    parameters: {
      outDir: { type: 'string', required: true, description: 'Working directory created by novel_archive_extract.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 60000,
    async execute(args, exec) {
      const root = resolve(absDir(args.outDir, sessionCwd(exec)))
      const analysisDir = join(root, 'analysis')
      const turnsFile = join(analysisDir, 'turns.jsonl')
      if (!existsSync(turnsFile)) throw new Error(`找不到 ${turnsFile}，先运行 novel_archive_extract`)

      const stats = readJson(join(analysisDir, 'stats.json'), {}).stats ?? {}
      const chunks = readJson(join(analysisDir, 'chunks.json'), [])
      const beats = listFiles(join(analysisDir, 'beats'), /^block_.*\.md$/)
      const chars = listFiles(join(analysisDir, 'chars'), /\.json$/)
      const novel = existsSync(join(root, 'novel.json'))
      const bible = existsSync(join(root, '02_人物设定.md'))
      const plot = existsSync(join(root, '03_情节发展.md'))
      const zip = listFiles(root, /\.zip$/).length > 0

      const filled = novel
        ? (() => {
            const value = readJson(join(root, 'novel.json'), {})
            const empty = []
            if (!value.title || String(value.title).startsWith('（')) empty.push('title')
            if (!value.current?.day) empty.push('current.day')
            if (!value.current?.place) empty.push('current.place')
            if (!value.current?.affection) empty.push('current.affection')
            if (!value.current?.lastAiQuote) empty.push('current.lastAiQuote')
            if ((value.voice?.samples ?? []).length === 0) empty.push('voice.samples')
            if ((value.volumes?.items ?? []).length === 0) empty.push('volumes.items')
            return empty
          })()
        : ['novel.json 不存在']

      const lines = [
        `目录：${root}`,
        `原文：${stats.rounds ?? '?'} 轮，${(stats.totalChars ?? 0).toLocaleString('en-US')} 字符`,
        `分章块：${chunks.length}；beats 已写：${beats.length}${chunks.length > 0 ? `（完成 ${Math.round((beats.length / chunks.length) * 100)}%）` : ''}；chars 已写：${chars.length}`,
        `novel.json：${novel ? '有' : '缺'}${novel && filled.length > 0 ? `，待填：${filled.join('、')}` : ''}`,
        `02_人物设定.md：${bible ? '有' : '缺'}；03_情节发展.md：${plot ? '有' : '缺'}；zip：${zip ? '有' : '缺'}`,
      ]
      const ready = chunks.length > 0 && beats.length >= chunks.length && novel && filled.length === 0
      lines.push('')
      lines.push(ready ? '状态：可以调 novel_archive_assemble 装配了。' : '状态：还没齐，下一步见 PLAN.md。')
      return lines.join('\n')
    },
  })

  toolEffect(ctx, {
    name: 'novel_archive_assemble',
    description:
      'Stage 2 of 小说整理: rebuild 01_完整对话记录.md with the real names, assemble 03_情节发展.md from analysis/beats/block_NN.md, '
      + 'generate the continuation pack (00—07, md+txt), and zip it. Requires novel.json, 02_人物设定.md, and the beat files.',
    parameters: {
      outDir: { type: 'string', required: true, description: 'Working directory created by novel_archive_extract.' },
      tailRounds: { type: 'integer', description: 'Rounds kept verbatim in the continuation pack. Default 60.' },
      zip: { type: 'boolean', description: 'Build 小说续接包.zip. Default true.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 300000,
    async execute(args, exec) {
      const report = assembleArchive({
        outDir: absDir(args.outDir, sessionCwd(exec)),
        makeZip: args.zip !== false,
        tailRounds: args.tailRounds,
      })
      const lines = [
        `装配完成：${report.outDir}`,
        `章节：${report.chapters} 章${report.expectedChapters ? `（分章块 ${report.expectedChapters}）` : ''}`,
        `最近原文：第 ${report.tail.from}—${report.tail.to} 轮`,
      ]
      if (report.warnings.length > 0) {
        lines.push('', '注意：', ...report.warnings.map((warning) => `- ${warning}`))
      }
      lines.push('', '产物：')
      for (const file of report.files) lines.push(`- ${file.file}（${(file.bytes / 1024).toFixed(1)}KB）`)
      lines.push('', '下一步：把 zip 或 07 的 txt 交付给用户，并说明从哪一轮接。')
      return lines.join('\n')
    },
  })

  toolEffect(ctx, {
    name: 'novel_archive_continue',
    description:
      'Build the ready-to-paste continuation prompt for an archive: identity, current scene, memory anchors, the last few rounds verbatim, and the writing rules. '
      + 'Returns that text plus the next round number. The panel uses the same builder for its one-click continue button.',
    parameters: {
      outDir: { type: 'string', required: true, description: 'Working directory created by novel_archive_extract.' },
      tailRounds: { type: 'integer', description: 'How many recent rounds to include verbatim. Default 8.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 120000,
    async execute(args, exec) {
      const built = buildContinuation({ outDir: absDir(args.outDir, sessionCwd(exec)), tailRounds: args.tailRounds })
      return [
        `续接点：第 ${built.nextRound} 轮（上一轮 ${built.tailTo} 已经完整）`,
        `人物：${built.hero} / ${built.girl}；现在：${built.day} · ${built.place}`,
        `已写：${built.written}`,
        '',
        '把下面的整段交给用户（新对话的第一条消息，或当前对话直接发送）：',
        '',
        built.prompt,
      ].join('\n')
    },
  })

  toolEffect(ctx, {
    name: 'novel_archive_state',
    description: 'Report one archive directory as compact JSON: rounds, last round, next round, chapters, beats, pack/zip presence, and the novel.json current scene.',
    parameters: {
      outDir: { type: 'string', required: true, description: 'Working directory created by novel_archive_extract.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 60000,
    async execute(args, exec) {
      return JSON.stringify(readState(absDir(args.outDir, sessionCwd(exec))), null, 2)
    },
  })

  toolEffect(ctx, {
    name: 'novel_archive_memory',
    description:
      'Rolling memory for a novel archive. action="status" lists 记忆 cards, covered rounds and the gap to continue from; '
      + '"digest" builds a draft card straight from the rounds (from/to) that you can rewrite; '
      + '"save" stores a card you wrote (from/to/cardTitle/cardText) into 记忆/ and rebuilds 记忆/00_索引.md; '
      + '"index" rebuilds the index only; "recall" searches cards + chapter beats + 设定 files by keyword (query).',
    parameters: {
      outDir: { type: 'string', required: true, description: 'Working directory created by novel_archive_extract.' },
      action: {
        type: 'string',
        required: true,
        description: 'status | digest | save | index | recall',
        enum: ['status', 'digest', 'save', 'index', 'recall'],
      },
      from: { type: 'integer', description: 'First round of the card (digest/save).' },
      to: { type: 'integer', description: 'Last round of the card (digest/save).' },
      every: { type: 'integer', description: 'digest: sample one round every N rounds. Default 8.' },
      cardTitle: { type: 'string', description: 'save: short title for the card.' },
      cardText: { type: 'string', description: 'save: the card body you wrote (5 lines is enough).' },
      query: { type: 'string', description: 'recall: keywords, separated by spaces.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 120000,
    async execute(args, exec) {
      const root = absDir(args.outDir, sessionCwd(exec))
      const state = readState(root)
      if (args.action === 'status') {
        const cover = coverage(root, state.rounds)
        const lines = [
          `记忆卡：${cover.cards} 张，覆盖第 ${cover.from || 0}—${cover.to || 0} 轮（共 ${cover.covered} 轮）`,
          `全书：${state.rounds} 轮；下一轮 ${state.nextRound}`,
          cover.cards > 0 && cover.to < state.rounds - 1
            ? `缺口：第 ${cover.to + 1}—${state.rounds} 轮还没有卡，可以用 action="digest" 出一张底稿`
            : '覆盖是完整的',
        ]
        const cards = listCards(root)
        if (cards.length > 0) {
          lines.push('')
          lines.push('| 文件 | 轮次 |')
          lines.push('| --- | --- |')
          for (const card of cards) lines.push(`| ${card.name} | 第 ${card.from}—${card.to} 轮 |`)
        }
        return lines.join('\n')
      }
      if (args.action === 'digest') {
        return buildDigest(root, { from: Number(args.from), to: Number(args.to), every: args.every })
      }
      if (args.action === 'save') {
        const saved = saveCard(root, { from: Number(args.from), to: Number(args.to), text: args.cardText, title: args.cardTitle })
        return `已存 ${saved.file}（第 ${saved.from}—${saved.to} 轮，${saved.chars} 字符），索引已更新。`
      }
      if (args.action === 'index') {
        const built = rebuildIndex(root)
        return `索引已重建：${built.file}（${built.cards} 张卡，${built.settings} 份设定文件）`
      }
      if (args.action === 'recall') {
        const hits = recall(root, String(args.query ?? ''), { limit: 8 })
        if (hits.length === 0) return '没有命中。换几个更具体的词试试（人名、地点、物件、事件）。'
        return hits.map((hit) => `- **${hit.kind} · ${hit.name}**（${hit.score}）：${hit.snippet}`).join('\n')
      }
      throw new Error(`不认识的 action：${args.action}`)
    },
  })

  toolEffect(ctx, {
    name: 'novel_archive_kb',
    description:
      'Modular knowledge base in the work folder — the AI\'s long-term memory. '
      + 'action="init" creates the folder skeleton (01_剧情 02_角色_他 03_角色_我 04_事件 05_时间线 06_特殊事件 07_其他人物 08_特殊物品 09_生活物品 10_规则 11_记忆卡) and 00_知识库.md; '
      + '"index" rewrites 00_知识库.md; "read" returns the module list (or one module with module="plot"); '
      + '"sync" rebuilds 01_剧情 from beats + roles/rules/timeline from novel.json and appends new events to 04_事件; '
      + '"append" adds a passage to a module (module + cardText, optional file).',
    parameters: {
      outDir: { type: 'string', required: true, description: 'Working directory created by novel_archive_extract.' },
      action: {
        type: 'string',
        required: true,
        description: 'init | index | read | sync | append',
        enum: ['init', 'index', 'read', 'sync', 'append'],
      },
      module: {
        type: 'string',
        description: 'init/append/read: plot | hero | girl | events | timeline | milestones | others | special | life | rules | cards',
      },
      file: { type: 'string', description: 'append: file name inside that module (default: the module\'s main file).' },
      cardText: { type: 'string', description: 'append: the passage to add.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 180000,
    async execute(args, exec) {
      const root = absDir(args.outDir, sessionCwd(exec))
      if (args.action === 'init') {
        const created = scaffold(root, { novel: null })
        return `知识库已建：${root}\n新增 ${created.created.length} 个骨架文件\n${created.created.map((name) => `- ${name}`).join('\n')}`
      }
      if (args.action === 'index') {
        const built = rebuildKbIndex(root)
        const total = built.modules.reduce((sum, row) => sum + row.chars, 0)
        return `00_知识库.md 已重建：${built.modules.length} 个模块，合计 ${total} 字。`
      }
      if (args.action === 'read') {
        if (args.module) {
          const mod = readModule(root, args.module)
          if (mod.files.length === 0) return `${mod.label} 还是空的。`
          return [`# ${mod.label}（${mod.files.length} 个文件，${mod.chars} 字）`, '', ...mod.files.map((item) => `## ${item.name}\n\n${item.text}`)].join('\n')
        }
        const rows = kbIndex(root)
        const lines = ['| 模块 | 目录 | 文件 | 字数 | 最近一份 |', '| --- | --- | --- | --- | --- |']
        for (const row of rows) lines.push(`| ${row.label} | ${row.dir} | ${row.files} | ${row.chars} | ${row.latest || '—'} |`)
        lines.push('', `合计 ${rows.reduce((sum, row) => sum + row.chars, 0)} 字。`)
        return lines.join('\n')
      }
      if (args.action === 'sync') {
        const synced = syncKb(root, {})
        return `知识库已同步：${synced.written.length} 个文件，事件簿新增 ${synced.events} 条。`
      }
      if (args.action === 'append') {
        const saved = appendKb(root, String(args.module ?? ''), String(args.cardText ?? ''), { file: args.file })
        return `已追加到 ${saved.file}（${saved.chars} 字），索引已更新。`
      }
      throw new Error(`不认识的 action：${args.action}`)
    },
  })

}
