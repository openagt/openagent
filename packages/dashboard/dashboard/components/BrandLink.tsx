import { Logo } from './Logo.js'

// The mark and the wordmark are the way home (#909): clicking them goes to the Overview, at `href`: `/`, plus the picked project when there is one (#1513).
//
// A real `<a href="/">` rather than a button, so cmd-click and middle-click open a second Overview
// and "copy link address" gives a URL. A plain left click is handled here instead, as a client-side
// navigation through the shell's own router (#784) — the same `go` every other selection uses.
export function BrandLink({ working, href = '/', onNavigate }: { working: boolean; href?: string; onNavigate: () => void }) {
  return (
    <a
      href={href}
      onClick={event => {
        // A modified click is the browser's to handle: a new tab, a new window, a download.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
        event.preventDefault()
        onNavigate()
      }}
      className="flex shrink-0 items-center gap-3 rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
    >
      <Logo className="h-6 w-auto shrink-0" working={working} />
      {/* Below sm the wordmark folds away so the nav fits a narrow viewport (#980); the mark stays,
          and it is still the link home (#909). Said with a screen-size class alone, never a bare
          `hidden` undone at a width: a tool page's stylesheet is loaded after the page's and has
          its own `.hidden`, which then won and hid the word at every width. */}
      <span className="shrink-0 font-semibold max-sm:hidden">OpenAgent</span>
    </a>
  )
}
