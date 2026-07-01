import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, defaultConfigPath } from '../../src/config/load'

function tmpToml(body: string): string {
  const p = join(mkdtempSync(join(tmpdir(), 'beepify-cfg-')), 'config.toml')
  writeFileSync(p, body)
  return p
}

describe('loadConfig', () => {
  it('applies defaults when file is absent', () => {
    const c = loadConfig('/nonexistent/config.toml', {})
    expect(c).toMatchObject({ debounce_seconds: 20, host_label: '', locale: 'en', channels: [], notify_idle: false })
  })
  it('parses notify_idle = true from TOML', () => {
    const p = tmpToml(`notify_idle = true\n`)
    expect(loadConfig(p, {}).notify_idle).toBe(true)
  })
  it('notify_idle falls back to false for a non-boolean value', () => {
    const p = tmpToml(`notify_idle = "yes"\n`)
    expect(loadConfig(p, {}).notify_idle).toBe(false)
  })
  it('parses TOML channels and locale', () => {
    const p = tmpToml(`locale = "zh-CN"\n[[channels]]\ntype = "bark"\nkey = "K"\n`)
    const c = loadConfig(p, {})
    expect(c.locale).toBe('zh-CN')
    expect(c.channels[0]).toMatchObject({ type: 'bark', key: 'K' })
  })
  it('env overrides channel secrets', () => {
    const p = tmpToml(`[[channels]]\ntype = "bark"\nkey = "FILE"\n`)
    const c = loadConfig(p, { BARK_KEY: 'ENV' })
    expect(c.channels[0].key).toBe('ENV')
  })
  it('NTFY_TOPIC overrides an ntfy channel topic', () => {
    const p = tmpToml(`[[channels]]\ntype = "ntfy"\ntopic = "FILE"\n`)
    const c = loadConfig(p, { NTFY_TOPIC: 'ENV' })
    expect(c.channels[0].topic).toBe('ENV')
  })
  it('falls back to defaults for wrong-typed values', () => {
    const p = tmpToml(`debounce_seconds = "x"\nhost_label = 42\nlocale = "fr"\n`)
    const c = loadConfig(p, {})
    expect(c.debounce_seconds).toBe(20)
    expect(c.host_label).toBe('')
    expect(c.locale).toBe('en')
  })
})

describe('defaultConfigPath', () => {
  it('returns BEEPIFY_CONFIG when set', () => {
    expect(defaultConfigPath({ BEEPIFY_CONFIG: '/custom/path.toml' })).toBe('/custom/path.toml')
  })
  it('falls back to the XDG config path when env is unset', () => {
    expect(defaultConfigPath({})).toBe(join(homedir(), '.config', 'beepify', 'config.toml'))
  })
})
