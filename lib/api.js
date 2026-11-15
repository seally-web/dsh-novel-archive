/**
 * Panel <-> host HTTP API: `/novel-archive/api/*`.
 *
 * The conversation panel calls these routes directly; the agent-facing tools
 * call the same library functions. One implementation, two faces.
 */
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { runExtract } from './extract.js'
import { assembleArchive } from './assemble.js'
import { buildContinuation } from './continue.js'
import { readState, readTurns } from './state.js'
import { readJson } from './util.js'
import { loadNovel } from './novel.js'
import { buildDigest, coverage, listCards, recall, rebuildIndex, saveCard } from './memory.js'
import { appendKb, kbIndex, readKb, readModule, rebuildIndex as rebuildKbIndex, scaffold, syncKb } from './kb.js'
import { existsSync, readdirSync, statSync } from 'node:fs'

export const PREFIX = '/novel-archive/api'
const BODY_LIMIT = 32 * 1024 * 1024

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

function failure(error) {
  return { ok: false, error: { message: String(error?.message ?? error) } }
}

function suffixOf(url) {
  const path = String(url || '/').split('?')[0]
  const at = path.indexOf(PREFIX)
  const rest = at === -1 ? path : path.slice(at + PREFIX.length)
  return rest.replace(/^\/+|\/+$/g, '')
}

function queryParam(url, key) {
  const at = String(url || '').indexOf('?')
  if (at === -1) return undefined
  return new URLSearchParams(String(url).slice(at + 1)).get(key) ?? undefined
}

function existsDir(path) {
  try { return statSync(path).isDirectory() } catch { return false }
}

async function readBody(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > BODY_LIMIT) throw new Error('上传内容太大（超过 32MB），分批再试')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text)
}

