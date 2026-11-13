import { createElement, useState, type KeyboardEvent, type MouseEvent } from 'react'

// Copy-to-clipboard with the "copied!" badge timing of the original page:
// instant copy on single click, but ignore the extra clicks of a double/triple-
// click (text selection), and don't flip state back mid-selection (the badge
// would distract while the user is selecting text).
export function useCopy() {
  const [copied, setCopied] = useState(false)

  function copy(text: string, e?: { detail: number }) {
    if (e && e.detail > 1) return
    if (String(window.getSelection() ?? '').length) return
    const done = () => {
      setCopied(true)
      setTimeout(() => {
        if (String(window.getSelection() ?? '').length) {
          setTimeout(() => setCopied(false), 2000)
        } else {
          setCopied(false)
        }
      }, 1500)
    }
    const fallback = () => {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        // ignore — the badge still gives feedback, and the user can select manually
      }
      ta.remove()
      done()
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback)
    } else {
      fallback()
    }
  }

  return { copied, copy }
}

/**
 * What makes an element a press that copies, from the pointer or the keyboard, named `label` as a
 * button is. Not a `<button>`, so the command in it can still be selected by hand.
 */
export function copyPress(label: string, copy: (e?: { detail: number }) => void) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: (e: MouseEvent) => copy(e),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      copy()
    },
  }
}

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' } as const

/** "Copied", said to a screen reader once a copy worked; the badge beside the press shows it. */
export function CopiedStatus({ copied }: { copied: boolean }) {
  return createElement('span', { role: 'status', style: visuallyHidden }, copied ? 'Copied' : '')
}
