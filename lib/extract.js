import { join, resolve } from 'node:path'
import { statSync } from 'node:fs'
import { fetchShare, downloadAttachment } from './share.js'
import { parseRounds, summarizeRounds } from './model.js'
import { docxToText } from './docx.js'
import { writeArchive } from './assemble.js'
import { scaffold } from './kb.js'
import { collectUploads, mergeSettings } from './uploads.js'
import { shareIdOf } from './util.js'

/** Run stage 1: share link -> working tree. Returns the model-facing report text. */
export async function runExtract(args, signal) {
  const shareId = shareIdOf(args.url)
  const outDir = String(args.outDir ?? '').trim() === ''
    ? resolve(join(process.cwd(), `小说整理_${shareId}`))
    : resolve(String(args.outDir))
  const chunkSize = Math.max(20, Math.min(400, Number(args.chunkSize ?? 80)))
  const withAttachment = args.attachment !== false

  const { payload, messages } = await fetchShare(shareId, signal)
  const rounds = parseRounds(messages)
  if (rounds.length === 0) throw new Error('解析后没有任何轮次：分享内容格式可能变了')
  const stats = summarizeRounds(rounds)
  const contentBuffer = Buffer.from(JSON.stringify(payload))

  let attachment = null
  const candidate = rounds
    .flatMap((round) => round.user.files.map((file) => ({ round: round.i, ...file })))
    .find((file) => file.signedPath)
  if (withAttachment && candidate) {
    const buffer = await downloadAttachment(candidate.signedPath, signal)
    let text = ''
    try {
      text = /\.docx$/i.test(candidate.name) ? docxToText(buffer) : buffer.toString('utf8')
    } catch (error) {
      stats.attachmentError = String(error?.message ?? error)
    }
    attachment = { name: candidate.name, buffer, text, round: candidate.round }
  }

  // User-supplied 人设 / 补充文件 merge with the share attachment into one
  // settings document; the merged text drives the continuation pack.
  const { uploads, problems } = collectUploads(args)
  const merged = mergeSettings({
    uploads,
    attachmentText: attachment?.text ?? '',
    attachmentName: attachment?.name ?? '',
  })

  // 建知识库骨架：整理完就能按模块往里放剧情/人物/事件
  try {
    scaffold(outDir, { novel: null })
  } catch {
    /* 骨架失败不影响整理结果 */
  }

  const written = writeArchive({
    outDir,
    rounds,
    stats,
    messages,
    sourceUrl: String(args.url),
    contentBuffer,
    attachment,
    settingText: merged.text,
    uploads,
    chunkSize,
  })

  const head = [
    `整理目录：${written.outDir}`,
    `来源：${args.url}`,
    `规模：${stats.rounds} 轮 · 正文＋思考 ${stats.totalChars.toLocaleString('en-US')} 字符（约 ${(stats.totalChars / 10000).toFixed(1)} 万字）`,
    `时间跨度：${stats.firstAt} — ${stats.lastAt}`,
    `日期卷：${stats.byDay.length} 天；分章块：${written.chunkCount} 块（每块 ${chunkSize} 轮）`,
    stats.incomplete > 0 ? `注意：${stats.incomplete} 轮没有 AI 回复` : '配对完整，没有缺回复的轮次',
    `已写：01_完整对话记录.md（约 ${(statSync(written.transcriptFile).size / 1024 / 1024).toFixed(1)}MB）、analysis/turns.jsonl、analysis/chunks/、PLAN.md`,
  ]
  for (const bucket of stats.byDay) {
    head.push(`  · ${bucket.day}：第 ${bucket.from}—${bucket.to} 轮（${bucket.count}）`)
  }
  if (attachment) {
    head.push(
      '',
      `已下载附件：${attachment.name}（${(attachment.buffer.length / 1024).toFixed(1)}KB）${
        attachment.text ? `，抽出正文 ${attachment.text.length} 字符` : ''
      }`,
    )
  }
  if (merged.settingCount > 0 || merged.extraCount > 0) {
    head.push(
      `已并入你上传的文件：人设 ${merged.settingCount} 个、补充 ${merged.extraCount} 个（原样存在 share/uploads/）`,
    )
  }
  if (merged.text) head.push(`设定合并后 ${merged.text.length.toLocaleString('en-US')} 字符，存为 share/setting.txt`)
  for (const problem of problems) head.push(`上传文件未并入：${problem}`)
  if (stats.attachmentError) head.push(`附件解析失败：${stats.attachmentError}`)

  const next = [
    '',
    '下一步（PLAN.md 里有完整提示词）：',
    '1. 把 analysis/novel.example.json 复制成 novel.json，填人物、当前状态、规则、记忆、语气样本、分卷。',
    `2. 对 ${written.chunkCount} 块各派一个子代理：读 analysis/chunks/chunk_NN.md，写 analysis/beats/block_NN.md 与 analysis/chars/chunk_NN.json。`,
    '3. 写 02_人物设定.md。',
    '4. 调 novel_archive_assemble 生成 03_情节发展.md、续接包 00—07 与 zip。',
  ]
  return `${head.join('\n')}\n${next.join('\n')}`
}
