const BROWSER_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  referer: 'https://chat.deepseek.com/',
}

const CONTENT_ENDPOINT = 'https://chat.deepseek.com/api/v0/share/content'
const FILE_ENDPOINT = 'https://files.deepseeksvc.com/api'

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...BROWSER_HEADERS, ...(options.headers ?? {}) },
    signal: options.signal,
  })
  return response
}

/** Fetch the shared conversation payload. Returns { code, data } as served. */
export async function fetchShare(shareId, signal) {
  const url = `${CONTENT_ENDPOINT}?share_id=${encodeURIComponent(shareId)}`
  const response = await request(url, { signal })
  if (!response.ok) {
    throw new Error(`分享内容接口返回 HTTP ${response.status}（${shareId}）`)
  }
  const payload = await response.json()
  if (payload?.code !== 0) {
    throw new Error(`分享内容接口返回 code=${payload?.code}：${payload?.msg ?? '未知错误'}`)
  }
  const messages = payload?.data?.biz_data?.messages
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('分享内容里没有 messages：该链接可能已失效或未公开')
  }
  return { payload, messages }
}

/** Signed attachment URL: the file service wants the `ty` query flag appended. */
export function attachmentUrl(signedPath) {
  const path = String(signedPath ?? '').trim()
  if (path === '') return null
  const absolute = path.startsWith('http') ? path : `${FILE_ENDPOINT}${path.startsWith('/') ? '' : '/'}${path}`
  return absolute.includes('ty=') ? absolute : `${absolute}${absolute.includes('?') ? '&' : '?'}ty=r`
}

/** Download one attachment by its signed path. */
export async function downloadAttachment(signedPath, signal) {
  const url = attachmentUrl(signedPath)
  if (url === null) throw new Error('附件缺少 signed_path，无法下载')
  const response = await request(url, { signal, headers: { accept: '*/*' } })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`附件下载失败 HTTP ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`)
  }
  return Buffer.from(await response.arrayBuffer())
}
