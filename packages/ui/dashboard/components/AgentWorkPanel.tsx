import type { ReactNode } from 'react'
import type { AgentWorktree } from '../../src/index.js'
import { Folder, FolderGit2, GitBranch } from 'lucide-react'
import { useLoaded } from '../lib/use-async.js'
import { handoffSays, useAgentHandoff } from '../lib/use-agent-handoff.js'
import { onAgentCopies } from '../rpc/reads.js'
import { Committing, HandoffActions, HandoffSummary } from './AgentHandoff.js'
import { MiddleCut } from './MiddleCut.js'
import { Panel, PanelRow } from './ui/panel.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'

// The session's work, above the message box: one panel, a row per repo that has work (his pick,
// over a bar per repo and over the project's bar with a label per copy). The project's row is
// first; each copy of a repo the session has (Context) has the same row after it, so a copied
// repo's work is read and taken further exactly as the project's is. A row is the repo's name,
// under it its branch, what the branch holds (+N −N) and its pull request, and at its end the next
// step as a press (Commit, Open PR, Merge). A repo with nothing to say has no row, and a session
// with no row has no panel. On a phone the press stays at the row's end, as wide as its word.
//
// Before, this was one bar for the project alone, with an ✕ that put it away: a session with
// copies had no place for their work, and one panel that lists every repo is not put away.

/** The panel; nothing while it has no row. */
export function AgentWorkPanel({ children }: { children: ReactNode }) {
  return (
    // Focusable by script only: a press that leaves nothing to press next leaves the focus here.
    <div role="group" aria-label="This session's work" tabIndex={-1} className="mx-auto w-full max-w-3xl px-4 pt-2 outline-none has-[>ul:empty]:hidden">
      <Panel className="empty:hidden">{children}</Panel>
    </div>
  )
}

/** One repo's row: the project's, or a copy's. */
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
  /** The session's own project, which a folder marks; a copy has a repo's mark. */
  project?: boolean
  branch: string
  /** Where the work is on this computer, said with the branch's whole name in its hover. */
  path?: string | undefined
  /** What the branch holds, in a phrase. */
  summary?: ReactNode
  pr?: { number: number; url: string; state: string; title: string } | undefined
  /** The next step (Commit, Open PR, Merge), or the words that stand where it would be. */
  actions?: ReactNode
  /** Why the next step just failed. */
  error?: string | null | undefined
}) {
  const Mark = project ? Folder : FolderGit2
  return (
    <PanelRow
      aria-label={`${name}: its work`}
      state={<Mark className="size-4 text-muted-foreground" aria-hidden />}
      title={name}
      meta={[
        // The branch, the one part that gives up width, cut in its middle so the end that tells it apart stays.
        <Tooltip key="branch">
          <TooltipTrigger render={<span className="flex min-w-0 max-w-64 items-center gap-1 max-md:max-w-24" />}>
            <GitBranch className="size-3 shrink-0" aria-hidden />
            <MiddleCut text={branch} />
          </TooltipTrigger>
          <TooltipContent className="whitespace-pre-line">{[branch, path].filter(Boolean).join('\n')}</TooltipContent>
        </Tooltip>,
        summary,
        pr && (
          <Tooltip key="pr">
            <TooltipTrigger render={<a href={pr.url} target="_blank" rel="noreferrer" className="relative flex shrink-0 items-center gap-1.5 text-primary hover:underline" />}>
              <span>PR #{pr.number}</span>
              <span className="rounded-full border border-border px-1.5 uppercase text-muted-foreground">{pr.state.toLowerCase()}</span>
            </TooltipTrigger>
            <TooltipContent>{pr.title}</TooltipContent>
          </Tooltip>
        ),
      ]}
      under={
        error ? (
          <span role="alert" className="block whitespace-pre-line text-danger">
            {error}
          </span>
        ) : undefined
      }
      actions={actions ? <span className="flex shrink-0 items-center gap-2 empty:hidden">{actions}</span> : undefined}
      actionsAtRest
    />
  )
}

/**
 * The project's row: the run's checkout as the page read it, its branch and its pull request. It is
 * there while there is something to say (`show`): the agent has changes, a pull request or a next
 * step. An agent that changed nothing has no row.
 */
export function ProjectWorkRow({ name, checkout, summary, actions, error, show }: {
  /** The project's name; "This project" until the projects are read. */
  name?: string | null | undefined
  checkout: AgentWorktree | null
  summary?: ReactNode
  actions?: ReactNode
  error?: string | null | undefined
  show: boolean
}) {
  const branch = checkout?.branch
  if (branch === undefined || !show) return null
  return <WorkRow project name={name || 'This project'} branch={branch} path={checkout?.checkout?.path} summary={summary} pr={checkout?.pr} actions={actions} error={error} />
}

/** The names of the session's copies of repos, read again when the run stops or goes on: a copy is made as it starts. */
export function useAgentCopies(projectId: string, agentId: string, live: boolean | null): string[] {
  // A daemon that does not know the question answers nothing: no copies.
  const names = useLoaded<string[] | null>(() => onAgentCopies(projectId, agentId), [], [projectId, agentId, live], { remember: `copies:${projectId}:${agentId}` })
  return names ?? []
}

/**
 * A copy's row: its own read of its branch, taken as the project's is, once the run has stopped
 * (a branch still being written to has nothing to hand off). Nothing while the copy holds no work.
 */
export function CopyWorkRow({ projectId, agentId, repo, ended, saving, working, committing, onAsked }: {
  projectId: string
  agentId: string
  /** The copy's name in the session's folder. */
  repo: string
  /** The run has ended: its work is read, and its next step offered. */
  ended: boolean
  saving: boolean
  working: boolean
  /** The agent is doing what a Commit press asked. */
  committing: boolean
  onAsked?: ((text: string | null) => void) | undefined
}) {
  const state = useAgentHandoff(projectId, agentId, ended, saving, working, repo)
  const handoff = state.handoff
  if (!ended || !handoff || handoff.prPending || !(handoff.pr !== undefined || handoffSays(handoff))) return null
  return (
    <WorkRow
      name={repo}
      branch={handoff.branch}
      summary={<HandoffSummary handoff={handoff} />}
      pr={handoff.pr}
      actions={committing ? <Committing /> : <HandoffActions key={`${projectId}/${agentId}/${repo}`} projectId={projectId} agentId={agentId} repo={repo} state={state} onAsked={onAsked} />}
      error={state.error}
    />
  )
}
