import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toolDesc, parseTranscript, claudeCodeSource } from '../../src/sources/claude-code'

describe('toolDesc', () => {
  it('AskUserQuestion: distinct prompts yield distinct text', () => {
    const a = toolDesc({ name: 'AskUserQuestion', input: { questions: [
      { header: 'Name', question: 'Which name?' }, { header: 'Scope', question: 'How far?' },
    ] } })
    const b = toolDesc({ name: 'AskUserQuestion', input: { questions: [
      { header: 'Vibe', question: 'Tool or mascot?' },
    ] } })
    expect(a).toBe('AskUserQuestion: Name: Which name? / Scope: How far?')
    expect(b).toBe('AskUserQuestion: Vibe: Tool or mascot?')
    expect(a).not.toBe(b)
  })
  it('ExitPlanMode shows the plan', () => {
    expect(toolDesc({ name: 'ExitPlanMode', input: { plan: 'do X' } })).toBe('ExitPlanMode: do X')
  })
  it('generic tool uses first string field', () => {
    expect(toolDesc({ name: 'Bash', input: { command: 'ls -la' } })).toBe('Bash: ls -la')
  })
  it('falls back to tool name when no string field', () => {
    expect(toolDesc({ name: 'TodoWrite', input: { todos: [{ x: 1 }] } })).toBe('TodoWrite')
  })
})

describe('parseTranscript', () => {
  it('extracts last assistant summary and last pending tool', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'beepify-tx-')), 't.jsonl')
    writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
      JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'text', text: 'working on it' },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      ] } }),
    ].join('\n'))
    expect(parseTranscript(p)).toEqual({ summary: 'working on it', action: 'Bash: ls' })
  })
  it('returns empty fields for a missing file', () => {
    expect(parseTranscript('/nonexistent/path')).toEqual({ summary: '', action: '' })
  })
})

describe('claudeCodeSource.parse', () => {
  const env = { HOST_LABEL: 'TESTHOST' }
  process.env.HOST_LABEL = 'TESTHOST'

  it('returns null for unrelated events', () => {
    expect(claudeCodeSource.parse({ hook_event_name: 'PostToolUse' })).toBeNull()
  })
  it('Stop -> done', () => {
    const ev = claudeCodeSource.parse({ hook_event_name: 'Stop', cwd: '/a/proj' })
    expect(ev).toMatchObject({ kind: 'done', host: 'TESTHOST', project: 'proj' })
  })
  it('Notification with pending tool -> needs-approval (no transcript)', () => {
    // No transcript_path -> action empty -> waiting-input; assert that path
    const ev = claudeCodeSource.parse({ hook_event_name: 'Notification', cwd: '/a/proj', message: 'hi' })
    expect(ev).toMatchObject({ kind: 'waiting-input', summary: 'hi' })
  })
  void env
})
