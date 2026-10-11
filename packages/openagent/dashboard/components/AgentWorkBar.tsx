import type { ReactNode } from 'react'
import type { AgentWorktree } from '../../src/index.js'
import { GitBranch } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'

// The bar right above the message box, as Claude Code on the web has one: where the agent's work
// is (the project, the branch), what the branch holds (commits, files, +N −N), its pull request,
// and, at the end, the next step as a button. It is there while there is something to say: the
// agent has changes, a pull request or a next step. An agent that changed nothing has no bar.
export function AgentWorkBar({
  projectName,
  checkout,
  summary,
  actions,
  show,
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
}) {
  const branch = checkout?.branch
  if (branch === undefined || !show) return null
  return (
    <div className="mx-auto w-full max-w-3xl px-2 pt-2">
      {/* One line; on a phone it is as many as its parts need, the next step on a line of its own. */}
      <div role="group" aria-label="This agent's work" className="flex items-center overflow-hidden rounded-lg border border-border px-3 text-xs md:h-9 md:gap-2 max-md:min-h-9 max-md:flex-wrap max-md:gap-x-2 max-md:gap-y-1 max-md:py-1.5">
        {projectName && (
          <span className="max-w-32 shrink-0 truncate text-muted-foreground" title={projectName}>
            {projectName}
          </span>
        )}
        {/* The branch is the one part that gives up width: it truncates and still reads. */}
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <GitBranch className="h-3.5 w-3.5 shrink-0" />
          <Tooltip>
            <TooltipTrigger render={<span className="truncate" />}>{branch}</TooltipTrigger>
            <TooltipContent className="whitespace-pre-line">{[branch, checkout?.checkout?.path].filter(Boolean).join('\n')}</TooltipContent>
          </Tooltip>
        </span>
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
        <div className="grow" />
        <div className="flex items-center gap-2 md:shrink-0 max-md:min-w-0 max-md:flex-wrap">{actions}</div>
      </div>
    </div>
  )
}
