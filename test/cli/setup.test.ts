import { describe, it, expect } from 'vitest'
import { runSetup, type SetupIO } from '../../src/cli/setup'

function scriptedIO(answers: string[]): { io: SetupIO; out: string[] } {
  const out: string[] = []
  let i = 0
  const io: SetupIO = {
    ask: async () => answers[i++] ?? '',
    print: (s) => out.push(s),
  }
  return { io, out }
}

describe('runSetup', () => {
  it('collects locale, one bark channel, then stops, with notify_idle off', async () => {
    // Script: locale -> add? y -> type bark -> key -> server -> icon -> add? n -> notify_idle? n
    const { io } = scriptedIO(['zh-CN', 'y', 'bark', 'K', '', '', 'n', 'n'])
    const answers = await runSetup(io, { configPath: '/tmp/none.toml' })
    expect(answers.locale).toBe('zh-CN')
    expect(answers.notify_idle).toBe(false)
    expect(answers.channels).toEqual([{ type: 'bark', key: 'K' }])
  })

  it('detects Open Island and records the command for a desktop channel', async () => {
    const { io } = scriptedIO(['en', 'y', 'desktop', 'open-island', 'n', 'n'])
    const answers = await runSetup(io, {
      configPath: '/tmp/none.toml',
      detect: () => ({ installed: true, command: '/x/open-island-hooks.py' }),
    })
    expect(answers.channels[0]).toEqual({ type: 'desktop', provider: 'open-island', open_island_command: '/x/open-island-hooks.py' })
  })
})
