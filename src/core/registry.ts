import type { Source, Channel } from './types'

const sources = new Map<string, Source>()
const channels = new Map<string, Channel>()

export function registerSource(s: Source): void { sources.set(s.name, s) }
export function registerChannel(c: Channel): void { channels.set(c.name, c) }
export function getSource(name: string): Source | undefined { return sources.get(name) }
export function getChannel(name: string): Channel | undefined { return channels.get(name) }
export function clearRegistry(): void { sources.clear(); channels.clear() }
