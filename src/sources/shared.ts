import { execFileSync } from 'node:child_process'

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
