import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'

export const HOOK_COMMAND = 'beepify notify --source claude-code'
const HOOK_EVENTS = ['Stop', 'Notification']

interface HookEntry { type: string; command: string }
interface Matcher { matcher: string; hooks: HookEntry[] }
interface Settings { hooks?: Record<string, Matcher[]>; [k: string]: unknown }

export function installHook(
  settingsPath: string,
  command: string = HOOK_COMMAND,
  now: number = Date.now(),
): { changed: boolean; backup?: string } {
  const settings: Settings = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, 'utf8'))
    : {}
  settings.hooks = settings.hooks || {}

  let changed = false
  for (const evt of HOOK_EVENTS) {
    const arr = (settings.hooks[evt] = settings.hooks[evt] || [])
    let matcher = arr.find((m) => m && m.matcher === '*')
    if (!matcher) {
      matcher = { matcher: '*', hooks: [] }
      arr.push(matcher)
    }
    matcher.hooks = matcher.hooks || []
    if (!matcher.hooks.some((h) => h && h.command === command)) {
      matcher.hooks.push({ type: 'command', command })
      changed = true
    }
  }

  if (!changed) return { changed: false }

  let backup: string | undefined
  if (existsSync(settingsPath)) {
    backup = `${settingsPath}.beepify-bak.${now}`
    copyFileSync(settingsPath, backup)
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  return { changed: true, backup }
}

export function uninstallHook(
  settingsPath: string,
  command: string = HOOK_COMMAND,
): { changed: boolean } {
  if (!existsSync(settingsPath)) return { changed: false }
  const settings: Settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  let changed = false
  for (const evt of HOOK_EVENTS) {
    const arr = settings.hooks?.[evt]
    if (!Array.isArray(arr)) continue
    for (const matcher of arr) {
      if (!matcher?.hooks) continue
      const before = matcher.hooks.length
      matcher.hooks = matcher.hooks.filter((h) => h?.command !== command)
      if (matcher.hooks.length !== before) changed = true
    }
  }
  if (changed) writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  return { changed }
}
