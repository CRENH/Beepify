import { describe, it, expect, vi } from 'vitest'
import { terminalNotifierArgs, makeTerminalNotifierProvider } from '../../../src/channels/desktop/terminal-notifier'
import type { RenderedMessage } from '../../../src/core/types'
import type { Runner } from '../../../src/channels/desktop/types'

const msg: RenderedMessage = {
  title: '🔔 Needs approval · H', body: 'Bash: ls', group: 'Beepify',
  event: { kind: 'needs-approval', agent: 'a', host: 'H', project: 'p', ts: 1 },
}

describe('terminalNotifierArgs', () => {
  it('maps title, message and group to flags', () => {
    expect(terminalNotifierArgs(msg)).toEqual(['-title', '🔔 Needs approval · H', '-message', 'Bash: ls', '-group', 'Beepify'])
  })
  it('omits -group when group is empty', () => {
    expect(terminalNotifierArgs({ ...msg, group: '' })).toEqual(['-title', msg.title, '-message', msg.body])
  })
})

describe('makeTerminalNotifierProvider', () => {
  it('calls terminal-notifier and reports ok on code 0', async () => {
    let seen: string[] = []
    const run: Runner = vi.fn(async (_f, args) => { seen = args; return { code: 0, stderr: '' } })
    expect(await makeTerminalNotifierProvider(run)(msg, { type: 'desktop' })).toEqual({ ok: true })
    expect(seen).toContain('-title')
  })
})
