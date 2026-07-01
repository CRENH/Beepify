import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { Probe } from './types'

const HOOK = 'open-island-hooks.py'

export function detectOpenIsland(deps: {
  probe: Probe
  exists: (p: string) => boolean
  home: string
}): { installed: boolean; command?: string } {
  if (deps.probe(HOOK)) return { installed: true, command: HOOK }
  const local = join(deps.home, '.local', 'bin', HOOK)
  if (deps.exists(local)) return { installed: true, command: local }
  return { installed: false }
}

export function realProbe(bin: string): boolean {
  try {
    // `which` exits 0 iff the binary is on PATH; macOS/Linux both ship it.
    execFileSync('which', [bin], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
