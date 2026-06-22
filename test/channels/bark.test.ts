import { describe, it, expect, vi } from 'vitest'
import { barkChannel } from '../../src/channels/bark'
import type { RenderedMessage } from '../../src/core/types'

const msg: RenderedMessage = {
  title: '✅ Done · H',
  body: 'Edit: /Users/x/file',
  group: 'Beepify',
  event: { kind: 'done', agent: 'a', host: 'H', project: 'p', ts: 1 },
}

describe('barkChannel', () => {
  it('skips when key missing', async () => {
    const r = await barkChannel.send(msg, { type: 'bark' })
    expect(r).toMatchObject({ channel: 'bark', ok: false, skipped: true })
  })

  it('encodes slashes in title and body (path invariant)', async () => {
    let calledUrl = ''
    const f = vi.fn(async (u: string) => { calledUrl = u; return new Response('', { status: 200 }) })
    vi.stubGlobal('fetch', f)
    const r = await barkChannel.send(msg, { type: 'bark', key: 'K', server: 'https://api.day.app' })
    expect(r.ok).toBe(true)
    expect(calledUrl).toContain('https://api.day.app/K/')
    expect(calledUrl).toContain('%2FUsers%2Fx%2Ffile') // body slashes encoded
    expect(calledUrl).not.toMatch(/\/Users\/x\/file/)   // never raw
    vi.unstubAllGlobals()
  })
})
