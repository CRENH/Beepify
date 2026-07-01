import type { Probe, Runner, DesktopProvider } from './types'
import { makeOsascriptProvider } from './osascript'
import { makeTerminalNotifierProvider } from './terminal-notifier'
import { makeOpenIslandProvider } from './open-island'

export interface SelectCtx {
  platform: NodeJS.Platform
  probe: Probe
  run: Runner
  detect: () => string
}

export function selectProvider(name: string, ctx: SelectCtx): DesktopProvider | { error: string } {
  const oi = () => makeOpenIslandProvider(ctx.run, ctx.detect)
  const osa = () => makeOsascriptProvider(ctx.run)
  const tn = () => makeTerminalNotifierProvider(ctx.run)

  switch (name) {
    case 'open-island':
      return oi()
    case 'osascript':
      return osa()
    case 'terminal-notifier':
      return tn()
    case 'native':
    case 'auto':
    case '':
      if (ctx.platform !== 'darwin') return { error: `no native desktop provider for platform "${ctx.platform}" yet` }
      return ctx.probe('terminal-notifier') ? tn() : osa()
    default:
      return { error: `unknown desktop provider "${name}"` }
  }
}
