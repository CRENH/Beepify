import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerBuiltins, runNotify, runInit, runDoctor } from '../../src/cli/commands'
import type { BeepifyConfig } from '../../src/core/types'

beforeEach(() => { registerBuiltins(); process.env.HOST_LABEL = 'TESTHOST' })

const cfg: BeepifyConfig = {
  debounce_seconds: 0, host_label: '', locale: 'en',
  channels: [{ type: 'bark', key: 'K', server: 'https://api.day.app' }],
}

describe('runNotify', () => {
  it('parses a Stop event and pushes to the configured channel', async () => {
    let url = ''
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { url = u; return new Response('', { status: 200 }) }))
    const raw = JSON.stringify({ hook_event_name: 'Stop', cwd: '/a/proj' })
    const res = await runNotify(raw, 'claude-code', cfg)
    expect(res.find((r) => r.channel === 'bark')?.ok).toBe(true)
    expect(url).toContain('https://api.day.app/K/')
    vi.unstubAllGlobals()
  })

  it('returns [] for malformed JSON', async () => {
    expect(await runNotify('not json', 'claude-code', cfg)).toEqual([])
  })
})

describe('runInit', () => {
  it('creates a config from the example and installs the hook', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beepify-init-'))
    const settingsPath = join(dir, 'settings.json')
    const configPath = join(dir, 'config.toml')
    const r = runInit({ settingsPath, configPath })
    expect(existsSync(configPath)).toBe(true)
    expect(r.hook.changed).toBe(true)
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).hooks.Stop).toBeTruthy()
  })
})

describe('runDoctor', () => {
  it('reports channel and hook status without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beepify-doc-'))
    const lines = runDoctor(cfg, join(dir, 'settings.json'))
    expect(lines.join('\n')).toContain('bark')
  })

  it('does not reveal a short secret verbatim (length <= 4 shows only ***)', () => {
    const shortCfg: BeepifyConfig = {
      debounce_seconds: 0, host_label: '', locale: 'en',
      channels: [{ type: 'bark', key: 'ab', server: 'https://api.day.app' }],
    }
    const dir = mkdtempSync(join(tmpdir(), 'beepify-doc-short-'))
    const lines = runDoctor(shortCfg, join(dir, 'settings.json'))
    const joined = lines.join('\n')
    expect(joined).not.toContain('ab***')
    expect(joined).toContain('***')
  })

  it('shows first 3 chars + *** for a normal-length key', () => {
    const normalCfg: BeepifyConfig = {
      debounce_seconds: 0, host_label: '', locale: 'en',
      channels: [{ type: 'bark', key: 'K1234567', server: 'https://api.day.app' }],
    }
    const dir = mkdtempSync(join(tmpdir(), 'beepify-doc-normal-'))
    const lines = runDoctor(normalCfg, join(dir, 'settings.json'))
    expect(lines.join('\n')).toContain('K12***')
  })
})
