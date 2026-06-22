import { describe, it, expect, beforeEach } from 'vitest'
import { registerChannel, clearRegistry } from '../../src/core/registry'
import { dispatch } from '../../src/core/dispatch'
import type { NormalizedEvent, BeepifyConfig, Channel } from '../../src/core/types'

const event: NormalizedEvent = { kind: 'done', agent: 'a', host: 'H', project: 'p', summary: 'hi', ts: 1 }
const cfg = (channels: BeepifyConfig['channels']): BeepifyConfig => ({
  debounce_seconds: 0, host_label: '', locale: 'en', channels,
})

const okChannel: Channel = { name: 'ok', async send() { return { channel: 'ok', ok: true } } }
const boomChannel: Channel = { name: 'boom', async send() { throw new Error('kaboom') } }

beforeEach(() => { clearRegistry(); registerChannel(okChannel); registerChannel(boomChannel) })

describe('dispatch', () => {
  it('fans out; one channel throwing does not stop the others', async () => {
    const res = await dispatch(event, cfg([{ type: 'ok' }, { type: 'boom' }]))
    expect(res.find((r) => r.channel === 'ok')?.ok).toBe(true)
    const boom = res.find((r) => r.channel === 'boom')
    expect(boom?.ok).toBe(false)
    expect(boom?.error).toContain('kaboom')
  })
  it('unconfigured channel type is skipped, not failed', async () => {
    const res = await dispatch(event, cfg([{ type: 'nope' }]))
    expect(res[0]).toMatchObject({ channel: 'nope', ok: false, skipped: true })
  })
})
