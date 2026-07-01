import type { Runner, DesktopProvider } from './types'

export function osascriptScript(title: string, body: string, sound?: string): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  let s = `display notification "${esc(body)}" with title "${esc(title)}"`
  if (sound) s += ` sound name "${esc(sound)}"`
  return s
}

export function makeOsascriptProvider(run: Runner): DesktopProvider {
  return async (msg, cfg) => {
    const sound = typeof cfg.sound === 'string' && cfg.sound ? cfg.sound : undefined
    const r = await run('osascript', ['-e', osascriptScript(msg.title, msg.body, sound)])
    return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr || `osascript exit ${r.code}` }
  }
}
