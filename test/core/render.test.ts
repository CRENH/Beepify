import { describe, it, expect } from 'vitest'
import { flat, render } from '../../src/core/render'
import type { NormalizedEvent, BeepifyConfig } from '../../src/core/types'

const cfg = (locale: 'en' | 'zh-CN'): BeepifyConfig => ({
  debounce_seconds: 0, host_label: '', locale, channels: [],
})
const base: NormalizedEvent = { kind: 'done', agent: 'claude-code', host: 'H', project: 'proj', ts: 1 }

describe('flat', () => {
  it('collapses whitespace and newlines to single spaces', () => {
    expect(flat('a\n\n b\t c')).toBe('a b c')
  })
  it('truncates to 300 chars with ellipsis', () => {
    const out = flat('x'.repeat(400))
    expect(out.length).toBe(300)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('render', () => {
  it('en done title + summary body', () => {
    const m = render({ ...base, summary: 'all\ndone' }, cfg('en'))
    expect(m.title).toBe('✅ Done · H')
    expect(m.body).toBe('all done')
  })
  it('zh-CN needs-approval prefers action over summary', () => {
    const m = render({ ...base, kind: 'needs-approval', summary: 's', action: 'Bash: ls' }, cfg('zh-CN'))
    expect(m.title).toBe('🔔 需要授权 · H')
    expect(m.body).toBe('Bash: ls')
  })
  it('done falls back to the exact "<project> finished this round" when summary empty', () => {
    const m = render({ ...base, summary: '' }, cfg('en'))
    expect(m.body).toBe('proj finished this round')
  })
  it('zh-CN done fallback uses the localized phrase', () => {
    const m = render({ ...base, summary: '' }, cfg('zh-CN'))
    expect(m.title).toBe('✅ 任务完成 · H')
    expect(m.body).toBe('proj 已结束本轮')
  })
  it('needs-approval falls back to summary when action is absent', () => {
    const m = render({ ...base, kind: 'needs-approval', summary: 'please confirm' }, cfg('en'))
    expect(m.body).toBe('please confirm')
  })
  it('waiting-input renders its title and summary body', () => {
    const m = render({ ...base, kind: 'waiting-input', summary: 'your move' }, cfg('en'))
    expect(m.title).toBe('💬 Waiting for you · H')
    expect(m.body).toBe('your move')
  })
  it('error renders its title (reserved kind, no v1 producer)', () => {
    const m = render({ ...base, kind: 'error', summary: 'boom' }, cfg('en'))
    expect(m.title).toBe('⚠️ Error · H')
    expect(m.body).toBe('boom')
  })
  it('unknown locale falls back to en', () => {
    const m = render(base, { ...cfg('en'), locale: 'fr' as unknown as 'en' })
    expect(m.title).toBe('✅ Done · H')
  })
})
