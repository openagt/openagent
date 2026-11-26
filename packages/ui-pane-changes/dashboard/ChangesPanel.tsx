import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BookMarked, Check, ChevronDown, ChevronRight, Folder, ListTree, MoreVertical, Search } from 'lucide-react'
import {
  Button,
  buttonVariants,
  DiffStat,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FileIcon,
  MiddleCut,
  PathCut,
  treeRow,
  Input,
  PaneActions,
  PaneNote,
  RowShapes,
  PaneTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slot,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  formatRelative,
  useModuleHost,
  useNarrow,
  usePolled,
  Waiting,
  type UiPaneProps,
  Facts,
} from '@openagt/ui/module'
import type { AgentCommit, FileMark } from '../src/run.js'
import type { RunChanges } from '../src/server.js'
import type { FileDiff } from '../src/diff.js'
import { commitKey, commitsKey, diffKey, projectKey, runKey } from './keys.js'
import { readCommit, readCommits, readDiff, readProject, readRepos, readRun } from './reads.js'
import { DiffShape, DiffView, isNewFile } from './DiffView.js'
import { CONTEXT_LINES, MAX_PREVIEW_LINES } from '../src/confined.js'
import { foldAll, foldDiff, setChangesSetting, showWhole, useChangesSettings, usePageDiffs, wholeKey } from './settings.js'

// The Changes pane, as Claude Code on the web draws it: in its header a button that hides the list,
// then search and a ⋮ menu, and under it the branch the changes are measured from and the run's own
// ("main → agent-…"); the files that changed in a list on the left, each with its lines added and removed,
// grouped by folder; and on the right every file's diff, one under another, each under its own
// header that folds it away. A click in the list scrolls to that file's diff. A pane too narrow for
// both hides the list: its button then shows the list in the diffs' place, until a file is picked.
//
// On a run's page, what that run changed, read wherever its work is now (the `run` read), and kept
// once its work is merged: this list says what the run did and stays. On the project's own page,
// the files changed in the project's folder and not committed (the `project` read).
//
// Under the list, a run's commits, newest first, with "All changes" above them. A click on a commit
// shows only that commit: its files in the list, its own diffs on the right, and its name over
// them. "All changes" goes back to everything the run changed.

const NO_COMMITS: AgentCommit[] = []
const NO_CHANGES: Record<string, FileMark> = {}
const NO_REPOS: string[] = []
/** The repo a read names, when it is a copy's: no argument at all for the run's own work. */
const repoArg = (repo: string | undefined): [] | [string] => (repo !== undefined ? [repo] : [])

/** The pane while its list is read: rows in a row's shape. */
/** Rows in their own shape while the pane is read; `className` sets them on the 16 inset of where they stand. */
const Reading = ({ className }: { className: string }) => <Waiting shape={<RowShapes rows={3} />} className={className} />

/** The last ask from the chat that was taken: a pane opened again later does not take it a second time. */
let revealTaken = 0

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** A changed file's lines added and removed, when git counted them: both, as Claude Code writes them, `+1 −0`. */
function Counts({ mark, className }: { mark: FileMark; className?: string }) {
  return mark.added !== undefined && mark.removed !== undefined ? <DiffStat added={mark.added} removed={mark.removed} zeros className={cn('shrink-0 text-xs', className)} /> : null
}

/** What git did to a file, as its letter: added, modified, deleted, in the colour of what it does to the lines. */
const STATUS_LETTER: Record<FileMark['status'], { letter: string; tone: string }> = {
  untracked: { letter: 'A', tone: 'text-success' },
  added: { letter: 'A', tone: 'text-success' },
  modified: { letter: 'M', tone: 'text-warning' },
  deleted: { letter: 'D', tone: 'text-danger' },
}

/** Narrower than this, the pane has room for the list or the diffs, not both. */
const NARROW = 520

/**
 * A changed file in the list: what git did to it in a letter, its name (or its path, ungrouped), its
 * counts, and a ring while it is only on disk, where the list holds both (`rings`).
 */
