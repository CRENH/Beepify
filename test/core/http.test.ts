import { describe, it, expect, vi } from 'vitest'
import { enc, request } from '../../src/core/http'

describe('enc', () => {
  it('percent-encodes slashes (Bark path invariant)', () => {
    expect(enc('a/b')).toBe('a%2Fb')
    expect(enc('Edit: /Users/x')).toContain('%2F')
  })
})

describe('request', () => {
  it('returns ok on 2xx without retrying', async () => {
    const f = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', f)
    const res = await request('https://example.com', { retries: 2 })
    expect(res.ok).toBe(true)
    expect(f).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('retries on failure then gives up', async () => {
    const f = vi.fn(async () => { throw new Error('network') })
    vi.stubGlobal('fetch', f)
    const res = await request('https://example.com', { retries: 2, retryDelayMs: 0 })
    expect(res.ok).toBe(false)
    expect(f).toHaveBeenCalledTimes(3) // initial + 2 retries
    vi.unstubAllGlobals()
  })
})
