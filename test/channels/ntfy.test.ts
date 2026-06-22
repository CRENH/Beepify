import { describe, it, expect, vi } from 'vitest'
import { ntfyChannel } from '../../src/channels/ntfy'
import type { RenderedMessage } from '../../src/core/types'

const msg: RenderedMessage = {
  title: '🔔 需要授权 · H',
  body: 'Bash: ls',
  group: 'Beepify',
  event: { kind: 'needs-approval', agent: 'a', host: 'H', project: 'p', ts: 1 },
}

describe('ntfyChannel', () => {
  it('skips when topic missing', async () => {
    const r = await ntfyChannel.send(msg, { type: 'ntfy' })
    expect(r).toMatchObject({ channel: 'ntfy', ok: false, skipped: true })
  })

  it('POSTs JSON {topic,title,message} to the server (unicode-safe)', async () => {
    let url = ''
    let init: RequestInit = {}
    const f = vi.fn(async (u: string, i: RequestInit) => { url = u; init = i; return new Response('', { status: 200 }) })
    vi.stubGlobal('fetch', f)
    const r = await ntfyChannel.send(msg, { type: 'ntfy', topic: 'T', server: 'https://ntfy.sh' })
    expect(r.ok).toBe(true)
    expect(url).toBe('https://ntfy.sh')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ topic: 'T', title: msg.title, message: msg.body })
    vi.unstubAllGlobals()
  })
})
