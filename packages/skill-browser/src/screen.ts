import { KEYS } from './page.js'
import type { CdpSession } from './cdp.js'

/**
 * What a person watching the screen sends back (a click, a scroll, typing, the address bar's
 * buttons), and the DevTools calls it becomes. Anything not recognized becomes no call at all: a
 * malformed request never reaches Chrome.
 */
export type ScreenInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; deltaY: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: string }
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }

export interface CdpCall {
  method: string
  params: Record<string, unknown>
}

/** The calls one input maps to; `back` and `forward` need the history, so they are the caller's. */
export function inputCalls(input: ScreenInput): CdpCall[] {
  switch (input?.type) {
    case 'click': {
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return []
      const base = { x: input.x, y: input.y, button: 'left', clickCount: 1 }
      return [
        { method: 'Input.dispatchMouseEvent', params: { ...base, type: 'mousePressed' } },
        { method: 'Input.dispatchMouseEvent', params: { ...base, type: 'mouseReleased' } },
      ]
    }
    case 'scroll':
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || !Number.isFinite(input.deltaY)) return []
      return [{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: input.x, y: input.y, deltaX: 0, deltaY: input.deltaY } }]
    case 'text':
      if (typeof input.text !== 'string' || input.text === '') return []
      return [{ method: 'Input.insertText', params: { text: input.text } }]
    case 'key': {
      const known = typeof input.key === 'string' && Object.hasOwn(KEYS, input.key) ? KEYS[input.key] : undefined
      if (!known) return []
      const event = { key: input.key === 'Space' ? ' ' : input.key, code: known.code, windowsVirtualKeyCode: known.keyCode, ...(known.text ? { text: known.text } : {}) }
      return [
        { method: 'Input.dispatchKeyEvent', params: { ...event, type: 'keyDown' } },
        { method: 'Input.dispatchKeyEvent', params: { ...event, type: 'keyUp' } },
      ]
    }
    case 'navigate':
      if (typeof input.url !== 'string' || !/^https?:\/\//i.test(input.url)) return []
      return [{ method: 'Page.navigate', params: { url: input.url } }]
    case 'reload':
      return [{ method: 'Page.reload', params: {} }]
    default:
      return []
  }
}

/** Go one step back or forward in the page's history; nothing when there is no such step. */
export async function stepHistory(page: CdpSession, by: -1 | 1): Promise<void> {
  const { currentIndex, entries } = await page.send<{ currentIndex: number; entries: { id: number }[] }>('Page.getNavigationHistory')
  const entry = entries[currentIndex + by]
  if (entry) await page.send('Page.navigateToHistoryEntry', { entryId: entry.id })
}
