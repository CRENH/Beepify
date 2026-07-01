import { describe, it, expect } from 'vitest'
import { basename } from 'node:path'
import { codexSource } from '../../src/sources/codex'
import { getSource, clearRegistry } from '../../src/core/registry'
import { registerBuiltins } from '../../src/cli/commands'

describe('codexSource.parse', () => {
  it('maps Stop to a done event carrying the last assistant message', () => {
    const e = codexSource.parse({ hook_event_name: 'Stop', cwd: '/home/u/proj', last_assistant_message: 'All done.' })
    expect(e).toMatchObject({ kind: 'done', agent: 'codex', project: 'proj', summary: 'All done.' })
  })
  it('maps PermissionRequest to needs-approval with a tool action and description summary', () => {
    const e = codexSource.parse({
      hook_event_name: 'PermissionRequest', cwd: '/home/u/proj',
      tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/build', description: 'clean build' },
    })
    expect(e).toMatchObject({
      kind: 'needs-approval', agent: 'codex', project: 'proj',
      action: 'Bash: rm -rf /tmp/build', summary: 'clean build',
    })
  })
  it('returns null for events it does not handle', () => {
    expect(codexSource.parse({ hook_event_name: 'SessionStart' })).toBeNull()
  })
  it('falls back to process.cwd() when cwd is missing', () => {
    const e = codexSource.parse({ hook_event_name: 'Stop', last_assistant_message: 'x' })
    expect(e?.project).toBe(basename(process.cwd()))
  })
})

describe('registerBuiltins', () => {
  it('registers the codex source', () => {
    clearRegistry()
    registerBuiltins()
    expect(getSource('codex')).toBe(codexSource)
  })
})
