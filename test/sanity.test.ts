import { describe, it, expect } from 'vitest'
import type { NormalizedEvent } from '../src/core/types'

describe('toolchain', () => {
  it('types compile and vitest runs', () => {
    const ev: NormalizedEvent = { kind: 'done', agent: 'x', host: 'h', project: 'p', ts: 1 }
    expect(ev.kind).toBe('done')
  })
})
