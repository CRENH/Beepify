import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const CODEX_HOOK_COMMAND = 'beepify notify --source codex'
const BEGIN = '# >>> beepify (managed) >>>'
const END = '# <<< beepify (managed) <<<'

export function renderCodexHookBlock(command: string = CODEX_HOOK_COMMAND): string {
  return [
    BEGIN,
    '[[hooks.Stop]]',
    '[[hooks.Stop.hooks]]',
    'type = "command"',
    `command = "${command}"`,
    '[[hooks.PermissionRequest]]',
    '[[hooks.PermissionRequest.hooks]]',
    'type = "command"',
    `command = "${command}"`,
    END,
  ].join('\n')
}

// Insert the managed block, or replace it in place if the markers already exist.
// Only TOML tables are appended (never root keys), which is always valid because
// existing root keys already precede all tables.
export function upsertManagedBlock(existing: string, block: string): string {
  const b = existing.indexOf(BEGIN)
  const e = existing.indexOf(END)
  if (b !== -1 && e !== -1 && e > b) {
    return existing.slice(0, b) + block + existing.slice(e + END.length)
  }
  const sep = existing === '' ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
  return existing + sep + block + '\n'
}

export function removeManagedBlock(existing: string): { text: string; changed: boolean } {
  const b = existing.indexOf(BEGIN)
  const e = existing.indexOf(END)
  if (b === -1 || e === -1 || e < b) return { text: existing, changed: false }
  const before = existing.slice(0, b).replace(/\n+$/, '\n')
  const after = existing.slice(e + END.length).replace(/^\n+/, '')
  return { text: (before + after).replace(/\n{3,}/g, '\n\n'), changed: true }
}

export function installCodexHook(
  configPath: string,
  command: string = CODEX_HOOK_COMMAND,
  now: number = Date.now(),
): { changed: boolean; backup?: string } {
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
  const next = upsertManagedBlock(existing, renderCodexHookBlock(command))
  if (next === existing) return { changed: false }
  let backup: string | undefined
  if (existsSync(configPath)) {
    backup = `${configPath}.beepify-bak.${now}`
    copyFileSync(configPath, backup)
  }
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, next)
  return { changed: true, backup }
}

export function uninstallCodexHook(configPath: string): { changed: boolean } {
  if (!existsSync(configPath)) return { changed: false }
  const { text, changed } = removeManagedBlock(readFileSync(configPath, 'utf8'))
  if (changed) writeFileSync(configPath, text)
  return { changed }
}
