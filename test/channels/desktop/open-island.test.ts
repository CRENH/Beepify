import { describe, it, expect, vi } from 'vitest'
import { openIslandPayload, makeOpenIslandProvider } from '../../../src/channels/desktop/open-island'
import type { RenderedMessage } from '../../../src/core/types'
import type { Runner } from '../../../src/channels/desktop/types'

const raw = { hook_event_name: 'Stop', cwd: '/a/proj', transcript_path: '/t.jsonl' }
const msg: RenderedMessage = {
  title: '✅ Done · H', body: 'done', group: 'Beepify',
  event: { kind: 'done', agent: 'claude-code', host: 'H', project: 'proj', ts: 1, raw },
}

describe('openIslandPayload', () => {
  it('passes the original raw hook payload through for claude-code', () => {
    expect(JSON.parse(openIslandPayload(msg.event))).toEqual(raw)
  })
  it('synthesizes a claude-shaped payload when raw is absent', () => {
    const p = JSON.parse(openIslandPayload({ kind: 'waiting-input', agent: 'x', host: 'H', project: 'proj', summary: 'hi', ts: 1 }))
    expect(p).toMatchObject({ hook_event_name: 'Notification', message: 'hi' })
  })
})

describe('makeOpenIslandProvider', () => {
  it('spawns the detected command with --source claude and pipes the payload on stdin', async () => {
    let seen = { file: '', args: [] as string[], input: '' }
    const run: Runner = vi.fn(async (file, args, input) => { seen = { file, args, input: input ?? '' }; return { code: 0, stderr: '' } })
    const r = await makeOpenIslandProvider(run, () => '/bin/open-island-hooks.py')(msg, { type: 'desktop' })
    expect(r).toEqual({ ok: true })
    expect(seen.file).toBe('/bin/open-island-hooks.py')
    expect(seen.args).toEqual(['--source', 'claude'])
    expect(JSON.parse(seen.input)).toEqual(raw)
  })
  it('prefers cfg.open_island_command over detect()', async () => {
    let file = ''
    const run: Runner = async (f) => { file = f; return { code: 0, stderr: '' } }
    await makeOpenIslandProvider(run, () => '/detected')(msg, { type: 'desktop', open_island_command: '/from-cfg' })
    expect(file).toBe('/from-cfg')
  })
  it('reports ok:false when no command can be resolved', async () => {
    const run: Runner = vi.fn(async () => ({ code: 0, stderr: '' }))
    const r = await makeOpenIslandProvider(run, () => '')(msg, { type: 'desktop' })
    expect(r.ok).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
})
