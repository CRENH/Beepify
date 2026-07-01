import { describe, it, expect, vi } from 'vitest'
import { osascriptScript, makeOsascriptProvider } from '../../../src/channels/desktop/osascript'
import type { RenderedMessage } from '../../../src/core/types'
import type { Runner } from '../../../src/channels/desktop/types'

const msg: RenderedMessage = {
  title: '✅ Done · H', body: 'Edit: /Users/x "f"', group: 'Beepify',
  event: { kind: 'done', agent: 'a', host: 'H', project: 'p', ts: 1 },
}

describe('osascriptScript', () => {
  it('escapes double quotes and backslashes', () => {
    const s = osascriptScript('T"a\\b', 'B"c', undefined)
    expect(s).toBe('display notification "B\\"c" with title "T\\"a\\\\b"')
  })
  it('appends sound when provided', () => {
    expect(osascriptScript('T', 'B', 'Ping')).toBe('display notification "B" with title "T" sound name "Ping"')
  })
})

describe('makeOsascriptProvider', () => {
  it('invokes osascript -e with the built script and reports ok on code 0', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const run: Runner = vi.fn(async (file, args) => { calls.push({ file, args }); return { code: 0, stderr: '' } })
    const r = await makeOsascriptProvider(run)(msg, { type: 'desktop' })
    expect(r).toEqual({ ok: true })
    expect(calls[0].file).toBe('osascript')
    expect(calls[0].args[0]).toBe('-e')
    expect(calls[0].args[1]).toContain('with title "✅ Done · H"')
  })
  it('reports ok:false with stderr on non-zero exit', async () => {
    const run: Runner = async () => ({ code: 1, stderr: 'boom' })
    expect(await makeOsascriptProvider(run)(msg, { type: 'desktop' })).toEqual({ ok: false, error: 'boom' })
  })
})
