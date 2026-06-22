import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export function isDebounced(
  kind: string,
  seconds: number,
  dir: string = tmpdir(),
  now: number = Date.now(),
): boolean {
  const stamp = join(dir, `.beepify-notify.${kind}.stamp`)
  if (existsSync(stamp)) {
    const last = parseInt(readFileSync(stamp, 'utf8') || '0', 10)
    if (!Number.isNaN(last) && now - last < seconds * 1000) return true
  }
  writeFileSync(stamp, String(now))
  return false
}
