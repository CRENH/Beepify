import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDebounced } from '../../src/core/debounce'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'beepify-debounce-')) })

describe('isDebounced', () => {
  it('first call is not debounced, second within window is', () => {
    expect(isDebounced('done', 20, dir, 1000)).toBe(false)
    expect(isDebounced('done', 20, dir, 1500)).toBe(true) // 0.5s later, < 20s
  })
  it('not debounced once the window has passed', () => {
    expect(isDebounced('done', 20, dir, 1000)).toBe(false)
    expect(isDebounced('done', 20, dir, 30000)).toBe(false) // 29s later, > 20s
  })
  it('different kinds do not interfere', () => {
    expect(isDebounced('done', 20, dir, 1000)).toBe(false)
    expect(isDebounced('needs-approval', 20, dir, 1000)).toBe(false)
  })
})
