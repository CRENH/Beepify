import type { RenderedMessage, ChannelConfig } from '../../core/types'

export interface RunResult { code: number; stderr: string }
export type Runner = (file: string, args: string[], input?: string) => Promise<RunResult>
export type DesktopProvider = (msg: RenderedMessage, cfg: ChannelConfig) => Promise<{ ok: boolean; error?: string }>
export type Probe = (bin: string) => boolean
