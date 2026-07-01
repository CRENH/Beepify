import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { Source, NormalizedEvent, BeepifyConfig } from '../core/types'

const STRING_KEYS = ['command', 'file_path', 'path', 'url', 'query', 'pattern', 'plan', 'description', 'prompt']

// Fields worth surfacing when recovering a best-effort snippet from an unparsed
// raw tool input. 'question' is first so AskUserQuestion shows the prompt text.
const RECOVER_KEYS = ['question', 'command', 'prompt', 'plan', 'description', 'query', 'path', 'url', 'file_path', 'pattern', 'header']

function firstFieldFromRaw(raw: string): string {
  for (const k of RECOVER_KEYS) {
    const m = raw.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))
    if (m && m[1].trim()) return m[1].replace(/\\"/g, '"').trim()
  }
  return ''
}

export function toolDesc(b: unknown): string {
  const block = (b ?? {}) as { name?: string; input?: Record<string, unknown> }
  const name = block.name || 'tool'
  let inp = block.input || {}

  // Claude Code stores the model's raw output under __unparsedToolInput when a
  // tool call's input fails strict JSON parsing. Recover content from it instead
  // of degrading to a bare tool name.
  const unparsed = inp.__unparsedToolInput as { raw?: unknown } | undefined
  if (unparsed && typeof unparsed.raw === 'string') {
    try {
      const parsed = JSON.parse(unparsed.raw)
      if (parsed && typeof parsed === 'object') inp = parsed as Record<string, unknown>
    } catch {
      const snippet = firstFieldFromRaw(unparsed.raw)
      if (snippet) return `${name}: ${snippet}`
    }
  }

  if (name === 'AskUserQuestion') {
    const qs = inp.questions
    if (Array.isArray(qs) && qs.length) {
      const parts: string[] = []
      for (const q of qs) {
        if (!q || typeof q !== 'object') continue
        const qq = q as { header?: unknown; question?: unknown }
        const h = String(qq.header ?? '').trim()
        const qt = String(qq.question ?? '').trim()
        const seg = h && qt ? `${h}: ${qt}` : qt || h
        if (seg) parts.push(seg)
      }
      if (parts.length) return `${name}: ${parts.join(' / ')}`
    }
    return name
  }

  if (name === 'ExitPlanMode') {
    const plan = inp.plan
    if (typeof plan === 'string' && plan.trim()) return `${name}: ${plan.trim()}`
    return name
  }

  for (const k of STRING_KEYS) {
    const v = inp[k]
    if (typeof v === 'string' && v.trim()) return `${name}: ${v}`
  }
  for (const k of Object.keys(inp)) {
    const v = inp[k]
    if (typeof v === 'string' && v.trim()) return `${name}: ${v}`
  }
  return name
}

export function resolveHost(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HOST_LABEL) return env.HOST_LABEL
  for (const args of [['--get', 'ComputerName'], ['--get', 'LocalHostName']]) {
    try {
      const out = execFileSync('scutil', args, { encoding: 'utf8' }).trim()
      if (out) return out
    } catch {
      // ignore — not macOS or scutil unavailable
    }
  }
  try {
    return execFileSync('hostname', ['-s'], { encoding: 'utf8' }).trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

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
