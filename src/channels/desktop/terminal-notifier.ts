import type { RenderedMessage } from '../../core/types'
import type { Runner, DesktopProvider } from './types'

export function terminalNotifierArgs(msg: RenderedMessage): string[] {
  const args = ['-title', msg.title, '-message', msg.body]
  if (msg.group) args.push('-group', msg.group)
  return args
}

export function makeTerminalNotifierProvider(run: Runner): DesktopProvider {
  return async (msg) => {
    const r = await run('terminal-notifier', terminalNotifierArgs(msg))
    return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr || `terminal-notifier exit ${r.code}` }
  }
}
