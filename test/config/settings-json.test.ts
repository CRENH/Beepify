import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installHook, uninstallHook, HOOK_COMMAND } from '../../src/config/settings-json'

function tmpSettings(obj: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), 'beepify-set-')), 'settings.json')
  writeFileSync(p, JSON.stringify(obj, null, 2))
  return p
}

describe('installHook', () => {
  it('adds the hook while preserving an existing hook', () => {
    const p = tmpSettings({
      hooks: { Notification: [{ matcher: '*', hooks: [{ type: 'command', command: 'open-island-hooks.py' }] }] },
    })
    const r = installHook(p, HOOK_COMMAND, 1000)
    expect(r.changed).toBe(true)
    expect(r.backup && existsSync(r.backup)).toBe(true)
    const s = JSON.parse(readFileSync(p, 'utf8'))
    const cmds = s.hooks.Notification[0].hooks.map((h: { command: string }) => h.command)
    expect(cmds).toContain('open-island-hooks.py')
    expect(cmds).toContain(HOOK_COMMAND)
    expect(s.hooks.Stop[0].hooks[0].command).toBe(HOOK_COMMAND)
  })

  it('is idempotent', () => {
    const p = tmpSettings({})
    installHook(p, HOOK_COMMAND, 1000)
    const second = installHook(p, HOOK_COMMAND, 2000)
    expect(second.changed).toBe(false)
  })
})

describe('uninstallHook', () => {
  it('removes only the beepify command', () => {
    const p = tmpSettings({})
    installHook(p, HOOK_COMMAND, 1000)
    const r = uninstallHook(p, HOOK_COMMAND)
    expect(r.changed).toBe(true)
    const s = JSON.parse(readFileSync(p, 'utf8'))
    const all = [...(s.hooks.Stop ?? []), ...(s.hooks.Notification ?? [])]
      .flatMap((m: { hooks: { command: string }[] }) => m.hooks.map((h) => h.command))
    expect(all).not.toContain(HOOK_COMMAND)
  })
})

describe('corrupt settings.json', () => {
  function tmpCorrupt(): string {
    const p = join(mkdtempSync(join(tmpdir(), 'beepify-corrupt-')), 'settings.json')
    writeFileSync(p, '{ not valid')
    return p
  }

  it('installHook throws a clear error for invalid JSON', () => {
    const p = tmpCorrupt()
    expect(() => installHook(p, HOOK_COMMAND, 1000)).toThrow('not valid JSON')
  })

  it('uninstallHook throws a clear error for invalid JSON', () => {
    const p = tmpCorrupt()
    expect(() => uninstallHook(p, HOOK_COMMAND)).toThrow('not valid JSON')
  })
})
