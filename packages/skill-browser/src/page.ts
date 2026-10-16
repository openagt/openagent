import type { CdpSession } from './cdp.js'

/**
 * What the agent does to the page, each a few DevTools calls. The page is read as text plus a
 * numbered list of what can be clicked or typed into; the numbers are written onto the elements
 * themselves (`data-browser-ref`), so `click 3` finds the very element the last read listed.
 */

/** Thrown when the page says no: the agent reads the sentence. */
export class PageError extends Error {}

/** How much of the page's text a read prints. */
export const TEXT_LIMIT = 10_000
/** How many elements a read lists. */
export const ELEMENT_LIMIT = 300

const REF = 'data-browser-ref'

/** Runs in the page: number the elements, and return the text and the list. */
const READ_SCRIPT = `(() => {
  const REF = ${JSON.stringify(REF)}
  for (const el of document.querySelectorAll('[' + REF + ']')) el.removeAttribute(REF)
  const shown = el => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
  const selector = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem],[contenteditable=""],[contenteditable=true]'
  const items = []
  let n = 0
  let more = 0
  for (const el of document.querySelectorAll(selector)) {
    if (!shown(el)) continue
    if (n >= ${ELEMENT_LIMIT}) { more++; continue }
    n++
    el.setAttribute(REF, String(n))
    const tag = el.tagName.toLowerCase()
    const type = tag === 'input' ? (el.type || 'text') : ''
    const kind = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? (type === 'text' ? 'input' : 'input[' + type + ']') : tag)
    const label = clean(el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || (tag === 'input' || tag === 'textarea' || tag === 'select' ? '' : el.innerText) || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name'))
    let extra = ''
    if (tag === 'a') extra = ' -> ' + el.getAttribute('href')
    else if (type === 'checkbox' || type === 'radio') extra = el.checked ? ' (checked)' : ' (not checked)'
    else if (tag === 'input' || tag === 'textarea' || tag === 'select') extra = ' value=' + JSON.stringify(el.value)
    if (el.disabled) extra += ' (disabled)'
    items.push('[' + n + '] ' + kind + ' ' + JSON.stringify(label) + extra)
  }
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').trim()
  if (more) items.push('… ' + more + ' more elements not listed: find them with eval')
  return { title: document.title, url: location.href, text, items }
})()`

interface ReadResult {
  title: string
  url: string
  text: string
  items: string[]
}

/** Run `expression` in the page; `repl` lets it use `await` at its top level, as a console does. */
async function evaluate<T>(page: CdpSession, expression: string, repl = false): Promise<T> {
  const res = await page.send<{ result: { value?: unknown; unserializableValue?: string }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    ...(repl ? { replMode: true } : {}),
  })
  if (res.exceptionDetails) throw new PageError(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? 'the script threw')
  return (res.result.unserializableValue !== undefined ? new Unserializable(res.result.unserializableValue) : res.result.value) as T
}

/** A value JSON cannot hold (`Infinity`, `NaN`, `-0`, a BigInt), as DevTools spells it. */
class Unserializable {
  constructor(readonly text: string) {}
}

/**
 * Wait until the page has loaded after an action: a short pause for a navigation to begin, then
 * until `document.readyState` is `complete` (a page mid-navigation throws, which is retried), then
 * a beat for a script-rendered page to draw. Gives up quietly after `timeoutMs`: a slow page is
 * still read as it stands.
 */
export async function settle(page: CdpSession, timeoutMs = 10_000): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 250))
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await evaluate<string>(page, 'document.readyState').catch(() => 'loading')
    if (state === 'complete') break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  await new Promise(resolve => setTimeout(resolve, 200))
}

