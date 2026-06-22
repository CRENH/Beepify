import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../../src/config/load'

function tmpToml(body: string): string {
  const p = join(mkdtempSync(join(tmpdir(), 'beepify-cfg-')), 'config.toml')
  writeFileSync(p, body)
  return p
}

describe('loadConfig', () => {
  it('applies defaults when file is absent', () => {
    const c = loadConfig('/nonexistent/config.toml', {})
    expect(c).toMatchObject({ debounce_seconds: 20, host_label: '', locale: 'en', channels: [] })
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
})
