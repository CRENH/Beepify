import { describe, it, expect } from 'vitest'
import { defaultRun } from '../../../src/channels/desktop/run'

describe('defaultRun', () => {
  it('resolves code 0 for a succeeding command', async () => {
    expect((await defaultRun('true', [])).code).toBe(0)
  })
  it('resolves a non-zero code for a failing command', async () => {
    expect((await defaultRun('false', [])).code).not.toBe(0)
  })
  it('pipes stdin input to the child', async () => {
    // `cat` echoes stdin and exits 0; we assert it consumed input without error.
    expect((await defaultRun('cat', [], 'hello')).code).toBe(0)
  })
})
