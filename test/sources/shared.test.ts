import { describe, it, expect } from 'vitest'
import { toolDesc, resolveHost } from '../../src/sources/shared'

describe('shared source helpers', () => {
  it('toolDesc surfaces a tool command', () => {
    expect(toolDesc({ name: 'Bash', input: { command: 'ls -la' } })).toBe('Bash: ls -la')
  })
  it('resolveHost honours the HOST_LABEL env override', () => {
    expect(resolveHost({ HOST_LABEL: 'my-mac' } as NodeJS.ProcessEnv)).toBe('my-mac')
  })
})
