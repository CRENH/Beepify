import { stringify as toToml } from 'smol-toml'

export type ChannelAnswer =
  | { type: 'bark'; key: string; server?: string; icon?: string }
  | { type: 'ntfy'; topic: string; server?: string }
  | { type: 'desktop'; provider: 'native' | 'open-island'; open_island_command?: string }

export type AgentName = 'claude-code' | 'codex'

export function normalizeAgents(s: string): AgentName[] {
  const t = s.trim().toLowerCase()
  if (t === '2' || t === 'codex') return ['codex']
  if (t === '3' || t === 'both') return ['claude-code', 'codex']
  return ['claude-code']
}

export interface SetupAnswers {
  locale: 'en' | 'zh-CN'
  notify_idle: boolean
  agents: AgentName[]
  channels: ChannelAnswer[]
}

export function normalizeLocale(s: string, fallback: 'en' | 'zh-CN'): 'en' | 'zh-CN' {
  return s === 'zh-CN' ? 'zh-CN' : s === 'en' ? 'en' : fallback
}

export function normalizeProvider(s: string): 'native' | 'open-island' {
  return s === 'open-island' || s.trim() === '2' ? 'open-island' : 'native'
}

function clean(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') out[k] = v
  return out
}

export function buildConfigObject(a: SetupAnswers): Record<string, unknown> {
  return {
    locale: a.locale,
    notify_idle: a.notify_idle,
    channels: a.channels.map((c) => clean({ ...c })),
  }
}

export function renderConfigToml(a: SetupAnswers): string {
  return toToml(buildConfigObject(a))
}
