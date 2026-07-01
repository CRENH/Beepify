import { describe, it, expect } from 'vitest'
import { desktopChannel } from '../../../src/channels/desktop'
import type { RenderedMessage } from '../../../src/core/types'

const msg: RenderedMessage = {
  title: '✅ Done · H', body: 'done', group: 'Beepify',
  event: { kind: 'done', agent: 'a', host: 'H', project: 'p', ts: 1 },
}

describe('desktopChannel', () => {
  it('returns a desktop ChannelResult (ok true/false) without throwing on an unknown provider', async () => {
    const r = await desktopChannel.send(msg, { type: 'desktop', provider: 'carrier-pigeon' })
    expect(r.channel).toBe('desktop')
    expect(r.ok).toBe(false)
    expect(typeof r.error).toBe('string')
  })
})