/** The page as the agent reads it. */
export async function readPage(page: CdpSession): Promise<string> {
  const { title, url, text, items } = await evaluate<ReadResult>(page, READ_SCRIPT)
  const shownText = text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n… (${text.length - TEXT_LIMIT} more characters not shown)` : text
  return [
    `Title: ${title}`,
    `URL: ${url}`,
    '',
    shownText || '(no text on the page)',
    '',
    items.length ? 'Elements (the number is what click and type take):' : 'Elements: none',
    ...items,
  ].join('\n')
}

/** An address the agent typed, made absolute: `localhost:3000` means `http://localhost:3000`. */
export function absoluteUrl(address: string): string {
  if (/^https?:\/\//i.test(address)) return address
  if (/^[a-z][a-z0-9+.-]*:/i.test(address) && !/^[^:/]+:\d/.test(address)) throw new PageError(`only http and https addresses open: ${address}`)
  return `http://${address}`
}

export async function navigate(page: CdpSession, address: string): Promise<void> {
  const res = await page.send<{ errorText?: string }>('Page.navigate', { url: absoluteUrl(address) })
  if (res.errorText) throw new PageError(`${address} did not open: ${res.errorText}`)
  await settle(page)
}

/** Where element `ref` is on screen, scrolled into view first. */
async function locate(page: CdpSession, ref: number): Promise<{ x: number; y: number }> {
  const point = await evaluate<{ x: number; y: number } | null>(
    page,
    `(() => {
      const el = document.querySelector('[${REF}="${ref}"]')
      if (!el) return null
      el.scrollIntoView({ block: 'center', inline: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`,
  )
  if (!point) throw new PageError(`no element [${ref}] on the page: read it again, the numbers change when the page does`)
  return point
}

/** Where on the page something happened, for whoever watches to be shown the agent's own pointer. */
export interface Point {
  x: number
  y: number
}

/** A real mouse click at the element's middle, so the page sees what a person's click makes. */
export async function click(page: CdpSession, ref: number): Promise<Point> {
  const { x, y } = await locate(page, ref)
  const base = { x, y, button: 'left', clickCount: 1 }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' })
  await page.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' })
  await settle(page)
  return { x, y }
}

/**
 * Put `text` in element `ref`, replacing what it held. A `select` takes the option whose text or
 * value is `text`; anything else is focused, its content selected, and the text typed over it.
 */
export async function type(page: CdpSession, ref: number, text: string): Promise<Point> {
  const at = await locate(page, ref)
  const outcome = await evaluate<string>(
    page,
    `(() => {
      const el = document.querySelector('[${REF}="${ref}"]')
      const text = ${JSON.stringify(text)}
      if (el.tagName === 'SELECT') {
        const option = [...el.options].find(o => o.text.trim() === text || o.value === text)
        if (!option) return 'no option ' + JSON.stringify(text) + '; the options are ' + [...el.options].map(o => JSON.stringify(o.text.trim())).join(', ')
        el.value = option.value
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return 'set'
      }
      // A date or time field takes no typed characters: its value is set as a person's picker
      // would, and a value the field does not accept is refused.
      if (el.tagName === 'INPUT' && ['date', 'time', 'datetime-local', 'month', 'week'].includes(el.type)) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text)
        if (el.value !== text) return JSON.stringify(text) + ' is not a ' + el.type + ' value; give it as ' + ({ date: '2024-01-31', time: '13:45', 'datetime-local': '2024-01-31T13:45', month: '2024-01', week: '2024-W05' })[el.type]
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return 'set'
      }
      const textual = el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color'].includes(el.type))
      if (!textual) return 'element [${ref}] takes no text: click it instead'
      el.focus()
      if (typeof el.select === 'function') el.select()
      else if (el.isContentEditable) document.getSelection().selectAllChildren(el)
      return document.activeElement === el ? 'focused' : 'element [${ref}] does not take the focus'
    })()`,
  )
  if (outcome === 'set') {
    await settle(page)
    return at
  }
  if (outcome !== 'focused') throw new PageError(outcome)
  await page.send('Input.insertText', { text })
  await settle(page)
  return at
}

/** The keys `press` knows, as DevTools key events. */
export const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Space: { code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
}

export async function press(page: CdpSession, key: string): Promise<void> {
  const known = KEYS[key]
  if (!known) throw new PageError(`unknown key ${key}; the keys are ${Object.keys(KEYS).join(', ')}`)
  const event = { key: key === 'Space' ? ' ' : key, code: known.code, windowsVirtualKeyCode: known.keyCode, ...(known.text ? { text: known.text } : {}) }
  await page.send('Input.dispatchKeyEvent', { ...event, type: 'keyDown' })
  await page.send('Input.dispatchKeyEvent', { ...event, type: 'keyUp' })
  await settle(page)
}

/**
 * What the pointer looks like at a point of the page: the CSS cursor the page would show there,
 * for the picture a person watches to show the same. `auto` is the browser's own choice, which is
 * an I-beam where there are words to select and the plain arrow elsewhere; a cursor the page gave
 * a picture of its own is the plain arrow, since no page picks what a watcher's browser fetches.
 */
export async function cursorAt(page: CdpSession, x: number, y: number): Promise<string> {
  return evaluate<string>(
    page,
    `(() => {
      const el = document.elementFromPoint(${x}, ${y})
      if (!el) return 'default'
      const said = getComputedStyle(el).cursor
      if (said !== 'auto') return said
      const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(${x}, ${y}) : null
      const node = range && range.startContainer
      return node && node.nodeType === 3 && (node.textContent || '').trim() ? 'text' : 'default'
    })()`,
  ).catch(() => 'default')
}

/** The visible part of the page as PNG bytes. */
export async function screenshot(page: CdpSession): Promise<Buffer> {
  const { data } = await page.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
  return Buffer.from(data, 'base64')
}

/** Run `script` in the page and print what it returns, as JSON. */
export async function run(page: CdpSession, script: string): Promise<string> {
  const value = await evaluate<unknown>(page, script, true)
  if (value instanceof Unserializable) return value.text
  return value === undefined ? 'undefined' : JSON.stringify(value, null, 2)
}
