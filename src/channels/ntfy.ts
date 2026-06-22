import type { Channel, RenderedMessage, ChannelConfig, ChannelResult } from '../core/types'
import { request } from '../core/http'

export const ntfyChannel: Channel = {
  name: 'ntfy',
  async send(msg: RenderedMessage, cfg: ChannelConfig): Promise<ChannelResult> {
    const topic = typeof cfg.topic === 'string' ? cfg.topic : ''
    if (!topic) return { channel: 'ntfy', ok: false, skipped: true }

    const server = typeof cfg.server === 'string' && cfg.server ? cfg.server : 'https://ntfy.sh'
    const body = JSON.stringify({ topic, title: msg.title, message: msg.body })

    const res = await request(server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    return { channel: 'ntfy', ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` }
  },
}