function ChangeRow({ path, mark, label, picked, rings, onPick }: { path: string; mark: FileMark; label: string; picked: boolean; rings: boolean; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-pressed={picked}
        title={`${path} · ${mark.status === 'untracked' || mark.status === 'added' ? 'new' : mark.status}${mark.committed ? '' : ', not committed'}`}
        className={cn(treeRow, picked && 'bg-accent')}
      >
        <span aria-hidden className={cn('w-4 shrink-0 font-mono text-xs font-semibold', STATUS_LETTER[mark.status].tone)}>
          {STATUS_LETTER[mark.status].letter}
        </span>
        <span className={cn('flex min-w-0 flex-1', mark.status === 'deleted' && 'line-through')}>
          <PathCut path={label} />
        </span>
        {rings && !mark.committed && <span aria-label="not committed" className="size-1.5 shrink-0 rounded-full border border-current text-muted-foreground" />}
        <Counts mark={mark} />
      </button>
    </li>
  )
}

type Folder = { name: string; path: string; dirs: Map<string, Folder>; files: string[] }

function foldersOf(paths: string[]): Folder {
  const root: Folder = { name: '', path: '', dirs: new Map(), files: [] }
  for (const path of paths) {
    let node = root
    const parts = path.split('/')
    for (const part of parts.slice(0, -1)) {
      const at = node.path ? `${node.path}/${part}` : part
      let next = node.dirs.get(part)
      if (!next) node.dirs.set(part, (next = { name: part, path: at, dirs: new Map(), files: [] }))
      node = next
    }
    node.files.push(path)
  }
  return root
}

/** A row of the commits list: "All changes", or one commit. */
function CommitRow({ label, detail, title, picked, onPick }: { label: string; detail?: ReactNode; title?: string; picked: boolean; onPick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onPick} aria-pressed={picked} title={title} className={cn('flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent active:bg-foreground/10 focus-ring-inset', picked && 'bg-accent')}>
        <span className="w-full truncate text-sm">{label}</span>
        {detail !== undefined && <span className="w-full truncate text-xs text-muted-foreground">{detail}</span>}
      </button>
    </li>
  )
}

interface DiffProps {
  projectId: string
  agentId: string | undefined
  /** The run's copy the diff is of; none for the run's own work. */
  repo: string | undefined
  path: string
  commit: string | undefined
  whole: boolean
  wrap: boolean
  /**
   * What the list last said of the file, the agent's last burst of activity, and "Refresh": a diff
   * is read again when one of them changes, not on a poll of its own, so a diff follows the
   * agent's edits without one read per diff every few seconds.
   */
  version: string
  /** The project's own page has no agent whose activity says when its files change: its diffs are read again every few seconds. */
  poll: boolean
  onWhole: () => void
}

/**
 * About how many rows a file's diff will draw, from its counts: a new or deleted file's every line, a
 * changed file's changed lines and the unchanged ones git puts around one change. The room held for
 * a diff before it is read; a diff of several changes far apart, or with wrapped lines, is taller.
 */
function rowsExpected(mark: FileMark): number {
  const changed = (mark.added ?? 0) + (mark.removed ?? 0)
  const whole = isNewFile(mark.status) || mark.status === 'deleted'
  return Math.max(1, Math.min(changed + (whole ? 0 : 2 * CONTEXT_LINES), MAX_PREVIEW_LINES))
}

/**
 * One file's diff, read once it comes near the view of the diffs (`root`): a change of two hundred
 * files reads the diffs it is scrolled to, not all of them at once.
 */
function LazyDiff({ root, rows, ...props }: DiffProps & { root: HTMLElement | null; rows: number }) {
  const spot = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near || !spot.current || !root) return
    const watch = new IntersectionObserver(entries => entries.some(entry => entry.isIntersecting) && setNear(true), { root, rootMargin: '600px 0px' })
    watch.observe(spot.current)
    return () => watch.disconnect()
  }, [near, root])
  if (!near)
    return (
      <div ref={spot}>
        <DiffShape rows={rows} />
      </div>
    )
  return <DiffBody {...props} rows={rows} />
}

/** A diff that is never read again on its own: what the list says of the file, or "Refresh", reads it again. */
const NO_POLL = 3_600_000

function DiffBody({ projectId, agentId, repo, path, commit, whole, wrap, version, poll, onWhole, rows }: DiffProps & { rows: number }) {
  const host = useModuleHost()
  const read = usePolled<FileDiff | null>(() => readDiff(host, projectId, path, agentId, commit, whole, ...repoArg(repo)), null, poll ? 8_000 : NO_POLL, [projectId, agentId, repo, path, commit, whole, version], {
    remember: diffKey(projectId, agentId, path, commit, whole, repo),
  })
  return (
    // Asked for whole, the diff shown so far stays until the whole file answers: the place clicked is not lost.
    <Slot of={read} shape={<DiffShape rows={rows} />} hold>
      {diff => (diff ? <DiffView diff={diff} wrap={wrap} whole={whole} onWhole={onWhole} className="py-1" /> : <p className="px-3 py-2 text-xs text-muted-foreground">No change to show.</p>)}
    </Slot>
  )
}

