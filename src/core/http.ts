export function enc(s: string): string {
  return encodeURIComponent(s)
}

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function request(
  url: string,
  opts: RequestOptions = {},
): Promise<{ ok: boolean; status: number }> {
  const {
    method = 'GET',
    headers,
    body,
    timeoutMs = 12000,
    retries = 2,
    retryDelayMs = 1000,
  } = opts

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { method, headers, body, signal: ctrl.signal })
      if (res.ok) return { ok: true, status: res.status }
    } catch {
      // fall through to retry
    } finally {
      clearTimeout(timer)
    }
    if (attempt < retries) await sleep(retryDelayMs)
  }
  return { ok: false, status: 0 }
}
