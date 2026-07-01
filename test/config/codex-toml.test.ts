import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import {
  CODEX_HOOK_COMMAND, renderCodexHookBlock, upsertManagedBlock, removeManagedBlock,
  installCodexHook, uninstallCodexHook,
} from '../../src/config/codex-toml'

describe('renderCodexHookBlock', () => {
  it('parses as TOML wiring Stop + PermissionRequest to the codex command', () => {
    const parsed = parseToml(renderCodexHookBlock()) as any
    expect(parsed.hooks.Stop[0].hooks[0].command).toBe(CODEX_HOOK_COMMAND)
    expect(parsed.hooks.PermissionRequest[0].hooks[0].command).toBe(CODEX_HOOK_COMMAND)
  })
})

describe('upsertManagedBlock', () => {
  const block = renderCodexHookBlock()
  it('appends to an empty file', () => {
    expect(upsertManagedBlock('', block)).toContain('[[hooks.Stop]]')
  })
  it('preserves unrelated content when appending', () => {
    const out = upsertManagedBlock('model = "o4-mini"\n', block)
    expect(out).toContain('model = "o4-mini"')
    expect(out).toContain('[[hooks.Stop]]')
  })
  it('is idempotent — a second upsert yields identical output', () => {
    const once = upsertManagedBlock('model = "x"\n', block)
    expect(upsertManagedBlock(once, block)).toBe(once)
  })
})

describe('removeManagedBlock', () => {
  it('removes the block, keeps other content, reports changed', () => {
    const withBlock = upsertManagedBlock('model = "x"\n', renderCodexHookBlock())
    const { text, changed } = removeManagedBlock(withBlock)
    expect(changed).toBe(true)
    expect(text).toContain('model = "x"')
    expect(text).not.toContain('[[hooks.Stop]]')
  })
  it('reports no change when no managed block is present', () => {
    expect(removeManagedBlock('model = "x"\n').changed).toBe(false)
  })
})

describe('installCodexHook / uninstallCodexHook', () => {
  it('creates the file (and parent dir), backs up on rewrite, is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beepify-codex-'))
    const cfg = join(dir, 'codex', 'config.toml') // parent dir does not exist yet
    const first = installCodexHook(cfg, CODEX_HOOK_COMMAND, 111)
    expect(first.changed).toBe(true)
    expect(first.backup).toBeUndefined() // no prior file to back up
    expect(readFileSync(cfg, 'utf8')).toContain('[[hooks.PermissionRequest]]')
    const second = installCodexHook(cfg, CODEX_HOOK_COMMAND, 222)
    expect(second.changed).toBe(false) // already installed
  })
  it('backs up an existing file before rewriting', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beepify-codex-'))
    const cfg = join(dir, 'config.toml')
    writeFileSync(cfg, 'model = "x"\n')
    const r = installCodexHook(cfg, CODEX_HOOK_COMMAND, 333)
    expect(r.changed).toBe(true)
    expect(r.backup).toBe(`${cfg}.beepify-bak.333`)
    expect(existsSync(r.backup!)).toBe(true)
  })
  it('uninstall removes the block', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beepify-codex-'))
    const cfg = join(dir, 'config.toml')
    installCodexHook(cfg)
    const r = uninstallCodexHook(cfg)
    expect(r.changed).toBe(true)
    expect(readFileSync(cfg, 'utf8')).not.toContain('[[hooks.Stop]]')
  })
})
