import type { NormalizedEvent } from '../../core/types'
import type { Runner, DesktopProvider } from './types'

export function openIslandPayload(event: NormalizedEvent): string {
  if (event.raw && typeof event.raw === 'object') return JSON.stringify(event.raw)
  return JSON.stringify({
    hook_event_name: event.kind === 'done' ? 'Stop' : 'Notification',
    cwd: event.project,
    message: event.summary || '',
  })
}

export function makeOpenIslandProvider(run: Runner, detect: () => string): DesktopProvider {
  return async (msg, cfg) => {
    const cmd = (typeof cfg.open_island_command === 'string' && cfg.open_island_command) || detect()
    if (!cmd) return { ok: false, error: 'open-island not detected; set open_island_command' }
    const r = await run(cmd, ['--source', 'claude'], openIslandPayload(msg.event))
    return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr || `open-island exit ${r.code}` }
  }
}
