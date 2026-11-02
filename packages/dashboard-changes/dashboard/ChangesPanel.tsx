import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, ListTree, MoreVertical, Search } from 'lucide-react'
import {
  Button,
  DiffStat,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FileIcon,
  Input,
  PaneActions,
  PaneTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  formatRelative,
  useModuleHost,
  useNarrow,
  usePolled,
  Waiting,
  type ModulePanelProps,
} from '@openagt/dashboard/module'
import type { AgentCommit, FileMark } from '../src/run.js'
import type { RunChanges } from '../src/server.js'
import type { FileDiff } from '../src/diff.js'
import { commitKey, commitsKey, diffKey, projectKey, runKey } from './keys.js'
import { readCommit, readCommits, readDiff, readProject, readRun } from './reads.js'
import { DiffView } from './DiffView.js'
import { foldAll, foldDiff, setChangesSetting, showWhole, useChangesSettings, usePageDiffs, wholeKey } from './settings.js'

// The Changes pane, as Claude Code on the web draws it: in its header a button that hides the list,
// the branch the changes are measured from and the run's own ("main → agent-…"), then search and a
// ⋮ menu; the files that changed in a list on the left, each with its lines added and removed,
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

function Line({ children }: { children: string }) {
  return <p className="p-3 text-xs text-muted-foreground">{children}</p>
}

/** The last ask from the chat that was taken: a pane opened again later does not take it a second time. */
let revealTaken = 0

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** A changed file's lines added and removed, when git counted them: both, as Claude Code writes them, `+1 −0`. */
function Counts({ mark, className }: { mark: FileMark; className?: string }) {
  return mark.added !== undefined && mark.removed !== undefined ? <DiffStat added={mark.added} removed={mark.removed} zeros className={cn('shrink-0 text-xs', className)} /> : null
}

/** Narrower than this, the pane has room for the list or the diffs, not both. */
const NARROW = 520

/** A changed file in the list: its icon, its name (or its path, ungrouped), its counts, and a ring while it is only on disk. */
function ChangeRow({ path, mark, label, picked, onPick }: { path: string; mark: FileMark; label: string; picked: boolean; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-pressed={picked}
        title={`${path} · ${mark.status === 'untracked' || mark.status === 'added' ? 'new' : mark.status}${mark.committed ? '' : ', not committed'}`}
        className={cn('flex h-6 w-full items-center gap-1.5 rounded-md px-2 text-left text-[13px] leading-[19px] hover:bg-accent', picked && 'bg-accent')}
      >
        <FileIcon path={path} className="size-3" />
        <span className={cn('min-w-0 flex-1 truncate', mark.status === 'deleted' && 'line-through')}>{label}</span>
        {!mark.committed && <span aria-label="not committed" className="size-1.5 shrink-0 rounded-full border border-current text-muted-foreground" />}
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
function CommitRow({ label, detail, title, picked, onPick }: { label: string; detail?: string; title?: string; picked: boolean; onPick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onPick} aria-pressed={picked} title={title} className={cn('flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent', picked && 'bg-accent')}>
        <span className="w-full truncate text-[13px] leading-[19px]">{label}</span>
        {detail !== undefined && <span className="w-full truncate text-xs text-muted-foreground">{detail}</span>}
      </button>
    </li>
  )
}

interface DiffProps {
  projectId: string
  agentId: string | undefined
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
 * One file's diff, read once it comes near the view of the diffs (`root`): a change of two hundred
 * files reads the diffs it is scrolled to, not all of them at once.
 */
function LazyDiff({ root, ...props }: DiffProps & { root: HTMLElement | null }) {
  const spot = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near || !spot.current || !root) return
    const watch = new IntersectionObserver(entries => entries.some(entry => entry.isIntersecting) && setNear(true), { root, rootMargin: '600px 0px' })
    watch.observe(spot.current)
    return () => watch.disconnect()
  }, [near, root])
  if (!near) return <div ref={spot} className="h-16" />
  return <DiffBody {...props} />
}

/** A diff that is never read again on its own: what the list says of the file, or "Refresh", reads it again. */
const NO_POLL = 3_600_000

