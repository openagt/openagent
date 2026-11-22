import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { CopyButton } from '@openagt/ui/module'

// A mermaid block as its diagram (#2394: `ui-renderer-mermaid`). The library is heavy, so it is
// loaded the first time a diagram is drawn, never with the page. It draws with its strict security:
// what a diagram's text says is never markup or script of the page's.
//
// A block is its text, as code is, until its diagram is drawn: while it is being written (drawn
// once its text has stood still a moment, so a diagram does not flicker in and out line by line),
// and for good where the text is no diagram the library can draw, since a diagram that is not one
// would only be an error.

type Mermaid = typeof import('mermaid').default

let loading: Promise<Mermaid> | undefined

/** The library, loaded once, for every diagram of the page. */
function library(): Promise<Mermaid> {
  loading ??= import('mermaid').then(module => module.default)
  return loading
}

/** Whether the page is drawn dark: the `dark` class on its root, followed as it changes. */
function useDark(): boolean {
  return useSyncExternalStore(
    onChange => {
      const watch = new MutationObserver(onChange)
      watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
      return () => watch.disconnect()
    },
    () => document.documentElement.classList.contains('dark'),
    () => false,
  )
}

/** One drawing at a time: the library keeps one configuration for the page, which each drawing sets. */
let drawing: Promise<unknown> = Promise.resolve()

/** The diagram `content` says, as an SVG, in the page's light or dark; throws why it cannot be drawn. */
async function draw(content: string, id: string, dark: boolean): Promise<string> {
  const mermaid = await library()
  const drawn = drawing.then(async () => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' })
    return (await mermaid.render(id, content)).svg
  })
  drawing = drawn.catch(() => undefined)
  return drawn
}

/** How long a block's text stands still before its diagram is drawn. */
export const DRAW_AFTER_MS = 300

// The diagrams drawn in this tab, by their text and the page's light or dark, kept over a reload
// too: a block shown again, as on a switch back to its session or after the page is loaded again,
// is its diagram at once. Drawn anew each time, it was its text for the wait and the drawing, then
// changed size into its diagram.
const KEPT = 20
const KEPT_KEY = 'oa.mermaid-diagrams.1'
const kept = new Map<string, string>(readKept())
const keyOf = (content: string, dark: boolean): string => `${dark ? 'dark' : 'light'}\n${content}`

function readKept(): [string, string][] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(KEPT_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((entry): entry is [string, string] => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') : []
  } catch {
    return []
  }
}

function keep(content: string, dark: boolean, svg: string): void {
  kept.set(keyOf(content, dark), svg)
  // The oldest goes first: a Map lists its entries in the order they were set.
  if (kept.size > KEPT) kept.delete(kept.keys().next().value!)
  try {
    sessionStorage.setItem(KEPT_KEY, JSON.stringify([...kept]))
  } catch {
    // A tab that keeps nothing, or has no room left, draws again after a reload.
  }
}

/** Forget every diagram drawn: a test starts from none. */
export function forgetDiagrams(): void {
  kept.clear()
  try {
    sessionStorage.removeItem(KEPT_KEY)
  } catch {
    // Nothing was kept there.
  }
}

/** The diagrams kept in the tab, read again as a page loaded anew reads them: for a test. */
export function readKeptDiagrams(): void {
  kept.clear()
  for (const [key, svg] of readKept()) kept.set(key, svg)
}

export function MermaidDiagram({ content }: { content: string }) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  const dark = useDark()
  // The diagram drawn last, and the text it was drawn for: another text shows as text until its own is drawn.
  const [drawn, setDrawn] = useState<{ content: string; svg: string } | undefined>()
  const again = kept.get(keyOf(content, dark))
  // The text a block is first shown with is drawn at once: it is mostly a finished answer's, and
  // waiting kept it as text a moment longer. Only a text that changes after is still being written.
  const shownBefore = useRef(false)
  useEffect(() => {
    const wait = shownBefore.current ? DRAW_AFTER_MS : 0
    shownBefore.current = true
    if (again !== undefined) return
    let live = true
    const timer = setTimeout(() => {
      draw(content, id, dark).then(
        svg => {
          keep(content, dark, svg)
          if (live) setDrawn({ content, svg })
        },
        () => live && setDrawn(undefined),
      )
    }, wait)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [content, id, dark, again])
  // The one kept for this text in this light, else the one drawn last for this text: the page
  // turning dark keeps the light diagram up until the dark one is drawn.
  const svg = again ?? (drawn?.content === content ? drawn.svg : undefined)
  if (svg !== undefined)
    return (
      <figure
        role="img"
        aria-label="Diagram"
        className="max-w-full overflow-x-auto rounded-md border border-hairline bg-card p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        // The library's own SVG, drawn with its strict security: the text's labels are text, never markup.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  return (
    <div className="group/code relative w-fit min-w-40 max-w-full rounded-md border border-hairline bg-card">
      <div className="absolute top-2 right-2 transition-opacity focus-within:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/code:opacity-100">
        <CopyButton text={content} label="Copy the code" />
      </div>
      <pre className="py-3 pr-12 pl-4 text-chat-code break-words whitespace-pre-wrap">
        <code>{content}</code>
      </pre>
    </div>
  )
}
