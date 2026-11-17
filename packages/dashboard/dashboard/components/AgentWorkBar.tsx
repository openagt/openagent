import type { ReactNode } from 'react'
import type { AgentWorktree } from '../../src/index.js'
import { X } from 'lucide-react'
import { Button } from './ui/button.js'
import { MiddleCut } from './MiddleCut.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'

// The bar above the message box, as Claude Code on the web has one: the run's branch, what it
// holds (+N −N), its pull request, and, at the end, the next step as a button and an ✕ that puts
// the bar away. The row under the box says the project. A step that failed says why on a line of
// its own. It is there while there is something to say: the agent has changes, a pull request or a
// next step. An agent that changed nothing has no bar.
//
// A quiet rounded strip of its own over the box, at the box's x and width, its presses quiet: the
// branch leads, since a commit's subject (a merge's "Merge branch …") tells less than the branch
// does. On a phone its words take the first line and its presses the line under it, 44 high,
// sharing the width.
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
    <div className="mx-auto w-full max-w-3xl px-4 pt-2">
      {/* Focusable by script only: a press that leaves nothing to press next leaves the focus here. */}
      <div role="group" aria-label="This session's work" tabIndex={-1} className="flex min-h-10 flex-wrap items-center gap-x-2 rounded-[10px] bg-muted py-1 pr-1 pl-3 text-sm outline-none max-md:gap-y-2 max-md:pt-3 max-md:pb-2 max-md:pl-2 dark:[--accent:#374145] dark:[--color-accent:#374145]">
        {/* The words: the branch, the one part that gives up width, cut in its middle so the end that
            tells it apart stays, its whole name in its tooltip; then what the branch holds and its pull
            request, whole. In the dark theme the hover fill is the bar's own colour, so its buttons get
            Everforest's next step up (both names: `bg-accent` reads the first, the Button's variants the second). */}
        <div className="flex min-w-0 flex-1 items-center gap-2 max-md:basis-full max-md:px-2">
          <span className="flex min-w-0 flex-1 items-center">
            <Tooltip>
              <TooltipTrigger render={<span className="flex min-w-0 flex-1 text-muted-foreground" />}>
                <MiddleCut text={branch} />
              </TooltipTrigger>
              <TooltipContent className="whitespace-pre-line">{[branch, checkout?.checkout?.path].filter(Boolean).join('\n')}</TooltipContent>
            </Tooltip>
          </span>
          <span className="shrink-0 tabular-nums">{summary}</span>
          {checkout?.pr && (
            <Tooltip>
              <TooltipTrigger render={<a href={checkout.pr.url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1.5 text-primary hover:underline" />}>
                <span>PR #{checkout.pr.number}</span>
                <span className="rounded-full border border-border px-1.5 text-xs uppercase text-muted-foreground">{checkout.pr.state.toLowerCase()}</span>
              </TooltipTrigger>
              <TooltipContent>{checkout.pr.title}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {/* The presses: the next step, then the ✕. On a phone a line of their own, 8 in, 44 high, the
            next step's buttons sharing the width; the ✕'s glyph ends 16 in, as an unpainted press's does. */}
        <div className="flex shrink-0 items-center gap-2 max-md:basis-full">
          <div className="flex shrink-0 items-center gap-2 empty:hidden max-md:flex-1 max-md:[&>button]:h-11 max-md:[&>button]:flex-1">{actions}</div>
          {/* Put away by hand, as Claude Code's is. Nothing is undone by it: the work is where it
              was, and the bar says so again as soon as the work moves on. */}
          <Button variant="ghost" size="icon-sm" aria-label="Hide this bar" title="Hide this bar" onClick={onHide} className="ml-auto shrink-0 text-muted-foreground max-md:h-11">
            <X className="size-3.5" />
          </Button>
        </div>
        {error && (
          <p role="alert" className="basis-full whitespace-pre-line pb-1 text-xs text-danger max-md:px-2">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
