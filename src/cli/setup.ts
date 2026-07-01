import type { BeepifyConfig } from '../core/types'
import type { SetupAnswers, ChannelAnswer } from './setup-core'
import { normalizeLocale, normalizeProvider } from './setup-core'

export interface SetupIO {
  ask(question: string, def?: string): Promise<string>
  print(s: string): void
}

const yes = (s: string) => /^y(es)?$/i.test(s.trim())

export async function runSetup(
  io: SetupIO,
  deps: { configPath: string; existing?: BeepifyConfig; detect?: () => { installed: boolean; command?: string } },
): Promise<SetupAnswers> {
  const cur = deps.existing
  const locale = normalizeLocale(await io.ask('Language (en / zh-CN)', cur?.locale ?? 'en'), cur?.locale ?? 'en')

  const channels: ChannelAnswer[] = []
  while (yes(await io.ask('Add a channel? (y/n)', channels.length ? 'n' : 'y'))) {
    const type = (await io.ask('  Channel type (bark / ntfy / desktop)', 'bark')).trim()
    if (type === 'bark') {
      const key = (await io.ask('  Bark key')).trim()
      const server = (await io.ask('  Bark server (blank = default)')).trim()
      const icon = (await io.ask('  Icon URL (blank = none)')).trim()
      const c: ChannelAnswer = { type: 'bark', key }
      if (server) c.server = server
      if (icon) c.icon = icon
      channels.push(c)
    } else if (type === 'ntfy') {
      const topic = (await io.ask('  ntfy topic')).trim()
      const server = (await io.ask('  ntfy server (blank = default)')).trim()
      const c: ChannelAnswer = { type: 'ntfy', topic }
      if (server) c.server = server
      channels.push(c)
    } else if (type === 'desktop') {
      const provider = normalizeProvider(await io.ask('  Provider — 1) native (default)  2) open-island', 'native'))
      const c: ChannelAnswer = { type: 'desktop', provider }
      if (provider === 'open-island') {
        const d = deps.detect ? deps.detect() : { installed: false }
        if (d.installed && d.command) {
          c.open_island_command = d.command
          io.print(`  Detected Open Island at ${d.command}`)
        } else {
          io.print('  Open Island not detected — install it, then it will be picked up. Channel added (deferred).')
        }
      }
      channels.push(c)
    } else {
      io.print(`  Unknown type "${type}" — skipped.`)
    }
  }

  const notify_idle = yes(await io.ask('Send the ~60s idle reminder too? (y/n)', cur?.notify_idle ? 'y' : 'n'))
  return { locale, notify_idle, channels }
}
