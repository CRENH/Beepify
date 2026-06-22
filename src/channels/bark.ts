import type { Channel, RenderedMessage, ChannelConfig, ChannelResult } from '../core/types'
import { enc, request } from '../core/http'

export const barkChannel: Channel = {
  name: 'bark',
  async send(msg: RenderedMessage, cfg: ChannelConfig): Promise<ChannelResult> {
    const key = typeof cfg.key === 'string' ? cfg.key : ''
    if (!key) return { channel: 'bark', ok: false, skipped: true }

    const server = typeof cfg.server === 'string' && cfg.server ? cfg.server : 'https://api.day.app'
    let url = `${server}/${key}/${enc(msg.title)}/${enc(msg.body)}?group=${enc(msg.group || 'Beepify')}`
    if (typeof cfg.icon === 'string' && cfg.icon) url += `&icon=${enc(cfg.icon)}`

    const res = await request(url, { method: 'GET' })
    return { channel: 'bark', ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` }
  },
}
