import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { Source, NormalizedEvent, BeepifyConfig } from '../core/types'
import { resolveHost, toolDesc } from './shared'
// re-export for back-compat with existing importers/tests
export { toolDesc, resolveHost } from './shared'

export function parseTranscript(path: string): { summary: string; action: string } {
  let summary = ''
  let action = ''
  let content = ''
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return { summary, action }
  }
  for (const line of content.split('\n')) {
    const s = line.trim()
    if (!s) continue
    let d: { type?: string; message?: { content?: unknown } }
    try {
      d = JSON.parse(s)
    } catch {
      continue
    }
    const c = d.message?.content
    let texts: string[] = []
    let tools: unknown[] = []
    if (typeof c === 'string') {
      texts = [c]
    } else if (Array.isArray(c)) {
      texts = c.filter((x) => x && (x as { type?: string }).type === 'text').map((x) => String((x as { text?: string }).text ?? ''))
      tools = c.filter((x) => x && (x as { type?: string }).type === 'tool_use')
    }
    const txt = texts.filter(Boolean).join('\n').trim()
    if (d.type === 'assistant') {
      if (txt) summary = txt
      // action reflects ONLY the latest assistant turn: a tool there is the one
      // currently pending approval; a text-only turn means nothing is pending, so
      // action clears (→ waiting-input, not a stale needs-approval). Do not persist
      // action across turns. summary, by contrast, keeps the last non-empty reply.
      action = tools.length ? toolDesc(tools[tools.length - 1]) : ''
    }
  }
  return { summary, action }
}

export const claudeCodeSource: Source = {
  name: 'claude-code',
  parse(raw: unknown, config?: BeepifyConfig): NormalizedEvent | null {
    const d = (raw ?? {}) as {
      hook_event_name?: string
      cwd?: string
      transcript_path?: string
      message?: string
      notification_type?: string
    }
    const event = d.hook_event_name
    if (event !== 'Stop' && event !== 'Notification') return null

    // The idle_prompt Notification fires ~60s after a turn ends if the user has
    // not returned — it duplicates the Stop (done) push. Suppress it unless the
    // user opts in via notify_idle.
    if (event === 'Notification' && d.notification_type === 'idle_prompt' && !config?.notify_idle) {
      return null
    }

    const cwd = d.cwd || process.cwd()
    const host = resolveHost()
    const project = basename(cwd)
    const { summary, action } = d.transcript_path
      ? parseTranscript(d.transcript_path)
      : { summary: '', action: '' }
    const ts = Date.now()

    if (event === 'Stop') {
      return { kind: 'done', agent: 'claude-code', host, project, summary, raw, ts }
    }
    if (action) {
      return { kind: 'needs-approval', agent: 'claude-code', host, project, summary, action, raw, ts }
    }
    return { kind: 'waiting-input', agent: 'claude-code', host, project, summary: summary || d.message || '', raw, ts }
  },
}