export function createApiHandler({ cwd = () => process.cwd() } = {}) {
  const defaultDir = () => resolve(join(cwd(), '小说整理'))
  const absDir = (value) => {
    const text = String(value ?? '').trim()
    if (text === '') return text
    return isAbsolute(text) ? text : resolve(cwd(), text)
  }

  const browse = (value) => {
    const home = homedir()
    const base = String(value ?? '').trim() === '' ? home : absDir(value)
    const current = existsDir(base) ? base : home
    const entries = []
    try {
      for (const name of readdirSync(current)) {
        if (name.startsWith('.')) continue
        const full = join(current, name)
        let stat = null
        try { stat = statSync(full) } catch { continue }
        if (!stat.isDirectory()) continue
        entries.push({ name, path: full })
      }
    } catch { /* unreadable */ }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    const parent = current === '/' ? null : resolve(current, '..')
    return { path: current, parent: parent === current ? null : parent, home, dirs: entries }
  }

  return async function handler(request, response) {
    const route = suffixOf(request.url)
    try {
      if (request.method === 'GET' && route === 'config') {
        return sendJson(response, 200, {
          ok: true,
          value: { cwd: cwd(), home: homedir(), defaultOut: defaultDir(), platform: process.platform },
        })
      }

      if (request.method === 'GET' && route === 'state') {
        const dir = queryParam(request.url, 'dir') ?? defaultDir()
        return sendJson(response, 200, { ok: true, value: readState(absDir(dir)) })
      }

      if (request.method === 'POST' && route === 'extract') {
        const body = await readBody(request)
        const report = await runExtract(
          {
            url: body.url,
            outDir: absDir(body.outDir) || resolve(join(cwd(), '小说整理')),
            chunkSize: body.chunkSize,
            attachment: body.attachment !== false,
            uploads: Array.isArray(body.uploads) ? body.uploads : [],
          },
          undefined,
        )
        return sendJson(response, 200, { ok: true, value: { report } })
      }

      if (request.method === 'POST' && route === 'continue') {
        const body = await readBody(request)
        return sendJson(response, 200, {
          ok: true,
          value: buildContinuation({ outDir: absDir(body.dir), tailRounds: body.tailRounds }),
        })
      }

      if (request.method === 'POST' && route === 'assemble') {
        const body = await readBody(request)
        const report = assembleArchive({
          outDir: absDir(body.dir),
          makeZip: body.zip !== false,
          tailRounds: body.tailRounds,
        })
        return sendJson(response, 200, {
          ok: true,
          value: { chapters: report.chapters, inferredNovel: report.inferredNovel, warnings: report.warnings, files: report.files },
        })
      }

      if (request.method === 'GET' && route === 'novel') {
        const dir = absDir(queryParam(request.url, 'dir') ?? defaultDir())
        const turnsFile = join(dir, 'analysis', 'turns.jsonl')
        const rounds = existsSync(turnsFile) ? readTurns(turnsFile) : []
        const loaded = loadNovel(dir, { rounds })
        return sendJson(response, 200, { ok: true, value: { novel: loaded.novel, inferred: loaded.inferred, file: loaded.file } })
      }

      if (request.method === 'GET' && route === 'browse') {
        return sendJson(response, 200, { ok: true, value: browse(queryParam(request.url, 'path')) })
      }

      if (request.method === 'GET' && route === 'memory') {
        const dir = absDir(queryParam(request.url, 'dir') ?? defaultDir())
        const state = readState(dir)
        return sendJson(response, 200, {
          ok: true,
          value: { ...coverage(dir, state.rounds), cards: listCards(dir).map((card) => ({ name: card.name, from: card.from, to: card.to, size: card.size })) },
        })
      }

      if (request.method === 'POST' && route === 'memory') {
        const body = await readBody(request)
        const dir = absDir(body.dir)
        if (body.action === 'digest') {
          const text = buildDigest(dir, { from: Number(body.from), to: Number(body.to), every: body.every })
          return sendJson(response, 200, { ok: true, value: { text, from: Number(body.from), to: Number(body.to) } })
        }
        if (body.action === 'save') {
          const saved = saveCard(dir, { from: body.from, to: body.to, text: body.text ?? body.cardText, title: body.title ?? body.cardTitle })
          return sendJson(response, 200, { ok: true, value: saved })
        }
        if (body.action === 'index') {
          return sendJson(response, 200, { ok: true, value: rebuildIndex(dir) })
        }
        return sendJson(response, 400, failure(new Error(`memory 的 action 只认 digest / save / index`)))
      }


      if (request.method === 'GET' && route === 'kb') {
        const dir = absDir(queryParam(request.url, 'dir') ?? defaultDir())
        const key = queryParam(request.url, 'module')
        const modules = kbIndex(dir)
        const kb = readKb(dir, { budget: 12000 })
        return sendJson(response, 200, { ok: true, value: { modules, index: kb.index, chars: kb.chars, module: key ? readModule(dir, key) : null } })
      }

      if (request.method === 'POST' && route === 'kb') {
        const body = await readBody(request)
        const dir = absDir(body.dir)
        if (body.action === 'init') {
          const created = scaffold(dir, { novel: null })
          return sendJson(response, 200, { ok: true, value: { created: created.created, modules: kbIndex(dir) } })
        }
        if (body.action === 'index') {
          const built = rebuildKbIndex(dir)
          return sendJson(response, 200, { ok: true, value: { file: built.file, modules: built.modules } })
        }
        if (body.action === 'sync') {
          const turnsFile = join(dir, 'analysis', 'turns.jsonl')
          const rounds = existsSync(turnsFile) ? readTurns(turnsFile) : []
          const loaded = loadNovel(dir, { rounds })
          const chapters = []
          const synced = syncKb(dir, { novel: loaded.novel, chapters, settingText: '' })
          return sendJson(response, 200, { ok: true, value: { written: synced.written, events: synced.events, inferred: loaded.inferred } })
        }
        if (body.action === 'append') {
          const saved = appendKb(dir, String(body.module ?? ''), String(body.text ?? body.cardText ?? ''), { file: body.file })
          return sendJson(response, 200, { ok: true, value: saved })
        }
        return sendJson(response, 400, failure(new Error(`kb 的 action 只认 init / index / sync / append`)))
      }

      if (request.method === 'GET' && route === 'recall') {
        const dir = absDir(queryParam(request.url, 'dir') ?? defaultDir())
        const hits = recall(dir, queryParam(request.url, 'q') ?? '', { limit: 8 })
        return sendJson(response, 200, { ok: true, value: { hits } })
      }

      return sendJson(response, 404, failure(new Error(`未知接口：${route}`)))
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : 500
      return sendJson(response, status, failure(error))
    }
  }
}
