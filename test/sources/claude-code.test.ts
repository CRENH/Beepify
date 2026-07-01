import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toolDesc, parseTranscript, claudeCodeSource } from '../../src/sources/claude-code'
import type { BeepifyConfig } from '../../src/core/types'

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
  it('recovers from __unparsedToolInput when raw is valid JSON', () => {
    // Claude Code stores the raw string under __unparsedToolInput when a tool
    // call's input fails strict parsing; toolDesc must still surface content.
    const raw = JSON.stringify({ questions: [{ header: 'Idle', question: 'Suppress?' }] })
    expect(toolDesc({ name: 'AskUserQuestion', input: { __unparsedToolInput: { raw } } }))
      .toBe('AskUserQuestion: Idle: Suppress?')
  })
  it('recovers a generic tool field from __unparsedToolInput valid JSON', () => {
    const raw = JSON.stringify({ command: 'rm -rf /tmp/x' })
    expect(toolDesc({ name: 'Bash', input: { __unparsedToolInput: { raw } } }))
      .toBe('Bash: rm -rf /tmp/x')
  })
  it('best-effort extracts a field when __unparsedToolInput raw is NOT valid JSON', () => {
    // Truncated / malformed JSON that JSON.parse rejects, but still readable.
    const raw = '{"questions":[{"header":"H","question":"Pick one?","options":[{"lab'
    expect(toolDesc({ name: 'AskUserQuestion', input: { __unparsedToolInput: { raw } } }))
      .toBe('AskUserQuestion: Pick one?')
  })
  it('falls back to bare name when __unparsedToolInput raw has nothing recoverable', () => {
    expect(toolDesc({ name: 'AskUserQuestion', input: { __unparsedToolInput: { raw: '####' } } }))
      .toBe('AskUserQuestion')
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
  it('clears action when the last assistant turn has no tool (summary still persists)', () => {
    // A tool turn followed by a text-only assistant turn means no tool is currently
    // pending — `action` must be '' so the event classifies as waiting-input, not
    // needs-approval. Preserving the earlier tool across turns would resurface an
    // already-resolved tool and misclassify. This pins that intended semantics.
    const p = join(mkdtempSync(join(tmpdir(), 'beepify-tx-')), 't.jsonl')
    writeFileSync(p, [
      JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      ] } }),
      JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'text', text: 'all done' },
      ] } }),
    ].join('\n'))
    expect(parseTranscript(p)).toEqual({ summary: 'all done', action: '' })
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
  it('idle_prompt Notification is suppressed by default (notify_idle off)', () => {
    const cfg: BeepifyConfig = { debounce_seconds: 0, host_label: '', locale: 'en', channels: [] }
    const ev = claudeCodeSource.parse(
      { hook_event_name: 'Notification', cwd: '/a/proj', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' },
      cfg,
    )
    expect(ev).toBeNull()
  })
  it('idle_prompt Notification is emitted when notify_idle is on', () => {
    const cfg: BeepifyConfig = { debounce_seconds: 0, host_label: '', locale: 'en', channels: [], notify_idle: true }
    const ev = claudeCodeSource.parse(
      { hook_event_name: 'Notification', cwd: '/a/proj', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' },
      cfg,
    )
    expect(ev).toMatchObject({ kind: 'waiting-input', summary: 'Claude is waiting for your input' })
  })
  it('non-idle Notification is unaffected by notify_idle (approval still fires)', () => {
    const cfg: BeepifyConfig = { debounce_seconds: 0, host_label: '', locale: 'en', channels: [] }
    const ev = claudeCodeSource.parse(
      { hook_event_name: 'Notification', cwd: '/a/proj', message: 'needs you' },
      cfg,
    )
    expect(ev).toMatchObject({ kind: 'waiting-input', summary: 'needs you' })
  })
  void env
})
