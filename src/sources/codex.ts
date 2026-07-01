import { basename } from 'node:path'
import type { Source, NormalizedEvent, BeepifyConfig } from '../core/types'
import { resolveHost, toolDesc } from './shared'

// Codex delivers hooks as JSON on stdin, keyed on hook_event_name — the same
// envelope as Claude Code. We surface only the two highest-value kinds:
//   Stop              -> done          (last_assistant_message)
//   PermissionRequest -> needs-approval (tool_name + tool_input)
// Codex has no idle/Notification event, so there is no waiting-input kind.
//
// A Beepify command run as a Codex hook must always exit 0 (Codex treats exit 2
// as "block the session"). This parser only maps data; the CLI notify path is
// already crash-safe and never exits non-zero.
export const codexSource: Source = {
  name: 'codex',
  parse(raw: unknown, _config?: BeepifyConfig): NormalizedEvent | null {
    const d = (raw ?? {}) as {
      hook_event_name?: string
      cwd?: string
      last_assistant_message?: string
      tool_name?: string
      tool_input?: Record<string, unknown>
    }
    const event = d.hook_event_name
    if (event !== 'Stop' && event !== 'PermissionRequest') return null

    const cwd = d.cwd || process.cwd()
    const base = {
      agent: 'codex',
      host: resolveHost(),
      project: basename(cwd),
      raw,
      ts: Date.now(),
    }

    if (event === 'Stop') {
      return { kind: 'done', summary: d.last_assistant_message || '', ...base }
    }
    // PermissionRequest
    const action = toolDesc({ name: d.tool_name, input: d.tool_input })
    const summary =
      d.tool_input && typeof d.tool_input.description === 'string' ? d.tool_input.description : ''
    return { kind: 'needs-approval', action, summary, ...base }
  },
}
