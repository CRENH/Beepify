import type { NormalizedEvent, BeepifyConfig, ChannelResult } from './types'
import { render } from './render'
import { isDebounced } from './debounce'
import { getChannel } from './registry'

export async function dispatch(
  event: NormalizedEvent,
  config: BeepifyConfig,
): Promise<ChannelResult[]> {
  if (isDebounced(event.kind, config.debounce_seconds)) {
    return [{ channel: '*', ok: true, skipped: true }]
  }
  const msg = render(event, config)
  return Promise.all(
    config.channels.map(async (cfg): Promise<ChannelResult> => {
      const ch = getChannel(cfg.type)
      if (!ch) return { channel: cfg.type, ok: false, skipped: true }
      try {
        return await ch.send(msg, cfg)
      } catch (e) {
        return { channel: cfg.type, ok: false, error: (e as Error).message }
      }
    }),
  )
}
