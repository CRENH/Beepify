import { describe, it, expect } from 'vitest'
import { selectProvider } from '../../../src/channels/desktop/select'
import type { Runner } from '../../../src/channels/desktop/types'

const run: Runner = async () => ({ code: 0, stderr: '' })
const base = { run, detect: () => '/oi', platform: 'darwin' as NodeJS.Platform, probe: () => false }

describe('selectProvider', () => {
  it('native on macOS with terminal-notifier present -> a callable provider', () => {
    const p = selectProvider('native', { ...base, probe: (b) => b === 'terminal-notifier' })
    expect(typeof p).toBe('function')
  })
  it('native on macOS without terminal-notifier still resolves (osascript)', () => {
    expect(typeof selectProvider('native', base)).toBe('function')
  })
  it('open-island resolves to a callable provider', () => {
    expect(typeof selectProvider('open-island', base)).toBe('function')
  })
  it('unknown provider returns an error object', () => {
    expect(selectProvider('carrier-pigeon', base)).toEqual({ error: expect.stringContaining('carrier-pigeon') })
  })
  it('native on a non-macOS platform returns an error (seam, no backend yet)', () => {
    expect(selectProvider('native', { ...base, platform: 'linux' })).toMatchObject({ error: expect.stringContaining('linux') })
  })
})
