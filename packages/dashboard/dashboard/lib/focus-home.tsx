import { useLayoutEffect, useRef, type ComponentProps, type RefObject } from 'react'
import { overlayOpen } from './shortcut.js'

// Where the keyboard goes when a press on the page takes its own control away (a row it removes, a
// line that replaces it) or turns it disabled: the browser leaves it on the page's body, where Tab
// starts over from the top. Each home is a region of the page; the keyboard goes to the nearest one
// still there around where it was. Inside an overlay the library owns the keyboard, so a home does
// nothing there, nor while one is open.

/** Every home on the page, with the element it lands on, when it names one. */
const homes = new Map<HTMLElement, RefObject<HTMLElement | null> | undefined>()

/** Where the keyboard last was on the page, and the homes around it, nearest first. */
let last: { at: Element; around: HTMLElement[] } | undefined

const CONTROLS = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

function usable(element: HTMLElement | null | undefined): element is HTMLElement {
  return !!element && element.isConnected && !element.matches(':disabled') && !element.closest('[inert], [aria-hidden="true"], [data-overlay]') && (element.checkVisibility?.() ?? true)
}

/** The homes an element stands in, nearest first. */
function homesAround(element: Element): HTMLElement[] {
  const around: HTMLElement[] = []
  for (let node = element.parentElement; node; node = node.parentElement) if (homes.has(node)) around.push(node)
  return around
}

function noted(event: FocusEvent): void {
  if (!(event.target instanceof Element) || event.target.closest('[data-overlay]')) return
  last = { at: event.target, around: homesAround(event.target) }
}

function land(): void {
  if (!last || (document.activeElement !== null && document.activeElement !== document.body)) return
  // Still there and usable: the person put the keyboard on the page themselves.
  if (last.at.isConnected && !last.at.matches(':disabled')) return void (last = undefined)
  if (overlayOpen()) return
  // Every home around it gone with it (the page changed): the outermost one there now.
  const home = last.around.find(each => each.isConnected && homes.has(each)) ?? [...homes.keys()].find(each => each.isConnected && homesAround(each).length === 0)
  const landing = home && homes.get(home)?.current
  // None usable yet (its presses wait too): the next change of the page tries again, while a home is there.
  const to = usable(landing) ? landing : home && [...home.querySelectorAll<HTMLElement>(CONTROLS)].find(usable)
  if (to || !home) last = undefined
  to?.focus()
}

/** A browser that drops a disabled element's focus says so with a focusout, after the change. */
const dropped = (event: FocusEvent): void => {
  if (event.relatedTarget === null) queueMicrotask(land)
}
let watching = false

/** Watch the page from the first home on, for as long as the page lives: homes come and go with it. */
function watch(): void {
  if (watching) return
  watching = true
  document.addEventListener('focusin', noted, true)
  document.addEventListener('focusout', dropped, true)
  new MutationObserver(land).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] })
}

/**
 * A region of the page that takes the keyboard when the control that had it, inside, is taken away
 * or turned disabled: onto `landing` if it is there and usable, else onto its first usable control.
 */
export function FocusHome({ as: Tag = 'div', landing, ...props }: ComponentProps<'div'> & { as?: 'div' | 'main' | 'section'; landing?: RefObject<HTMLElement | null> }) {
  const home = useRef<HTMLElement>(null)
  // Before the page's change is watched: a home drawn anew with it is there to land in.
  useLayoutEffect(() => {
    const element = home.current!
    homes.set(element, landing)
    watch()
    return () => void homes.delete(element)
  }, [landing])
  return <Tag ref={home as RefObject<HTMLDivElement>} {...props} />
}
