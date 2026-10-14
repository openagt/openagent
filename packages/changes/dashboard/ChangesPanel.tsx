import { useEffect, useRef, useState } from 'react'
import { cn, formatRelative, useModuleHost, usePolled, type ModulePanelProps } from '@openagt/dashboard/module'
import type { AgentChanges, AgentCommit, FileMark } from '../src/run.js'
import { commitKey, commitsKey, projectKey, runKey } from './keys.js'
import { readCommit, readCommits, readProject, readRun } from './reads.js'
import { DiffCard } from './DiffCard.js'

// The Changes pane, as Claude Code on the web draws it: the files that changed in a
// list on the left, and on the right the diff of the one picked, the first file picked by itself.
// On a run's page, what that run changed, read wherever its work is now (the `run` read), and kept
// once its work is merged: this list says what the run did and stays. On the project's own page,
// the files changed in the project's folder and not committed (the `project` read).
//
// Under the list, a run's commits, newest first, with "All changes" above them. A click on a commit
// shows only that commit: its files in the list, its own diff on the right, and its name where the
// caption was. "All changes" goes back to everything the run changed.

const LABEL: Record<FileMark['status'], string> = {
  untracked: 'new',
  added: 'new',
  modified: 'modified',
  deleted: 'deleted',
}

const TONE: Record<FileMark['status'], string> = {
  untracked: 'text-success',
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger',
}

function ChangeRow({ path, mark, picked, onPick }: { path: string; mark: FileMark; picked: boolean; onPick: () => void }) {
  const dir = path.slice(0, path.lastIndexOf('/') + 1)
  const name = path.slice(path.lastIndexOf('/') + 1)
  return (
    <li>
      <button type="button" onClick={onPick} aria-pressed={picked} title={path} className={cn('flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent', picked && 'bg-accent')}>
        <span className="w-full truncate font-mono text-xs">
          <span className="text-muted-foreground">{dir}</span>
          <span className={cn(mark.status === 'deleted' && 'line-through')}>{name}</span>
        </span>
        <span className="text-[10px] text-muted-foreground">
          <span className={cn('uppercase tracking-wide', TONE[mark.status])}>{LABEL[mark.status]}</span>
          {!mark.committed && ' · not committed'}
        </span>
      </button>
    </li>
  )
}

/** A row of the commits list: "All changes", or one commit. */
function CommitRow({ label, detail, title, picked, onPick }: { label: string; detail?: string; title?: string; picked: boolean; onPick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onPick} aria-pressed={picked} title={title} className={cn('flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent', picked && 'bg-accent')}>
        <span className="w-full truncate text-xs">{label}</span>
        {detail !== undefined && <span className="w-full truncate text-[10px] text-muted-foreground">{detail}</span>}
      </button>
    </li>
  )
}

const NO_COMMITS: AgentCommit[] = []

const NO_CHANGES: Record<string, FileMark> = {}

function Line({ children }: { children: string }) {
  return <p className="p-3 text-xs text-muted-foreground">{children}</p>
}

/** The last ask from the chat that was taken: a pane opened again later does not take it a second time. */
let revealTaken = 0

