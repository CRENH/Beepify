import { describe, it, expect } from 'vitest'
import { buildConfigObject, renderConfigToml, normalizeLocale, normalizeProvider, normalizeAgents } from '../../src/cli/setup-core'
import { parse as parseToml } from 'smol-toml'

describe('normalizeLocale / normalizeProvider', () => {
  it('accepts zh-CN and falls back otherwise', () => {
    expect(normalizeLocale('zh-CN', 'en')).toBe('zh-CN')
    expect(normalizeLocale('nonsense', 'en')).toBe('en')
    expect(normalizeLocale('', 'zh-CN')).toBe('zh-CN')
  })
  it('maps provider input to native/open-island', () => {
    expect(normalizeProvider('open-island')).toBe('open-island')
    expect(normalizeProvider('2')).toBe('open-island')
    expect(normalizeProvider('anything-else')).toBe('native')
  })
})

describe('buildConfigObject', () => {
  it('emits locale, notify_idle and channels array', () => {
    const obj = buildConfigObject({
      locale: 'zh-CN', notify_idle: true, agents: ['claude-code'],
      channels: [
        { type: 'bark', key: 'K', server: 'https://api.day.app', icon: 'https://i' },
        { type: 'desktop', provider: 'native' },
      ],
    })
    expect(obj).toMatchObject({ locale: 'zh-CN', notify_idle: true })
    expect((obj.channels as unknown[])[0]).toMatchObject({ type: 'bark', key: 'K' })
    expect((obj.channels as unknown[])[1]).toMatchObject({ type: 'desktop', provider: 'native' })
  })
  it('omits empty optional fields (no empty server/icon keys)', () => {
    const obj = buildConfigObject({ locale: 'en', notify_idle: false, agents: ['claude-code'], channels: [{ type: 'bark', key: 'K' }] })
    expect((obj.channels as Array<Record<string, unknown>>)[0]).toEqual({ type: 'bark', key: 'K' })
  })
})

describe('renderConfigToml', () => {
  it('produces TOML that round-trips back to the same object', () => {
    const a = { locale: 'en' as const, notify_idle: false, agents: ['claude-code' as const], channels: [{ type: 'ntfy' as const, topic: 'T' }] }
    const toml = renderConfigToml(a)
    expect(parseToml(toml)).toEqual(buildConfigObject(a))
  })
})

describe('normalizeAgents', () => {
  it('maps menu choices to agent sets', () => {
    expect(normalizeAgents('1')).toEqual(['claude-code'])
    expect(normalizeAgents('2')).toEqual(['codex'])
    expect(normalizeAgents('3')).toEqual(['claude-code', 'codex'])
    expect(normalizeAgents('both')).toEqual(['claude-code', 'codex'])
    expect(normalizeAgents('')).toEqual(['claude-code'])
  })
})
