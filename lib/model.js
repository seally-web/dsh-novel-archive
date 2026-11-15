import { stamp, chars, sum } from './util.js'

function fragmentsOf(message) {
  return Array.isArray(message?.fragments) ? message.fragments : []
}

function textOf(message, types) {
  return fragmentsOf(message)
    .filter((fragment) => types.includes(fragment?.type))
    .map((fragment) => String(fragment?.content ?? ''))
    .join('')
}

function filesOf(message) {
  const files = []
  for (const fragment of fragmentsOf(message)) {
    if (fragment?.type === 'FILE' && Array.isArray(fragment.files)) files.push(...fragment.files)
  }
  return files
    .filter((file) => file && (file.file_name || file.signed_path))
    .map((file) => ({
      name: file.file_name ?? '(未命名附件)',
      size: Number(file.file_size ?? 0),
      signedPath: file.signed_path ?? null,
      isImage: Boolean(file.is_image),
      id: file.id ?? null,
    }))
}

/** Turn the API message array into ordered rounds of { user, ai }. */
export function parseRounds(messages) {
  const rounds = []
  let open = null

  const push = (round) => rounds.push(round)

  for (const message of messages) {
    const role = String(message?.role ?? '').toUpperCase()
    if (role === 'TIP') continue

    const when = stamp(message?.inserted_at ?? 0)

    if (role === 'USER') {
      if (open) push(open)
      open = {
        user: {
          text: textOf(message, ['REQUEST']),
          files: filesOf(message),
          ts: Number(message?.inserted_at ?? 0),
          day: when.day,
          time: when.time,
        },
        ai: null,
      }
      continue
    }

    if (role === 'ASSISTANT') {
      if (!open) {
        open = { user: { text: '', files: [], ts: Number(message?.inserted_at ?? 0), day: when.day, time: when.time }, ai: null }
      }
      open.ai = {
        text: textOf(message, ['RESPONSE']),
        think: textOf(message, ['THINK']),
        ts: Number(message?.inserted_at ?? 0),
        day: when.day,
        time: when.time,
      }
      push(open)
      open = null
    }
  }

  if (open) push(open)

  return rounds.map((round, index) => ({
    i: index + 1,
    user: round.user,
    ai: round.ai,
  }))
}

export function summarizeRounds(rounds) {
  const byDay = new Map()
  for (const round of rounds) {
    const key = round.user.day
    const bucket = byDay.get(key) ?? { day: key, count: 0, from: round.i, to: round.i }
    bucket.count += 1
    bucket.to = round.i
    byDay.set(key, bucket)
  }

  const incomplete = rounds.filter((round) => round.ai === null).length
  const attachments = rounds.flatMap((round) => round.user.files.map((file) => ({ round: round.i, ...file })))
  const bodyChars = sum(rounds.map((round) => chars(round.user.text) + chars(round.ai?.text)))
  const thinkChars = sum(rounds.map((round) => chars(round.ai?.think)))
  const first = rounds[0]
  const last = rounds.at(-1)

  return {
    rounds: rounds.length,
    incomplete,
    bodyChars,
    thinkChars,
    totalChars: bodyChars + thinkChars,
    firstAt: first ? `${first.user.day} ${first.user.time}` : null,
    lastAt: last?.ai ? `${last.ai.day} ${last.ai.time}` : last ? `${last.user.day} ${last.user.time}` : null,
    byDay: [...byDay.values()],
    attachments,
  }
}
