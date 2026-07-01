import { describe, it, expect } from 'vitest'
import { detectOpenIsland } from '../../../src/channels/desktop/detect'

const HOOK = 'open-island-hooks.py'

describe('detectOpenIsland', () => {
  it('uses PATH when the hook is on PATH', () => {
    const r = detectOpenIsland({ probe: (b) => b === HOOK, exists: () => false, home: '/home/e' })
    expect(r).toEqual({ installed: true, command: HOOK })
  })
  it('falls back to ~/.local/bin when not on PATH but the file exists', () => {
    const path = '/home/e/.local/bin/open-island-hooks.py'
    const r = detectOpenIsland({ probe: () => false, exists: (p) => p === path, home: '/home/e' })
    expect(r).toEqual({ installed: true, command: path })
  })
  it('reports not installed when neither is present', () => {
    expect(detectOpenIsland({ probe: () => false, exists: () => false, home: '/home/e' })).toEqual({ installed: false })
  })
})
