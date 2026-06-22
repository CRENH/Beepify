import { existsSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BeepifyConfig, ChannelResult, NormalizedEvent } from '../core/types'
import { registerSource, registerChannel, getSource } from '../core/registry'
import { dispatch } from '../core/dispatch'
import { claudeCodeSource } from '../sources/claude-code'
import { barkChannel } from '../channels/bark'
import { ntfyChannel } from '../channels/ntfy'
import { installHook, uninstallHook, HOOK_COMMAND } from '../config/settings-json'

export function registerBuiltins(): void {
  registerSource(claudeCodeSource)
  registerChannel(barkChannel)
  registerChannel(ntfyChannel)
}

export async function runNotify(
  raw: string,
  sourceName: string,
  config: BeepifyConfig,
): Promise<ChannelResult[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const source = getSource(sourceName)
  if (!source) return []
  const event = source.parse(parsed)
  if (!event) return []
  if (config.host_label) event.host = config.host_label
  return dispatch(event, config)
}

export async function runTest(config: BeepifyConfig): Promise<ChannelResult[]> {
  const sample: NormalizedEvent = {
    kind: 'needs-approval', agent: 'beepify', host: config.host_label || 'beepify-test',
    project: 'beepify', summary: 'Test summary', action: 'Bash: echo hello', ts: Date.now(),
  }
  return dispatch(sample, { ...config, debounce_seconds: 0 })
}

function exampleConfigPath(): string {
  // dist/cli/commands.js -> package root -> config.example.toml
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..', 'config.example.toml')
}

export function runInit(opts: {
  settingsPath: string
  configPath: string
  uninstall?: boolean
}): {
  hook: { changed: boolean; backup?: string }
  configCreated: boolean
} {
  if (opts.uninstall) {
    return { hook: uninstallHook(opts.settingsPath, HOOK_COMMAND), configCreated: false }
  }
  let configCreated = false
  if (!existsSync(opts.configPath)) {
    mkdirSync(dirname(opts.configPath), { recursive: true })
    const example = exampleConfigPath()
    if (existsSync(example)) copyFileSync(example, opts.configPath)
    else writeFileSync(opts.configPath, 'debounce_seconds = 20\nlocale = "en"\nchannels = []\n')
    configCreated = true
  }
  const hook = installHook(opts.settingsPath, HOOK_COMMAND)
  return { hook, configCreated }
}

export function runDoctor(config: BeepifyConfig, settingsPath: string): string[] {
  const lines: string[] = []
  lines.push(`locale: ${config.locale}`)
  lines.push(`debounce_seconds: ${config.debounce_seconds}`)
  if (config.channels.length === 0) lines.push('channels: (none configured)')
  for (const ch of config.channels) {
    const secret = (ch.key ?? ch.topic ?? '') as string
    const redacted = !secret ? '(missing)' : secret.length <= 4 ? '***' : secret.slice(0, 3) + '***'
    lines.push(`channel ${ch.type}: ${redacted}`)
  }
  lines.push(`settings.json: ${existsSync(settingsPath) ? 'present' : 'missing'}`)
  return lines
}