export function ChangesPanel({ projectId, agentId, activity, reveal }: ModulePanelProps) {
  const host = useModuleHost()
  const { value: projectChanges, loaded: projectLoaded } = usePolled<Record<string, FileMark>>(agentId ? null : () => readProject(host, projectId), NO_CHANGES, 8_000, [projectId, agentId], { remember: projectKey(projectId) })
  const { value: answer, loaded: runLoaded, reload } = usePolled<AgentChanges | null>(agentId ? () => readRun(host, projectId, agentId) : null, null, 8_000, [projectId, agentId], agentId ? { remember: runKey(projectId, agentId) } : undefined)
  // A run whose files move as it ends answers pending for a moment: the list it last showed stays.
  const lastRun = useRef<{ agentId: string; changes: AgentChanges } | null>(null)
  if (agentId && answer && 'changes' in answer) lastRun.current = { agentId, changes: answer }
  const last = lastRun.current
  const run = answer?.source === 'pending' && last !== null && last.agentId === agentId ? last.changes : answer
  const { value: commitsRead, loaded: commitsLoaded, reload: reloadCommits } = usePolled<AgentCommit[]>(agentId ? () => readCommits(host, projectId, agentId) : null, NO_COMMITS, 8_000, [projectId, agentId], agentId ? { remember: commitsKey(projectId, agentId) } : undefined)
  // As with the list of files: while the run's files move as it ends, the commits last read stay.
  const lastCommits = useRef<{ agentId: string; commits: AgentCommit[] } | null>(null)
  if (agentId && commitsLoaded && answer?.source !== 'pending') lastCommits.current = { agentId, commits: commitsRead }
  const heldCommits = lastCommits.current
  const commits = answer?.source === 'pending' && heldCommits !== null && heldCommits.agentId === agentId ? heldCommits.commits : commitsRead
  // The commit picked on this page, while it is still one of the run's; none picked is "All changes".
  const [commitClick, setCommitClick] = useState<{ agentId: string; sha: string } | null>(null)
  const commit = commitClick !== null && commitClick.agentId === agentId ? commits.find(c => c.sha === commitClick.sha) : undefined
  const sha = commit?.sha
  const { value: commitChanges, loaded: commitLoaded } = usePolled<Record<string, FileMark> | null>(agentId && sha ? () => readCommit(host, projectId, agentId, sha) : null, null, 60_000, [projectId, agentId, sha], agentId && sha ? { remember: commitKey(projectId, agentId, sha) } : undefined)
  // The agent did something: read again now rather than on the next poll, once per burst.
  useEffect(() => {
    if (activity === undefined) return
    const timer = setTimeout(() => {
      reload()
      reloadCommits()
    }, 300)
    return () => clearTimeout(timer)
  }, [activity, reload, reloadCommits])

  // The file whose diff shows: the one clicked in this list, or the first of the list while none
  // is, or once the one clicked is no longer in the list. A click counts for the list it was made
  // in: another run's list, and another commit's, starts at its own first file.
  const [click, setClick] = useState<{ agentId: string | undefined; sha: string | undefined; path: string } | null>(null)
  const clicked = click !== null && click.agentId === agentId && click.sha === sha ? click.path : null
  // A changed file asked for from the chat is picked as a click on it in "All changes" is: once
  // for each ask, so a click made in the list after it stands.
  const revealedAt = reveal?.at
  const revealedPath = reveal?.path
  useEffect(() => {
    if (revealedAt === undefined || revealedPath === undefined || revealedAt <= revealTaken) return
    revealTaken = revealedAt
    setCommitClick(null)
    setClick({ agentId, sha: undefined, path: revealedPath })
  }, [revealedAt, revealedPath, agentId])

  if (agentId) {
    if (!runLoaded || !commitsLoaded || !run || run.source === 'pending') return <Line>Looking for this run’s changes…</Line>
    if (run.source === 'gone') return <Line>This run’s changes are gone from this machine: its checkout was reclaimed and it left no branch or merged pull request here.</Line>
  } else if (!projectLoaded) return <Line>Reading the project’s files…</Line>

  const all = agentId ? (run && 'changes' in run ? run.changes : NO_CHANGES) : projectChanges
  if (Object.keys(all).length === 0 && commits.length === 0) return <Line>{agentId ? 'This run changed no files.' : 'Nothing is changed in the project’s folder.'}</Line>
  const changes = commit ? (commitChanges ?? {}) : all
  const paths = Object.keys(changes).sort()
  const merged = agentId !== undefined && run !== null && 'merged' in run && run.merged
  const caption = commit ? `${commit.short} ${commit.subject}` : agentId ? (merged ? 'What this run changed. Merged.' : 'What this run changed. Not merged yet.') : 'Changed in the project’s folder, not committed.'
  // A file asked for from the chat may be named by its whole path on disk, when the run's card no
  // longer says where its checkout was: the listed file that path ends with is the one meant.
  const meant = clicked === null || paths.includes(clicked) ? clicked : (paths.filter(path => clicked.endsWith(`/${path}`)).sort((a, b) => b.length - a.length)[0] ?? null)
  const picked = meant !== null && paths.includes(meant) ? meant : paths[0]
  // What stands where the list and the diff would be, when the list is empty.
  const nothing = commit ? (commitLoaded ? 'This commit changed no files.' : 'Reading the commit…') : 'No change is left: the commits cancel out.'
  return (
    <div className="flex min-h-0 flex-auto flex-col">
      <p className="truncate px-3 pb-1 text-[10px] text-muted-foreground" title={caption}>
        {caption}
      </p>
      <div className="flex min-h-0 flex-auto border-t border-border">
        <div className="flex w-1/3 max-w-56 min-w-32 shrink-0 flex-col border-r border-border">
          <ul aria-label="Changed files" className="min-h-0 flex-auto space-y-0.5 overflow-y-auto p-1">
            {paths.map(path => (
              <ChangeRow key={path} path={path} mark={changes[path]!} picked={path === picked} onPick={() => setClick({ agentId, sha, path })} />
            ))}
          </ul>
          {agentId && commits.length > 0 && (
            <section aria-label="Commits" className="flex max-h-[45%] shrink-0 flex-col border-t border-border">
              <h3 className="flex justify-between px-3 pt-2 pb-1 text-[10px] text-muted-foreground">
                <span>Commits</span>
                <span>{commits.length}</span>
              </h3>
              <ul className="min-h-0 space-y-0.5 overflow-y-auto p-1">
                <CommitRow label="All changes" picked={commit === undefined} onPick={() => setCommitClick(null)} />
                {commits.map(c => (
                  <CommitRow key={c.sha} label={c.subject} detail={`${c.short} · ${c.author} · ${formatRelative(c.date)}`} title={c.subject} picked={c.sha === sha} onPick={() => setCommitClick({ agentId, sha: c.sha })} />
                ))}
              </ul>
            </section>
          )}
        </div>
        {/* Keyed by the file and the commit: a diff still being read is never shown under another's name. */}
        <div className="flex min-w-0 flex-auto flex-col overflow-auto">
          {picked !== undefined ? <DiffCard key={`${sha ?? ''}:${picked}`} projectId={projectId} agentId={agentId} path={picked} commit={sha} /> : <Line>{nothing}</Line>}
        </div>
      </div>
    </div>
  )
}
