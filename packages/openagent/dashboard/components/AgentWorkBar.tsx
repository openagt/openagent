import { useState, type ReactNode } from 'react'
import type { AgentWorktree } from '../../src/index.js'
import { X } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'

// The bar right above the message box, as Claude Code on the web has one: where the agent's work
// is (the project, the branch), what the branch holds (+N −N), its pull request, and, at the end,
// the next step as a button and an ✕ that puts the bar away. It is there while there is something
// to say: the agent has changes, a pull request or a next step. An agent that changed nothing has
// no bar.
//
// It is a filled grey strip sitting on the message box, not a bordered one floating above it:
// Claude Code's is white at 5% with a 10px corner and no border, and bar and box read as one block
// of controls under the conversation rather than as two boxes.
export function AgentWorkBar({
  projectName,
  checkout,
  summary,
  actions,
  show,
  state,
}: {
  projectName?: string | null | undefined
  /** The agent's checkout as the page read it: its branch and its pull request. */
  checkout: AgentWorktree | null
  /** What the branch holds, in a phrase. */
  summary?: ReactNode
  /** The next step (Commit, Open PR, Merge), or the words that stand where it would be. */
  actions?: ReactNode
  /** Whether there is something to say: changes, a pull request or a next step. Nothing to say, no bar. */
  show: boolean
  /**
   * What the bar is about, as one string: the ✕ hides the bar for this state only, so it comes
   * back on its own once the work moves on (another commit, a pull request opened, a merge).
   * Absent, the ✕ hides it for as long as the branch and its pull request stay as they are.
   */
  state?: string | undefined
}) {
  const branch = checkout?.branch
  const signature = state ?? `${branch ?? ''}|${checkout?.pr?.number ?? ''}|${checkout?.pr?.state ?? ''}`
  const [hiddenAt, setHiddenAt] = useState<string | null>(null)
  if (branch === undefined || !show || hiddenAt === signature) return null
  return (
    <div className="mx-auto w-full max-w-3xl px-2 pt-2">
      {/* One line; on a phone it is as many as its parts need, the next step on a line of its own. */}
      <div role="group" aria-label="This agent's work" className="flex items-center overflow-hidden rounded-[10px] bg-muted px-2 text-[13px] md:h-10 md:gap-2 max-md:min-h-10 max-md:flex-wrap max-md:gap-x-2 max-md:gap-y-1 max-md:py-1.5">
        {projectName && (
          <span className="max-w-32 shrink-0 truncate text-muted-foreground" title={projectName}>
            {projectName}
          </span>
        )}
        {/* The branch is the one part that gives up width: it truncates and still reads. No icon
            beside it: the name says what it is, and the row is shorter without one. */}
        <span className="flex min-w-0 items-center text-muted-foreground">
          <Tooltip>
            <TooltipTrigger render={<span className="truncate font-mono" />}>{branch}</TooltipTrigger>
            <TooltipContent className="whitespace-pre-line">{[branch, checkout?.checkout?.path].filter(Boolean).join('\n')}</TooltipContent>
          </Tooltip>
        </span>
        {/* Everything after this sits at the end, in Claude Code's order: what the branch holds,
            its pull request, the next step, the ✕. */}
        <div className="grow" />
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
        <div className="flex items-center gap-2 md:shrink-0 max-md:min-w-0 max-md:flex-wrap">{actions}</div>
        {/* Put away by hand, as Claude Code's is. Nothing is undone by it: the work is where it
            was, and the bar says so again as soon as the work moves on. */}
        <button
          type="button"
          aria-label="Hide this bar"
          title="Hide this bar"
          onClick={() => setHiddenAt(signature)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