/** The files in the order the list shows them: folder by folder, folders first, when grouped. */
function listOrder(paths: string[], group: boolean): string[] {
  if (!group) return paths
  const order: string[] = []
  const walk = (node: Folder) => {
    for (const dir of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) walk(dir)
    order.push(...node.files)
  }
  walk(foldersOf(paths))
  return order
}

/** Search the changed files by name, and go to the one picked. */
function ChangeSearch({ paths, changes, onPick }: { paths: string[]; changes: Record<string, FileMark>; onPick: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const matches = q ? paths.filter(path => path.toLowerCase().includes(q)) : paths
  const pick = (path: string) => {
    onPick(path)
    setOpen(false)
    setQuery('')
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger render={<Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label="Search changed files" />} />}>
          <Search className="size-4" />
        </TooltipTrigger>
        <TooltipContent>Search changed files</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72 p-1">
        <Input
          name="search-changes"
          autoFocus
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && matches[0] !== undefined) pick(matches[0])
          }}
          placeholder="Search changed files"
          aria-label="Search changed files"
          className="mb-1 h-7 text-xs shadow-none"
        />
        <ul aria-label="Changed files found" className="max-h-72 overflow-y-auto">
          {matches.map(path => (
            <li key={path}>
              <button type="button" onClick={() => pick(path)} className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-start text-xs hover:bg-accent">
                <FileIcon path={path} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{path}</span>
                <Counts mark={changes[path]!} />
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">No changed file is called so.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/**
 * A run's `value`, held as it was when last kept (`keep`) while the run's files move as it ends
 * (`moving`): the run answers pending for a moment, and what the pane last showed stays. Held for
 * the run it was read for: another run's is never shown.
 */
function useHeld<T>(agentId: string | undefined, value: T, keep: boolean, moving: boolean): T {
  const held = useRef<{ agentId: string; value: T } | null>(null)
  if (agentId && keep) held.current = { agentId, value }
  const last = held.current
  return moving && last !== null && last.agentId === agentId ? last.value : value
}

/**
 * The pane's name as a menu of the repos whose changes it shows, as Claude Code's Changes header:
 * the project, then each of the run's copies of other repositories, one at a time.
 */
function RepoMenu({ repo, repos, copiesOnly, onRepo }: { repo: string | undefined; repos: readonly string[]; copiesOnly: boolean; onRepo: (repo: string | undefined) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger type="button" aria-label="Repository" className="flex min-w-0 items-center gap-1.5 rounded-md py-1 pr-1.5 pl-2 text-sm font-medium hover:bg-accent data-[popup-open]:bg-accent">
        {repo === undefined ? <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <BookMarked className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="truncate">{repo ?? 'This project'}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">Repository</DropdownMenuLabel>
          {[...(copiesOnly ? [] : [undefined]), ...repos].map(each => (
            <DropdownMenuItem key={each ?? ''} onClick={() => onRepo(each)}>
              {each === undefined ? <Folder className="h-3.5 w-3.5" aria-hidden /> : <BookMarked className="h-3.5 w-3.5" aria-hidden />}
              <span className="flex-1">{each ?? 'This project'}</span>
              {each === repo && <Check className="h-3.5 w-3.5" aria-hidden />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The pane's header: its name and the files' total; then, when there are files, search and the
 * button that hides the list; then the ⋮ menu. The branches the changes are between have a line of
 * their own under it.
 */
function ChangesHeader({ files, page, repo, repos, copiesOnly, onRepo, paths, changes, listShown, onPick, onToggleList, onRefresh }: {
  files: boolean
  page: string
  /** The repo shown: none for the project. */
  repo: string | undefined
  /** The run's copies of other repositories: with any, the pane's name is a menu of the repos. */
  repos: readonly string[]
  /** The session has no project: the menu lists its copies alone. */
  copiesOnly: boolean
  onRepo: (repo: string | undefined) => void
  paths: string[]
  changes: Record<string, FileMark>
  listShown: boolean
  onPick: (path: string) => void
  onToggleList: () => void
  onRefresh: () => void
}) {
  const settings = useChangesSettings()
  // What the files add up to, once git counted every one: the sum of the lines the list shows.
  const marks = Object.values(changes)
  const total = marks.length > 0 && marks.every(mark => mark.added !== undefined && mark.removed !== undefined) ? { added: marks.reduce((sum, mark) => sum + mark.added!, 0), removed: marks.reduce((sum, mark) => sum + mark.removed!, 0) } : undefined
  return (
    <>
      <PaneTitle>
        {repos.length > 0 ? <RepoMenu repo={repo} repos={repos} copiesOnly={copiesOnly} onRepo={onRepo} /> : <h2 className="truncate pl-2 text-sm font-medium">Changes</h2>}
        {total && <DiffStat added={total.added} removed={total.removed} zeros className="ml-auto pl-2" />}
      </PaneTitle>
      <PaneActions>
        {files && (
          <>
            <ChangeSearch paths={paths} changes={changes} onPick={onPick} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn('shrink-0 text-muted-foreground', listShown && 'bg-accent text-accent-foreground')}
                    aria-label={listShown ? 'Hide the list of files' : 'Show the list of files'}
                    aria-pressed={listShown}
                    onClick={onToggleList}
                  />
                }
              >
                <ListTree className="size-4" />
              </TooltipTrigger>
              <TooltipContent>{listShown ? 'Hide the list of files' : 'Show the list of files'}</TooltipContent>
            </Tooltip>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="The pane’s settings" className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'shrink-0 text-muted-foreground data-[popup-open]:bg-accent')}>
            <MoreVertical aria-hidden className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[12rem]">
            <DropdownMenuCheckboxItem checked={settings.group} onCheckedChange={checked => setChangesSetting('group', checked)}>
              Group files by folder
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => foldAll(page, paths)}>Collapse all files</DropdownMenuItem>
            <DropdownMenuItem onClick={() => foldAll(page, null)}>Expand all files</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={settings.wrap} onCheckedChange={checked => setChangesSetting('wrap', checked)}>
              Word wrap
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onRefresh}>Refresh</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PaneActions>
    </>
  )
}

/** The changed files, in folders or each by its whole path, the one picked lit. */
function ChangeList({ paths, changes, group, picked, rings, onPick }: { paths: string[]; changes: Record<string, FileMark>; group: boolean; picked: string | undefined; rings: boolean; onPick: (path: string) => void }) {
  const rowOf = (path: string, label: string) => <ChangeRow key={path} path={path} mark={changes[path]!} label={label} picked={path === picked} rings={rings} onPick={() => onPick(path)} />
  const folderOf = (node: Folder): ReactNode => (
    <>
      {[...node.dirs.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(dir => (
          <li key={dir.path}>
            <details open className="group">
              <summary className={cn(treeRow, 'cursor-pointer list-none text-muted-foreground')}>
                <ChevronRight aria-hidden className="size-4 shrink-0 group-open:rotate-90" />
                <span className="truncate">{dir.name}</span>
              </summary>
              <ul className="ml-3">{folderOf(dir)}</ul>
            </details>
          </li>
        ))}
      {node.files.map(path => rowOf(path, nameOf(path)))}
    </>
  )
  return (
    <ul aria-label="Changed files" className="min-h-0 flex-auto overflow-y-auto p-2">
      {group ? folderOf(foldersOf(paths)) : paths.map(path => rowOf(path, path))}
    </ul>
  )
}

/** The run's commits, newest first, with "All changes" above them, under a heading that folds them away. */
function CommitList({ commits, picked, open, onOpen, onPick }: { commits: AgentCommit[]; picked: string | undefined; open: boolean; onOpen: (open: boolean) => void; onPick: (sha: string | undefined) => void }) {
  return (
    <section aria-label="Commits" className={cn('flex shrink-0 flex-col border-t border-hairline', open && 'max-h-1/2')}>
      <h3>
        <button type="button" aria-expanded={open} onClick={() => onOpen(!open)} className="mt-1 flex h-7 w-full items-center gap-2 px-4 text-sm text-muted-foreground hover:text-foreground focus-ring-inset">
          <ChevronRight aria-hidden className={cn('size-4 shrink-0', open && 'rotate-90')} />
          <span className="flex-1 text-start">Commits</span>
          <span className="text-xs">{commits.length}</span>
        </button>
      </h3>
      {open && (
        <ul className="min-h-0 space-y-0.5 overflow-y-auto p-2 pt-0">
          <CommitRow label="All changes" picked={picked === undefined} onPick={() => onPick(undefined)} />
          {commits.map(c => (
            <CommitRow key={c.sha} label={c.subject} detail={<Facts facts={[c.short, c.author, formatRelative(c.date)]} />} title={c.subject} picked={c.sha === picked} onPick={() => onPick(c.sha)} />
          ))}
        </ul>
      )}
    </section>
  )
}

export function ChangesPanel({ projectId, agentId, activity, reveal, repo: openedOn, copiesOnly }: UiPaneProps) {
  const host = useModuleHost()
  // The run's copies of other repositories: the title's menu offers them after the project.
  const { value: repos } = usePolled<string[]>(agentId ? () => readRepos(host, projectId, agentId) : null, NO_REPOS, 30_000, [projectId, agentId], agentId ? { remember: `changes:repos:${projectId}:${agentId}` } : undefined)
  // The repo shown: the project, or one of the run's copies of other repositories, picked in the
  // title's menu; a tab opened on a copy starts on it, and a session with no project on its first.
  const [repoPicked, setRepo] = useState(openedOn)
  const repo = repoPicked ?? (copiesOnly ? repos[0] : undefined)
  const page = `${projectId}/${agentId ?? ''}`
  const settings = useChangesSettings()
  const { folded, whole } = usePageDiffs(page)
  const [body, setBody] = useState<HTMLElement | null>(null)
  const narrow = useNarrow(body, NARROW)
  // On a narrow pane the list is shown on a press of its button, in the diffs' place, and hidden
  // again by the file picked from it; the setting is what a wide pane does.
  const [peek, setPeek] = useState(false)
  const listShown = narrow ? peek : settings.list
  const [commitsOpen, setCommitsOpen] = useState(true)
  const { value: projectChanges, state: projectState, reload: reloadProject } = usePolled<Record<string, FileMark>>(agentId ? null : () => readProject(host, projectId), NO_CHANGES, 8_000, [projectId, agentId], { remember: projectKey(projectId) })
  const { value: answer, state: runState, reload } = usePolled<RunChanges | null>(agentId ? () => readRun(host, projectId, agentId, ...repoArg(repo)) : null, null, 8_000, [projectId, agentId, repo], agentId ? { remember: runKey(projectId, agentId, repo) } : undefined)
  // The run's copies of other repositories: the title's menu offers them after the project.
  // A run whose files move as it ends answers pending for a moment: the list it last showed stays.
  const moving = answer?.source === 'pending'
  const run = useHeld(agentId, answer, answer !== null && 'changes' in answer, moving)
  const { value: commitsRead, state: commitsState, reload: reloadCommits } = usePolled<AgentCommit[]>(agentId ? () => readCommits(host, projectId, agentId, ...repoArg(repo)) : null, NO_COMMITS, 8_000, [projectId, agentId, repo], agentId ? { remember: commitsKey(projectId, agentId, repo) } : undefined)
  // As with the list of files: while the run's files move as it ends, the commits last read stay.
  const commits = useHeld(agentId, commitsRead, commitsState !== 'unknown' && !moving, moving)
  // The commit picked on this page, while it is still one of the run's; none picked is "All changes".
  const [commitClick, setCommitClick] = useState<{ agentId: string; sha: string } | null>(null)
  const commit = commitClick !== null && commitClick.agentId === agentId ? commits.find(c => c.sha === commitClick.sha) : undefined
  const sha = commit?.sha
  const { value: commitChanges, state: commitState } = usePolled<Record<string, FileMark> | null>(agentId && sha ? () => readCommit(host, projectId, agentId, sha, ...repoArg(repo)) : null, null, 60_000, [projectId, agentId, repo, sha], agentId && sha ? { remember: commitKey(projectId, agentId, sha, repo) } : undefined)
  // "Refresh" in the ⋮ menu: every read again now, the diffs too.
  const [refresh, setRefresh] = useState(0)
  // The agent did something: read again now rather than on the next poll, once per burst, and the
  // diffs shown with it: an edit may leave a file's counts as they were.
  const [burst, setBurst] = useState(0)
  useEffect(() => {
    if (activity === undefined) return
    const timer = setTimeout(() => {
      reload()
      reloadCommits()
      setBurst(activity)
    }, 300)
    return () => clearTimeout(timer)
  }, [activity, reload, reloadCommits])

  // The file picked: the one clicked in this list, or the first of the list while none is, or once
  // the one clicked is no longer in the list. A click counts for the list it was made in: another
  // run's list, and another commit's, starts at its own first file.
  const [click, setClick] = useState<{ agentId: string | undefined; sha: string | undefined; path: string; at: number } | null>(null)
  const clicked = click !== null && click.agentId === agentId && click.sha === sha ? click.path : null
  // A changed file asked for from the chat is picked as a click on it in "All changes" is: once
  // for each ask, so a click made in the list after it stands. An ask for all of them ("See all")
  // shows "All changes" from its first diff.
  const revealedAt = reveal?.at
  const revealedPath = reveal?.path
  const [allAsked, setAllAsked] = useState<number>()
  useEffect(() => {
    if (revealedAt === undefined || revealedAt <= revealTaken) return
    revealTaken = revealedAt
    setCommitClick(null)
    if (revealedPath === undefined) {
      setClick(null)
      setAllAsked(revealedAt)
    } else setClick({ agentId, sha: undefined, path: revealedPath, at: Date.now() })
    setPeek(false)
  }, [revealedAt, revealedPath, agentId])

  const all = agentId ? (run && 'changes' in run ? run.changes : NO_CHANGES) : projectChanges
  const changes = commit ? (commitChanges ?? NO_CHANGES) : all
  // One order for the list and the diffs, so the first row is the first diff.
  const paths = useMemo(() => listOrder(Object.keys(changes).sort((a, b) => a.localeCompare(b)), settings.group), [changes, settings.group])
  // A file asked for from the chat may be named by its whole path on disk, when the run's card no
  // longer says where its checkout was: the listed file that path ends with is the one meant.
  const meant = clicked === null || paths.includes(clicked) ? clicked : (paths.filter(path => clicked.endsWith(`/${path}`)).sort((a, b) => b.length - a.length)[0] ?? null)
  const picked = meant !== null && paths.includes(meant) ? meant : paths[0]

  // A click in the list, or an ask from the chat, scrolls the diffs to that file's.
  const sections = useRef(new Map<string, HTMLElement>())
  const clickedAt = click?.at
  useEffect(() => {
    if (clickedAt === undefined || meant === null) return
    sections.current.get(meant)?.scrollIntoView({ block: 'start' })
  }, [clickedAt, meant])
  const pick = (path: string) => {
    setClick({ agentId, sha, path, at: Date.now() })
    setPeek(false)
  }

  // Only work that changed something is merged or not: a run that changed nothing, or one starting, says neither.
  const merged = agentId !== undefined && run !== null && 'merged' in run ? run.merged : undefined
  const between = run && 'changes' in run && run.from && run.to ? { from: run.from, to: run.to } : undefined
  const [diffsElement, setDiffsElement] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (allAsked !== undefined) diffsElement?.scrollTo({ top: 0 })
  }, [allAsked, diffsElement])
  // `files`: whether there are files to search and list. A pane with none draws neither press.
  const header = (files: boolean) => (
    <ChangesHeader
      files={files}
      page={page}
      repo={repo}
      repos={agentId ? repos : NO_REPOS}
      copiesOnly={copiesOnly === true}
      onRepo={next => {
        setRepo(next)
        setCommitClick(null)
        setClick(null)
      }}
      paths={paths}
      changes={changes}
      listShown={listShown}
      onPick={pick}
      onToggleList={() => (narrow ? setPeek(!peek) : setChangesSetting('list', !settings.list))}
      onRefresh={() => {
        reload()
        reloadCommits()
        reloadProject()
        setRefresh(n => n + 1)
      }}
    />
  )

  const line = (text: string) => (
    <>
      {header(false)}
      <PaneNote>{text}</PaneNote>
    </>
  )
  const waiting = (
    <>
      {header(true)}
      <Reading className="px-4 py-2" />
    </>
  )
  if (agentId) {
    if (runState === 'unknown' || commitsState === 'unknown' || !run || run.source === 'pending') return waiting
    if (run.source === 'gone') return line('This session’s changes are gone from this machine: its checkout was reclaimed and it left no branch or merged pull request here.')
  } else if (projectState === 'unknown') return waiting
  if (Object.keys(all).length === 0 && commits.length === 0) return line(agentId ? 'This session changed no files.' : 'Nothing is changed in the project’s folder.')

  const caption = commit ? `${commit.short} ${commit.subject}` : agentId ? undefined : 'Changed in the project’s folder, not committed.'
  // What stands where the diffs would be, when the list is empty.
  const nothing = commit ? (commitState !== 'unknown' ? 'This commit changed no files.' : undefined) : 'No change is left: the commits cancel out.'
  return (
    <>
      {header(true)}
      {/* The branches the changes are between, as Claude Code's: the branch measured from whole, then
          the run's own, cut in its middle so two runs' branches stay told apart, and whether they are
          merged: quiet, on a line of their own under the head. */}
      {between && (
        <p title={`${between.from} → ${between.to}`} className="flex h-8 shrink-0 items-center gap-1 border-b border-hairline px-4 text-xs text-muted-foreground">
          <span className="shrink-0">{`${between.from} →`}</span>
          <MiddleCut text={between.to} />
          {merged !== undefined && <span className="shrink-0">{merged ? '· merged' : '· not merged yet'}</span>}
        </p>
      )}
      {/* Beside each other while the pane is wide enough; on a narrow pane, one or the other. */}
      <div ref={setBody} className="flex min-h-0 min-w-0 flex-auto">
        {listShown && (
          <div className={cn('flex min-h-0 flex-col', narrow ? 'w-full' : 'w-1/2 max-w-72 min-w-48 shrink-0 border-r border-hairline')}>
            <ChangeList paths={paths} changes={changes} group={settings.group} picked={picked} rings={agentId !== undefined} onPick={pick} />
            {agentId && commits.length > 0 && <CommitList commits={commits} picked={sha} open={commitsOpen} onOpen={setCommitsOpen} onPick={chosen => setCommitClick(chosen === undefined ? null : { agentId, sha: chosen })} />}
          </div>
        )}
        {!(narrow && listShown) && (
          <div ref={setDiffsElement} aria-label="Diffs" className="flex min-h-0 min-w-0 flex-auto flex-col overflow-y-auto">
            {caption && (
              <p className="shrink-0 truncate px-3 py-2 text-xs text-muted-foreground" title={caption}>
                {caption}
              </p>
            )}
            {paths.length === 0 && (nothing === undefined ? <Reading className="px-3 py-2" /> : <PaneNote>{nothing}</PaneNote>)}
            {paths.map(path => {
              const mark = changes[path]!
              const isFolded = folded.has(path)
              return (
                // Keyed by the commit too: a diff still being read is never shown under another's name.
                <section
                  key={`${sha ?? ''}:${path}`}
                  aria-label={path}
                  ref={node => {
                    if (node) sections.current.set(path, node)
                    else sections.current.delete(path)
                  }}
                  className="shrink-0"
                >
                  <button
                    type="button"
                    aria-expanded={!isFolded}
                    onClick={() => foldDiff(page, path, !isFolded)}
                    className={cn('sticky top-0 z-10 flex h-8 w-full items-center gap-1 border-b border-border bg-card px-3 text-start text-sm hover:bg-accent focus-ring-inset', path === picked && 'bg-accent')}
                  >
                    <ChevronRight aria-hidden className={cn('size-4 shrink-0 text-muted-foreground', !isFolded && 'rotate-90')} />
                    <FileIcon path={path} className="size-3.5" />
                    <span className={cn('ml-1 flex min-w-0', mark.status === 'deleted' && 'line-through')}>
                      <PathCut path={path} />
                    </span>
                    {isNewFile(mark.status) && mark.added !== undefined && <span className="shrink-0 pl-1 text-xs text-muted-foreground">{`new file, ${mark.added} ${mark.added === 1 ? 'line' : 'lines'}`}</span>}
                    {/* What the file holds, at the bar's end, as each file's bar says it. */}
                    <Counts mark={mark} className="ml-auto pl-2 text-sm" />
                  </button>
                  {!isFolded && (
                    <LazyDiff
                      root={diffsElement}
                      rows={rowsExpected(mark)}
                      projectId={projectId}
                      agentId={agentId}
                      repo={repo}
                      path={path}
                      commit={sha}
                      whole={whole.has(wholeKey(path, sha))}
                      wrap={settings.wrap}
                      version={`${refresh}:${burst}:${mark.status}:${mark.committed}:${mark.added ?? ''}:${mark.removed ?? ''}`}
                      poll={agentId === undefined}
                      onWhole={() => showWhole(page, path, sha)}
                    />
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
