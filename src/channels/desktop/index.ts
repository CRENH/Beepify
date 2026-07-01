import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import type { Channel, RenderedMessage, ChannelConfig, ChannelResult } from '../../core/types'
import { selectProvider } from './select'
import { defaultRun } from './run'
import { detectOpenIsland, realProbe } from './detect'

export const desktopChannel: Channel = {
  name: 'desktop',
  async send(msg: RenderedMessage, cfg: ChannelConfig): Promise<ChannelResult> {
    const name = typeof cfg.provider === 'string' && cfg.provider ? cfg.provider : 'native'
    const detect = () => detectOpenIsland({ probe: realProbe, exists: existsSync, home: homedir() }).command || ''
    const provider = selectProvider(name, { platform: process.platform, probe: realProbe, run: defaultRun, detect })
    if (typeof provider !== 'function') return { channel: 'desktop', ok: false, error: provider.error }
    const r = await provider(msg, cfg)
    return { channel: 'desktop', ok: r.ok, error: r.error }
  },
}
