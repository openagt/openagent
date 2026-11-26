import { createContext, useContext, type ReactNode } from 'react'
import { FileDiff, GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react'
import type { PullRequestState } from '@openagt/hooks'
import { cn } from '../lib/utils.js'
import { prTone } from './EnvironmentRow.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'

// A repo's row in the Changes of a session's Activity panel, drawn by the module whose work it is
// (`chat.work`): the project's first, then one per copy of a repo the session holds work in, each
// read and taken further alike.

/**
 * Where the rows are drawn: the Activity panel's Changes, or the line above the message box, which
 * shows the first of them with a step waiting (NextStepLine). On the line the repo's name reads in
 * full and in the foreground, as the line's subject.
 */
export const WorkRowPlace = createContext<'activity' | 'line'>('activity')

/** What a row's count opens: the Changes tab of its repo (none for the project), in the side panel. */
export const OpenChanges = createContext<((repo?: string) => void) | undefined>(undefined)

/**
 * One repo's row, as Claude Code's Changes rows: a mark (a pull request's, in its state's colour,
 * else a change's), the repo's name in grey, its pull request's number, what its branch holds
 * (+N −N), and at its end the next step. Every row has this one shape, so their presses line up.
 * The branch and the folder are its name's hover; the request's title its number's.
 */
export function WorkRow({
  name,
  project = false,
  branch,
  path,
  summary,
  pr,
  actions,
  error,
}: {
  /** The repo's name: the project's, or the copy's in the session's folder. */
  name: string
  /** The session's own project. */
  project?: boolean
  branch: string
  /** Where the work is on this computer, said with the branch's whole name in its hover. */
  path?: string | undefined
  /** What the branch holds, in a phrase. */
  summary?: ReactNode
  pr?: { number: number; url: string; state?: string | undefined; title?: string | undefined } | undefined
  /** The next step (Commit, Open PR, Merge), or the words that stand where it would be. */
  actions?: ReactNode
  /** Why the next step just failed. */
  error?: string | null | undefined
}) {
  const state = pr?.state?.toLowerCase()
  const Mark = pr ? (state === 'merged' ? GitMerge : state === 'closed' ? GitPullRequestClosed : GitPullRequest) : FileDiff
  const onLine = useContext(WorkRowPlace) === 'line'
  const openChanges = useContext(OpenChanges)
  return (
    <div data-work-row role="group" aria-label={`${name}: its work`} className="flex flex-col">
      <div className={cn('flex min-h-8 items-center gap-3 rounded-md text-sm', onLine ? 'gap-2' : '-mx-1.5 px-1.5 hover:bg-accent')}>
        <Mark className={cn('size-4 shrink-0', pr ? prTone(state as PullRequestState | undefined) : 'text-muted-foreground')} aria-hidden />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Tooltip>
            <TooltipTrigger render={<span className={cn('min-w-0 truncate', onLine ? 'font-medium' : 'text-muted-foreground')} />}>{name}</TooltipTrigger>
            <TooltipContent className="whitespace-pre-line">{[project ? `${name} (the project)` : name, branch, path].filter(Boolean).join('\n')}</TooltipContent>
          </Tooltip>
          {pr && (
            <Tooltip>
              <TooltipTrigger render={<a href={pr.url} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground hover:underline" />}>{`#${pr.number}`}</TooltipTrigger>
              <TooltipContent>{[pr.title || `PR #${pr.number}`, state].filter(Boolean).join(' · ')}</TooltipContent>
            </Tooltip>
          )}
          {summary &&
            (openChanges ? (
              <button type="button" aria-label={`${name}: its changes`} className="flex min-w-0 shrink-0 items-center rounded-sm px-1 text-xs hover:bg-foreground/10" onClick={() => openChanges(project ? undefined : name)}>
                {summary}
              </button>
            ) : (
              <span className="flex min-w-0 shrink-0 items-center text-xs">{summary}</span>
            ))}
        </div>
        {actions && <span className="flex shrink-0 items-center gap-2 empty:hidden">{actions}</span>}
      </div>
      {error && (
        <span role="alert" className="block pb-1 pl-7 text-xs whitespace-pre-line text-danger">
          {error}
        </span>
      )}
    </div>
  )
}