function DiffBody({ projectId, agentId, path, commit, whole, wrap, version, poll, onWhole }: DiffProps) {
  const host = useModuleHost()
  const { value, loaded } = usePolled<FileDiff | null>(() => readDiff(host, projectId, path, agentId, commit, whole), null, poll ? 8_000 : NO_POLL, [projectId, agentId, path, commit, whole, version], {
    remember: diffKey(projectId, agentId, path, commit, whole),
  })
  // Asked for whole, the diff shown so far stays until the whole file answers: the place clicked is not lost to a "Reading…" line.
  const shown = useRef<FileDiff | null>(null)
  if (loaded) shown.current = value
  const diff = loaded ? value : shown.current
  if (!loaded && !diff) return <Waiting className="px-3 py-2">Reading the diff…</Waiting>
  if (!diff) return <p className="px-3 py-2 text-xs text-muted-foreground">No change to show.</p>
  return <DiffView diff={diff} wrap={wrap} whole={whole} onWhole={onWhole} className="py-1" />
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
          <Search className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent>Search changed files</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72 p-1">
        <Input
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

export function ChangesPanel({ projectId, agentId, activity, reveal }: ModulePanelProps) {
  const host = useModuleHost()
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
  const { value: projectChanges, loaded: projectLoaded, reload: reloadProject } = usePolled<Record<string, FileMark>>(agentId ? null : () => readProject(host, projectId), NO_CHANGES, 8_000, [projectId, agentId], { remember: projectKey(projectId) })
  const { value: answer, loaded: runLoaded, reload } = usePolled<RunChanges | null>(agentId ? () => readRun(host, projectId, agentId) : null, null, 8_000, [projectId, agentId], agentId ? { remember: runKey(projectId, agentId) } : undefined)
  // A run whose files move as it ends answers pending for a moment: the list it last showed stays.
  const lastRun = useRef<{ agentId: string; changes: RunChanges } | null>(null)
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
  const between = run && 'changes' in run && run.from && run.to ? `${run.from} → ${run.to}` : undefined
  const [diffsElement, setDiffsElement] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (allAsked !== undefined) diffsElement?.scrollTo({ top: 0 })
  }, [allAsked, diffsElement])
  const header = (
    <>
      <PaneTitle>
        {/* One line, cut at its end on a narrow pane: the branches come first. */}
        {between ? (
          <h2 className="min-w-0 truncate pl-2 text-[13px] text-muted-foreground" title={between}>
            {between}
            {merged !== undefined && <span className="pl-1 text-xs text-muted-foreground">{merged ? '· merged' : '· not merged yet'}</span>}
          </h2>
        ) : (
          <h2 className="truncate pl-2 text-[13px] text-muted-foreground">Changes</h2>
        )}
      </PaneTitle>
      <PaneActions>
        <ChangeSearch paths={paths} changes={changes} onPick={pick} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn('shrink-0 text-muted-foreground', listShown && 'bg-accent text-accent-foreground')}
                aria-label={listShown ? 'Hide the list of files' : 'Show the list of files'}
                aria-pressed={listShown}
                onClick={() => (narrow ? setPeek(!peek) : setChangesSetting('list', !settings.list))}
              />
            }
          >
            <ListTree className="size-4" />
          </TooltipTrigger>
          <TooltipContent>{listShown ? 'Hide the list of files' : 'Show the list of files'}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="The pane’s settings" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
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
            <DropdownMenuItem
              onClick={() => {
                reload()
                reloadCommits()
                reloadProject()
                setRefresh(n => n + 1)
              }}
            >
              Refresh
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PaneActions>
    </>
  )

  const line = (text: string) => (
    <>
      {header}
      <Line>{text}</Line>
    </>
  )
  const waiting = (text: string) => (
    <>
      {header}
      <Waiting className="p-3">{text}</Waiting>
    </>
  )
  if (agentId) {
    if (!runLoaded || !commitsLoaded || !run || run.source === 'pending') return waiting('Looking for this run’s changes…')
    if (run.source === 'gone') return line('This run’s changes are gone from this machine: its checkout was reclaimed and it left no branch or merged pull request here.')
  } else if (!projectLoaded) return waiting('Reading the project’s files…')
  if (Object.keys(all).length === 0 && commits.length === 0) return line(agentId ? 'This run changed no files.' : 'Nothing is changed in the project’s folder.')

  const caption = commit ? `${commit.short} ${commit.subject}` : agentId ? undefined : 'Changed in the project’s folder, not committed.'
  // What stands where the diffs would be, when the list is empty.
  const nothing = commit ? (commitLoaded ? 'This commit changed no files.' : 'Reading the commit…') : 'No change is left: the commits cancel out.'
  const rowOf = (path: string, label: string) => <ChangeRow key={path} path={path} mark={changes[path]!} label={label} picked={path === picked} onPick={() => pick(path)} />
  const folderOf = (node: Folder): ReactNode => (
    <>
      {[...node.dirs.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(dir => (
          <li key={dir.path}>
            <details open className="group">
              <summary className="flex h-6 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-accent">
                <ChevronRight aria-hidden className="size-3 shrink-0 group-open:rotate-90" />
                <span className="truncate">{dir.name}</span>
              </summary>
              <ul className="ml-2.5">{folderOf(dir)}</ul>
            </details>
          </li>
        ))}
      {node.files.map(path => rowOf(path, nameOf(path)))}
    </>
  )
  return (
    <>
      {header}
      {/* Beside each other while the pane is wide enough; on a narrow pane, one or the other. */}
      <div ref={setBody} className="flex min-h-0 min-w-0 flex-auto border-t border-border">
        {listShown && (
          <div className={cn('flex min-h-0 flex-col', narrow ? 'w-full' : 'w-1/3 max-w-72 min-w-40 shrink-0 border-r border-border')}>
            <ul aria-label="Changed files" className="min-h-0 flex-auto space-y-0.5 overflow-y-auto p-1">
              {settings.group ? folderOf(foldersOf(paths)) : paths.map(path => rowOf(path, path))}
            </ul>
            {agentId && commits.length > 0 && (
              <section aria-label="Commits" className={cn('flex shrink-0 flex-col border-t border-border', commitsOpen && 'max-h-[45%]')}>
                <h3>
                  <button type="button" aria-expanded={commitsOpen} onClick={() => setCommitsOpen(!commitsOpen)} className="mt-1 flex h-6 w-full items-center gap-1.5 px-3 text-[13px] text-muted-foreground hover:text-foreground">
                    <ChevronRight aria-hidden className={cn('size-3 shrink-0', commitsOpen && 'rotate-90')} />
                    <span className="flex-1 text-start">Commits</span>
                    <span className="text-xs">{commits.length}</span>
                  </button>
                </h3>
                {commitsOpen && (
                  <ul className="min-h-0 space-y-0.5 overflow-y-auto p-1 pt-0">
                    <CommitRow label="All changes" picked={commit === undefined} onPick={() => setCommitClick(null)} />
                    {commits.map(c => (
                      <CommitRow key={c.sha} label={c.subject} detail={`${c.short} · ${c.author} · ${formatRelative(c.date)}`} title={c.subject} picked={c.sha === sha} onPick={() => setCommitClick({ agentId, sha: c.sha })} />
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
        {!(narrow && listShown) && (
          <div ref={setDiffsElement} aria-label="Diffs" className="flex min-h-0 min-w-0 flex-auto flex-col overflow-y-auto">
            {caption && (
              <p className="shrink-0 truncate border-b border-border px-3 py-1.5 text-xs text-muted-foreground" title={caption}>
                {caption}
              </p>
            )}
            {paths.length === 0 && <Line>{nothing}</Line>}
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
                  className="border-b border-border"
                >
                  <button
                    type="button"
                    aria-expanded={!isFolded}
                    onClick={() => foldDiff(page, path, !isFolded)}
                    className={cn('sticky top-0 z-10 flex h-8 w-full items-center gap-1.5 bg-muted px-2 text-start text-[13px] text-muted-foreground hover:bg-accent', path === picked && 'text-foreground')}
                  >
                    <ChevronRight aria-hidden className={cn('size-3.5 shrink-0', !isFolded && 'rotate-90')} />
                    <FileIcon path={path} className="size-3" />
                    <span className={cn('min-w-0 truncate', mark.status === 'deleted' && 'line-through')}>{path}</span>
                    <Counts mark={mark} />
                  </button>
                  {!isFolded && (
                    <LazyDiff
                      root={diffsElement}
                      projectId={projectId}
                      agentId={agentId}
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
