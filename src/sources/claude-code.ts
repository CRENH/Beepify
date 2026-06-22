import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { Source, NormalizedEvent } from '../core/types'

const STRING_KEYS = ['command', 'file_path', 'path', 'url', 'query', 'pattern', 'plan', 'description', 'prompt']

export function toolDesc(b: unknown): string {
  const block = (b ?? {}) as { name?: string; input?: Record<string, unknown> }
  const name = block.name || 'tool'
  const inp = block.input || {}

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
      action = tools.length ? toolDesc(tools[tools.length - 1]) : ''
    }
  }
  return { summary, action }
}

export const claudeCodeSource: Source = {
  name: 'claude-code',
  parse(raw: unknown): NormalizedEvent | null {
    const d = (raw ?? {}) as {
      hook_event_name?: string
      cwd?: string
      transcript_path?: string
      message?: string
    }
    const event = d.hook_event_name
    if (event !== 'Stop' && event !== 'Notification') return null

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
