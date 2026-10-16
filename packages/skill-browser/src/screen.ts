import { KEYS } from './page.js'
import type { CdpSession } from './cdp.js'

/**
 * What a person watching the screen sends back (their mouse, a scroll, typing, the address bar's
 * buttons), and the DevTools calls it becomes. Anything not recognized becomes no call at all: a
 * malformed request never reaches Chrome.
 *
 * The mouse is sent as a mouse, not as clicks: where it moved, when it went down and when it came
 * up. So the page hovers under it, a press and a drag are a press and a drag (a slider moves,
 * words are selected), and a click is what a down and an up at one place already make. `leave`
 * says the pointer left the picture, so what it hovered stops hovering.
 *
 * Pasting is `text`, the same as typing it: what the person's own browser took off their
 * clipboard goes where the page's cursor is, which is how a password out of a password manager
 * reaches a sign-in form. Copying needs no input at all: the browser tells whoever watches what
 * the page has selected, and their own browser copies that.
 */
export type ScreenInput =
  | { type: 'move'; x: number; y: number; held?: boolean }
  | { type: 'down'; x: number; y: number; clicks?: number }
  | { type: 'up'; x: number; y: number; clicks?: number }
  | { type: 'leave' }
  | { type: 'selectAll' }
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

/** Where a pointer says it is, when it says a place at all. */
function place(input: { x: number; y: number }): { x: number; y: number } | undefined {
  return Number.isFinite(input.x) && Number.isFinite(input.y) ? { x: input.x, y: input.y } : undefined
}

/** How many clicks an input says, for the page to tell a click from a double one: one to three. */
function clicks(said: number | undefined): number {
  return said !== undefined && Number.isInteger(said) && said >= 1 && said <= 3 ? said : 1
}

/** The calls one input maps to; `back` and `forward` need the history, so they are the caller's. */
export function inputCalls(input: ScreenInput): CdpCall[] {
  switch (input?.type) {
    case 'move': {
      const at = place(input)
      if (!at) return []
      // A move with the button held is a drag: the page is told which button, as a mouse does.
      const held = input.held === true
      return [{ method: 'Input.dispatchMouseEvent', params: { ...at, type: 'mouseMoved', button: held ? 'left' : 'none', buttons: held ? 1 : 0 } }]
    }
    case 'down': {
      const at = place(input)
      return at ? [{ method: 'Input.dispatchMouseEvent', params: { ...at, type: 'mousePressed', button: 'left', buttons: 1, clickCount: clicks(input.clicks) } }] : []
    }
    case 'up': {
      const at = place(input)
      return at ? [{ method: 'Input.dispatchMouseEvent', params: { ...at, type: 'mouseReleased', button: 'left', buttons: 0, clickCount: clicks(input.clicks) } }] : []
    }
    case 'selectAll':
      // DevTools carries the editing commands a key press stands for, which is how a browser does
      // select-all itself: the page is never sent a stray "a" that a field would take as typing.
      return [
        { method: 'Input.dispatchKeyEvent', params: { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4, commands: ['selectAll'] } },
        { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 } },
      ]
    case 'leave':
      // DevTools has no "the mouse left": a move to a point off the page is one, and what the
      // page hovered stops hovering.
      return [{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: -1, y: -1, button: 'none', buttons: 0 } }]
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
