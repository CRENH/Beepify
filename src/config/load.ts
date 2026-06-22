import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parse as parseToml } from 'smol-toml'
import type { BeepifyConfig, ChannelConfig } from '../core/types'

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.BEEPIFY_CONFIG || join(homedir(), '.config', 'beepify', 'config.toml')
}

export function loadConfig(
  path: string = defaultConfigPath(),
  env: NodeJS.ProcessEnv = process.env,
): BeepifyConfig {
  let raw: Record<string, unknown> = {}
  if (existsSync(path)) {
    raw = parseToml(readFileSync(path, 'utf8')) as Record<string, unknown>
  }
  const channels = Array.isArray(raw.channels) ? (raw.channels as ChannelConfig[]) : []
  const config: BeepifyConfig = {
    debounce_seconds: typeof raw.debounce_seconds === 'number' ? raw.debounce_seconds : 20,
    host_label: typeof raw.host_label === 'string' ? raw.host_label : '',
    locale: raw.locale === 'zh-CN' ? 'zh-CN' : 'en',
    channels,
  }
  applyEnvOverrides(config, env)
  return config
}

function applyEnvOverrides(config: BeepifyConfig, env: NodeJS.ProcessEnv): void {
  for (const ch of config.channels) {
    if (ch.type === 'bark' && env.BARK_KEY) ch.key = env.BARK_KEY
    if (ch.type === 'ntfy' && env.NTFY_TOPIC) ch.topic = env.NTFY_TOPIC
  }
}
