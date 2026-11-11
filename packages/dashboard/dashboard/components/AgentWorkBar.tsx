import type { ReactNode } from 'react'
import type { AgentWorktree } from '../../src/index.js'
import { X } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'

// The bar above the message box and its row, as Claude Code on the web has one: the agent's branch,
// what it holds (+N −N), its pull request, and, at the end, the next step as a button and an ✕ that
// puts the bar away. The row under it says the project. A step that failed says why on a line of its
// own. It is there while there is something to say: the agent has changes, a pull request or a next
// step. An agent that changed nothing has no bar.
//
// It is a filled grey strip, not a bordered one floating above the box: Claude Code's is white at 5%
// with a 10px corner and no border, and bar and box read as one block of controls under the
// conversation rather than as two boxes.
export function AgentWorkBar({
  checkout,
  summary,
  actions,
  error,
  show,
  away,
  onHide,
}: {
  /** The agent's checkout as the page read it: its branch and its pull request. */
  checkout: AgentWorktree | null
  /** What the branch holds, in a phrase. */
  summary?: ReactNode
  /** The next step (Commit, Open PR, Merge), or the words that stand where it would be. */
  actions?: ReactNode
  /** Why the next step just failed. */
  error?: string | null | undefined
  /** Whether there is something to say: changes, a pull request or a next step. Nothing to say, no bar. */
  show: boolean
  /** Put away by its ✕ at what it is about now (`useWorkBarAway`): it comes back on its own once the work moves on. */
  away: boolean
  /** The ✕. */
  onHide: () => void
}) {
  const branch = checkout?.branch
  if (branch === undefined || !show || away) return null
  return (
    <div className="mx-auto w-full max-w-3xl px-2 pt-2">
      {/* One line; in a narrow chat (a phone, a chat beside panes) it is as many as its parts need,
          the next step at the end of a line of its own. In the dark theme the hover fill is the bar's own colour, so its buttons get Everforest's
          next step up (both names: `bg-accent` reads the first, the Button's variants the second). */}
      <div role="group" aria-label="This session's work" className="overflow-hidden rounded-[10px] bg-muted px-2 dark:[--accent:#374145] dark:[--color-accent:#374145] text-[13px]">
        <div className="flex items-center @lg:h-10 @lg:gap-2 @max-lg:min-h-10 @max-lg:flex-wrap @max-lg:gap-x-2 @max-lg:gap-y-1 @max-lg:py-1.5">
          {/* The branch is the one part that gives up width: it truncates and still reads. No icon
              beside it: the name says what it is, and the row is shorter without one. */}
          <span className="flex min-w-0 items-center text-muted-foreground">
            <Tooltip>
              <TooltipTrigger render={<span className="truncate" />}>{branch}</TooltipTrigger>
              <TooltipContent className="whitespace-pre-line">{[branch, checkout?.checkout?.path].filter(Boolean).join('\n')}</TooltipContent>
            </Tooltip>
          </span>
          {/* Everything after this sits at the end, in Claude Code's order: what the branch holds,
              its pull request, the next step, the ✕. The first three wrap as one, so a narrow bar
              moves them down together. */}
          <div className="grow" />
          <div className="flex items-center gap-2 @lg:shrink-0 @max-lg:ml-auto @max-lg:min-w-0 @max-lg:flex-wrap">
            <span className="shrink-0">{summary}</span>
            {checkout?.pr && (
              <Tooltip>
                <TooltipTrigger render={<a href={checkout.pr.url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1.5 text-primary hover:underline" />}>
                  <span>PR #{checkout.pr.number}</span>
                  <span className="rounded-full border border-border px-1.5 text-[10px] uppercase text-muted-foreground">{checkout.pr.state.toLowerCase()}</span>
                </TooltipTrigger>
                <TooltipContent>{checkout.pr.title}</TooltipContent>
              </Tooltip>
            )}
            {actions}
          </div>
          {/* Put away by hand, as Claude Code's is. Nothing is undone by it: the work is where it
              was, and the bar says so again as soon as the work moves on. */}
          <button
            type="button"
            aria-label="Hide this bar"
            title="Hide this bar"
            onClick={onHide}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {error && (
          <p role="alert" className="pb-2 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
