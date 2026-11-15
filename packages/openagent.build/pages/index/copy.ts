import { createElement, useState } from 'react'

// Copy-to-clipboard with the check's timing: instant copy on single click, but
// ignore the extra clicks of a double/triple-click (text selection), and don't
// flip state back mid-selection (the check would distract while the user is
// selecting text).
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

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' } as const

/** "Copied", said to a screen reader once a copy worked; the press's check shows it. */
export function CopiedStatus({ copied }: { copied: boolean }) {
  return createElement('span', { role: 'status', style: visuallyHidden }, copied ? 'Copied' : '')
}
