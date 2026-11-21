import { useEffect } from 'react'

/** How long what a phone shows is read at every frame once it changed: as its keyboard slides and settles. */
const SETTLE_MS = 700

/** Whether a box someone types in has the focus: what brings up a phone's keyboard. */
function typing(): boolean {
  const focused = document.activeElement
  return focused instanceof HTMLElement && (focused.isContentEditable || focused instanceof HTMLTextAreaElement || (focused instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(focused.type)))
}

/**
 * Pin the page in place while `pinned` (`html[data-pinned]` in tailwind.css): only its own columns
 * scroll. A phone made the page itself a little taller than it shows, and a finger on the top bar
 * or the message box scrolled it, or reloaded it.
 *
 * The page lies exactly where the screen shows it (`--shown-height`, `--shown-top`): with a phone's
 * keyboard open, the room above the keyboard, so the message box sits on the keyboard. Safari
 * leaves the page as tall, lays its keyboard over it and scrolls what shows: the page follows where
 * that is, rather than scrolling it back, which made it jump while the keyboard came and went.
 */
export function usePinnedPage(pinned: boolean): void {
  useEffect(() => {
    if (!pinned) return
    document.documentElement.dataset['pinned'] = 'true'
    const view = window.visualViewport
    const root = document.documentElement
    // Only while a box has the keyboard: once none has, the page is the whole screen at its top
    // again, whatever Safari still says of what shows, which kept it short and low after its
    // keyboard was gone.
    const fit = (): void => {
      if (!view) return
      if (!typing()) {
        root.style.removeProperty('--shown-height')
        root.style.removeProperty('--shown-top')
        if (window.scrollY !== 0 || view.offsetTop !== 0) window.scrollTo(0, 0)
        return
      }
      root.style.setProperty('--shown-height', `${view.height}px`)
      root.style.setProperty('--shown-top', `${view.offsetTop}px`)
    }
    // Safari moves what shows as its keyboard slides, says so only after, and says nothing once
    // it stopped: while a box takes or lets go of the keyboard, what shows is read at every frame.
    let frame = 0
    let until = 0
    const step = (): void => {
      fit()
      frame = performance.now() < until ? requestAnimationFrame(step) : 0
    }
    const settle = (): void => {
      until = performance.now() + SETTLE_MS
      fit()
      if (frame === 0) frame = requestAnimationFrame(step)
    }
    fit()
    view?.addEventListener('resize', settle)
    view?.addEventListener('scroll', settle)
    document.addEventListener('focusin', settle)
    document.addEventListener('focusout', settle)
    return () => {
      delete root.dataset['pinned']
      root.style.removeProperty('--shown-height')
      root.style.removeProperty('--shown-top')
      cancelAnimationFrame(frame)
      view?.removeEventListener('resize', settle)
      view?.removeEventListener('scroll', settle)
      document.removeEventListener('focusin', settle)
      document.removeEventListener('focusout', settle)
    }
  }, [pinned])
}
