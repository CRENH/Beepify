export type EventKind = 'done' | 'needs-approval' | 'waiting-input' | 'error'

export interface NormalizedEvent {
  kind: EventKind
  agent: string
  host: string
  project: string
  summary?: string
  action?: string
  raw?: unknown
  ts: number
}

export interface RenderedMessage {
  title: string
  body: string
  group?: string
  icon?: string
  event: NormalizedEvent
}

export interface ChannelResult {
  channel: string
  ok: boolean
  skipped?: boolean
  error?: string
}

export interface ChannelConfig {
  type: string
  [key: string]: unknown
}

export interface BeepifyConfig {
  debounce_seconds: number
  host_label: string
  locale: 'en' | 'zh-CN'
  channels: ChannelConfig[]
  notify_idle?: boolean
}

export interface Source {
  name: string
  parse(raw: unknown, config?: BeepifyConfig): NormalizedEvent | null
}

export interface Channel {
  name: string
  send(msg: RenderedMessage, cfg: ChannelConfig): Promise<ChannelResult>
}
