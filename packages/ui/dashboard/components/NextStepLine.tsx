import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import type { UiWorkProps } from '../module/index.js'
import { askActivity } from '../lib/panes.js'
import { cn } from '../lib/utils.js'
import { ViewsAt } from './Places.js'
import { WorkRowPlace } from './WorkRow.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'

// The line above a session's message box: the first of its repos with a step waiting, as its row in
// the Activity panel says it (the modules' `chat.work` rows), with that step's press, and "N more"
// when other repos wait too, which opens the Activity panel. Nothing waiting, no line. Its ✕ hides
// it until another step waits (a commit made, a pull request to open next), and this browser keeps
// that for the session, so it stays hidden on coming back to it. The steps stay in the Activity
// panel.

/** localStorage key prefix: the step a person hid the line on, for each session. */
const HIDDEN_KEY = 'oa.next-step-hidden:'

function hiddenOn(session: string): string | null {
  try {
    return globalThis.localStorage?.getItem(HIDDEN_KEY + session) ?? null
  } catch {
    return null
  }
}

function hideOn(session: string, step: string): void {
  try {
    globalThis.localStorage?.setItem(HIDDEN_KEY + session, step)
  } catch {
    // Hidden for this page's life only.
  }
}

/** The rows of the line with a step waiting: a row whose next step is offered (`HandoffOffers`' press). */
const waiting = (line: HTMLElement) => [...line.querySelectorAll<HTMLElement>('[data-work-row]')].filter(row => row.querySelector('[data-next-step]') !== null)

export function NextStepLine({ work }: { work: UiWorkProps }) {
  const session = `${work.projectId}/${work.agentId}`
  const rows = useRef<HTMLDivElement>(null)
  // What the rows hold now: how many wait, and which step the first is, by its repo and its press's words.
  const [now, setNow] = useState<{ count: number; step: string }>({ count: 0, step: '' })
  const [hidden, setHidden] = useState(() => hiddenOn(session))
  const [hiddenFor, setHiddenFor] = useState(session)
  if (hiddenFor !== session) {
    setHiddenFor(session)
    setHidden(hiddenOn(session))
  }
  const read = useCallback(() => {
    const line = rows.current
    if (!line) return
    const all = [...line.querySelectorAll<HTMLElement>('[data-work-row]')]
    const ready = waiting(line)
    const first = ready[0]
    // The line shows the first row with a step waiting, and no other.
    for (const row of all) row.hidden = row !== first
    const step = first ? `${first.getAttribute('aria-label') ?? ''}\n${first.querySelector('[data-next-step]')?.textContent ?? ''}` : ''
    setNow(was => (was.count === ready.length && was.step === step ? was : { count: ready.length, step }))
  }, [])
  useLayoutEffect(() => {
    read()
    if (typeof MutationObserver === 'undefined' || !rows.current) return
    const observer = new MutationObserver(read)
    observer.observe(rows.current, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-next-step'] })
    return () => observer.disconnect()
  }, [read])
  const shown = now.count > 0 && hidden !== now.step
  const more = now.count - 1
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-2" hidden={!shown}>
      <div role="group" aria-label="Next step" className="flex min-h-10 items-center gap-1 rounded-lg border border-border bg-card py-1 pr-1 pl-3 shadow-xs">
        <div ref={rows} className="min-w-0 flex-1">
          <WorkRowPlace.Provider value="line">
            <ViewsAt place="chat.work" projectId={work.projectId} props={work} label="session's work" />
          </WorkRowPlace.Provider>
        </div>
        {more > 0 && (
          <button type="button" className="flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-xs whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground" onClick={askActivity}>
            {`${more} more`}
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Hide until the next step"
                className={cn('grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground')}
                onClick={() => {
                  hideOn(session, now.step)
                  setHidden(now.step)
                }}
              />
            }
          >
            <X className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>Hide until the next step</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
