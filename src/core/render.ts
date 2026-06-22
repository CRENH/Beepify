import type { NormalizedEvent, RenderedMessage, BeepifyConfig, EventKind } from './types'

type Locale = 'en' | 'zh-CN'

const TITLES: Record<Locale, Record<EventKind, string>> = {
  en: {
    done: '✅ Done',
    'needs-approval': '🔔 Needs approval',
    'waiting-input': '💬 Waiting for you',
    error: '⚠️ Error',
  },
  'zh-CN': {
    done: '✅ 任务完成',
    'needs-approval': '🔔 需要授权',
    'waiting-input': '💬 在等你回复',
    error: '⚠️ 错误',
  },
}

const DONE_FALLBACK: Record<Locale, string> = {
  en: 'finished this round',
  'zh-CN': '已结束本轮',
}

export function flat(s: string): string {
  const t = s.split(/\s+/).filter(Boolean).join(' ')
  return t.length > 300 ? t.slice(0, 299) + '…' : t
}

export function render(event: NormalizedEvent, config: BeepifyConfig): RenderedMessage {
  const locale: Locale = config.locale === 'zh-CN' ? 'zh-CN' : 'en'
  const title = `${TITLES[locale][event.kind]} · ${event.host}`

  let body: string
  if (event.kind === 'needs-approval') {
    body = event.action || event.summary || ''
  } else if (event.kind === 'done') {
    body = event.summary || `${event.project} ${DONE_FALLBACK[locale]}`
  } else {
    body = event.summary || ''
  }

  return { title, body: flat(body), group: 'Beepify', event }
}
