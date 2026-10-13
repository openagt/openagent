import { useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from 'react'
import { Check, FileIcon, FolderIcon, FolderOpenIcon } from 'lucide-react'
import { Input, cn, useModuleHost, usePolled, type ModulePanelProps } from '@openagt/dashboard/module'
import type { ProjectTree } from '../src/server.js'
import type { AgentTree, FileMark } from '../src/tree.js'
import { projectKey, treeKey } from './keys.js'
import { readProject, readTree } from './reads.js'
import { FilePreviewHover } from './FilePreview.js'

type FileGitStatus = FileMark['status']

/** The row tint for a changed file or folder — one meaning, one colour (F4). */
const STATUS_TEXT: Record<FileGitStatus, string> = {
  untracked: 'text-success',
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger',
}

/** The dot a changed folder carries, in the same vocabulary. */
const STATUS_DOT: Record<FileGitStatus, string> = {
  untracked: 'bg-success',
  added: 'bg-success',
  modified: 'bg-warning',
  deleted: 'bg-danger',
}

/** A changed file says which change it is; a folder only says that something under it changed. */
const STATUS_LETTER: Record<FileGitStatus, string> = { untracked: 'U', added: 'A', modified: 'M', deleted: 'D' }

/** One tree row: an icon, a name, and git's verdict on the right when it has one. */
function Row({ icon: Icon, gitStatus, mark, className, children }: {
  icon: ElementType
  /** A folder's roll-up: a dot says something under it changed. */
  gitStatus?: FileGitStatus | undefined
  /** A file's own change: its letter, then a solid dot when committed or a ring when only on disk. */
  mark?: FileMark | undefined
  className?: string
  children: ReactNode
}) {
  const status = mark?.status ?? gitStatus
  return (
    <span className={cn('flex items-center justify-between gap-2 p-2', status && STATUS_TEXT[status], className)}>
      <span className="flex items-center gap-2">
        <Icon className="size-4.5 shrink-0" />
        <span className="text-sm">{children}</span>
      </span>
      {mark ? (
        <span className="flex items-center gap-1" aria-label={`${mark.status}, ${mark.committed ? 'committed' : 'not committed'}`}>
          <span className="text-sm font-medium">{STATUS_LETTER[mark.status]}</span>
          <span className={cn('size-1.5 shrink-0 rounded-full', mark.committed ? 'bg-current' : 'border border-current')} />
        </span>
      ) : (
        gitStatus && <span className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[gitStatus])} />
      )}
    </span>
  )
}

/**
 * A folder row. Its contents are built only while it is open: a closed folder costs one row however
 * much lies under it, so the tab opens as fast on a large repository as on a small one, and a
 * re-render of the page does not walk every file of the repository.
 */
function Folder({ name, gitStatus, children }: {
  name: string
  gitStatus?: FileGitStatus | undefined
  children: () => ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <details className="group" onToggle={e => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer list-none rounded-lg hover:bg-accent">
        <Row icon={FolderIcon} gitStatus={gitStatus} className="group-open:hidden">
          {name}
        </Row>
        <Row icon={FolderOpenIcon} gitStatus={gitStatus} className="hidden group-open:flex">
          {name}
        </Row>
      </summary>
      {/* The guide line down the left of a folder's contents. */}
      {open && (
        <div className="relative ml-6 before:absolute before:inset-y-0 before:-left-2 before:h-full before:w-px before:bg-border">
          {children()}
        </div>
      )}
    </details>
  )
}

/** Stable, so the `useMemo` on the marks doesn't re-run for a fresh empty object. */
const EMPTY_PROJECT: ProjectTree = { files: [], changes: {} }

/** Where a run's tree was read from, in the words the caption says it; for merged work, that nothing is waiting. */
function sourceCaption(tree: AgentTree): string | undefined {
  if ('merged' in tree && tree.merged) return 'Merged: nothing waiting. What it changed is under Changes.'
  if (tree.source === 'checkout') return 'From the run’s checkout'
  if (tree.source === 'branch') return `From branch ${tree.branch}`
  if (tree.source === 'merge') return `From the merge of #${tree.number}`
  if (tree.source === 'landed') return 'From its last commit: its work was merged, and its branch is gone'
  if (tree.source === 'unchanged') return 'This run changed no files'
  if (tree.source === 'starting') return 'Starting from the project’s files'
  return undefined
}

// The side rail's Files tab (#492): a lazy, collapsible tree built from the flat `git ls-files`
// list, the project's own (the `project` read) on its page. A run's tree is its own read (the
// `tree` read): its checkout, then its branch, then its merge commit, so a finished run keeps
// showing what it changed; a run that changed nothing shows the project's files with nothing
// marked, and a run whose changes none of those still holds says so in one line. The marks say
// what is not merged yet: once a run's work is merged its tree is plain, a caption says so, and
// what it changed is the Changes tab's to list (`ChangesPanel.tsx`). It is a viewer,
// not an editor: hovering a file previews it. With no files, it says so in one line.
//
// Folders are native `<details>`: open/closed state, keyboard operation and the disclosure
// semantics come from the browser; a folder's contents exist only while it is open (see Folder). This used to be 1,225 lines of vendored animate-ui — a copied
// component registry, not a dependency, and `@ts-nocheck`'d so none of it was even typechecked —
// whose contribution was an expand animation and a hover highlight on a file list in a side panel.

type TreeNode = {
  name: string
  path: string
  dirs: Map<string, TreeNode>
  files: string[]
}

/** Build a nested tree from repo-relative paths like `src/dashboard/foo.ts`. */
function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', dirs: new Map(), files: [] }
  for (const p of paths) {
    const parts = p.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!
      const childPath = node.path ? `${node.path}/${seg}` : seg
      let child = node.dirs.get(seg)
      if (!child) {
        child = { name: seg, path: childPath, dirs: new Map(), files: [] }
        node.dirs.set(seg, child)
      }
      node = child
    }
    node.files.push(p)
  }
  return root
}

/** Roll each changed file's status up to its ancestor folders so a folder dots when dirty. */
function foldersFromMarks(marks: Record<string, FileMark>): Map<string, FileGitStatus> {
  const dirs = new Map<string, FileGitStatus>()
  for (const [path, { status: st }] of Object.entries(marks)) {
    const parts = path.split('/')
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]!
      const prev = dirs.get(acc)
      dirs.set(acc, prev && prev !== st ? 'modified' : st) // mixed children read as modified
    }
  }
  return dirs
}

const EMPTY_FILES: string[] = []
const EMPTY_MARKS: Record<string, FileMark> = {}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

export function FileTree({ projectId, agentId, activity, context }: ModulePanelProps) {
  const host = useModuleHost()
  const [query, setQuery] = useState('')

  // The project's files and their on-disk marks (#492), polled so they track edits; with a run
  // selected, the run's own tree and marks instead (#815), polled so they track an agent editing.
  const { value: projectTree, loaded: projectLoaded } = usePolled<ProjectTree>(
    agentId ? null : () => readProject(host, projectId),
    EMPTY_PROJECT,
    8_000,
    [projectId, agentId],
    { remember: projectKey(projectId) },
  )
  const { value: answer, loaded: treeLoaded, reload: reloadTree } = usePolled<AgentTree | null>(
    agentId ? () => readTree(host, projectId, agentId) : null,
    null,
    8_000,
    [projectId, agentId],
    agentId ? { remember: treeKey(projectId, agentId) } : undefined,
  )
  // A run whose files move (its checkout reclaimed as it ends, its branch not read yet) answers
  // pending for a moment: the tree it last showed stays until the new place answers, never a blank.
  const lastTree = useRef<{ agentId: string; tree: AgentTree } | null>(null)
  if (agentId && answer && 'files' in answer) lastTree.current = { agentId, tree: answer }
  const last = lastTree.current
  const runTree = answer?.source === 'pending' && last !== null && last.agentId === agentId ? last.tree : answer
  // The agent did something: its files may have changed, so they are read again now rather than on
  // the next poll. A burst of events is one read, a moment after the last.
  useEffect(() => {
    if (activity === undefined) return
    const timer = setTimeout(reloadTree, 300)
    return () => clearTimeout(timer)
  }, [activity, reloadTree])
  // A run still starting has its checkout within seconds: asked again sooner than the poll.
  const pending = answer?.source === 'pending' || answer?.source === 'starting'
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(reloadTree, 2_000)
    return () => clearInterval(timer)
  }, [pending, reloadTree])
  const runFiles = runTree && 'files' in runTree ? runTree : undefined
  const shown = agentId ? (runFiles?.files ?? EMPTY_FILES) : projectTree.files
  // A merged run's tree is plain: its marks would say "not merged yet" of work that is.
  const merged = runFiles !== undefined && 'merged' in runFiles && runFiles.merged
  const marks = agentId ? (merged ? EMPTY_MARKS : (runFiles?.changes ?? EMPTY_MARKS)) : projectTree.changes

  const folderStatus = useMemo(() => foldersFromMarks(marks), [marks])

  // A search narrows to matching files (and the folders on their way), so the tree is usable
  // on a large repo without scrolling. Empty query shows everything.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? shown.filter(f => f.toLowerCase().includes(q)) : shown
  }, [shown, query])

  const tree = useMemo(() => buildTree(visible), [visible])

  const renderNode = (node: TreeNode) => (
    <>
      {[...node.dirs.values()].sort(byName).map(dir => {
        const dirGit = folderStatus.get(dir.path)
        return (
          <Folder key={dir.path} name={dir.name} gitStatus={dirGit}>
            {() => renderNode(dir)}
          </Folder>
        )
      })}
      {[...node.files]
        .sort((a, b) => a.localeCompare(b))
        .map(path => {
          const name = path.slice(path.lastIndexOf('/') + 1)
          const isOn = context.files.has(path)
          const git = marks[path]
          // No `title`: the hover preview card already leads with the full path, and a native
          // tooltip on top of it is the slow system one the dashboard no longer uses (#1149).
          const item = (
            <button
              type="button"
              onClick={() => context.toggle(path)}
              className={cn('w-full rounded-lg text-start hover:bg-accent', isOn && 'text-primary')}
            >
              <Row icon={isOn ? Check : FileIcon} mark={git}>
                {name}
              </Row>
            </button>
          )
          // Every file previews on hover: a changed one shows its diff (#816), an unchanged one
          // its contents (#828). `git` picks which read the card makes, so the tree's own status
          // map answers that rather than a second server lookup.
          return (
            <FilePreviewHover key={path} projectId={projectId} agentId={agentId} path={path} changed={Boolean(git)}>
              {item}
            </FilePreviewHover>
          )
        })}
    </>
  )

  if (agentId && (!treeLoaded || runTree?.source === 'pending')) {
    return <p className="p-3 text-xs text-muted-foreground">Looking for this run’s changes…</p>
  }
  // No checkout, no branch and no merge commit on this machine: say so rather than show the
  // project root unmarked, which reads as "this run touched nothing".
  if (agentId && runTree?.source === 'gone') {
    return (
      <p className="p-3 text-xs text-muted-foreground">
        This run’s changes are gone from this machine: its checkout was reclaimed and it left no branch or merged pull request here.
      </p>
    )
  }
  if (!agentId && !projectLoaded) return <p className="p-3 text-xs text-muted-foreground">Reading the project’s files…</p>
  if (shown.length === 0) return <p className="p-3 text-xs text-muted-foreground">No files here.</p>
  const caption = runTree ? sourceCaption(runTree) : undefined

  return (
    <div className="flex min-h-0 flex-auto flex-col p-2">
      <Input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Filter files…"
        aria-label="Filter files"
        className="mb-2 h-7 bg-background px-2 text-xs shadow-none"
      />
      {caption && <p className="px-1 pb-1 text-[10px] text-muted-foreground">{caption}</p>}
      {/* A query with zero hits used to render an empty pane, which reads as broken (#948). */}
      {query.trim() && visible.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">No files match &ldquo;{query.trim()}&rdquo;.</p>
      ) : (
        <>
          {query.trim() && (
            <p className="px-1 pb-1 text-[10px] text-muted-foreground">
              {visible.length} of {shown.length} files
            </p>
          )}
          {/* The tree is the one panel with no scroller of its own, so it carries one: a long repo
              scrolls here rather than stretching the rail past what follows it. */}
          <div className="min-h-0 w-full flex-auto overflow-y-auto text-sm">{renderNode(tree)}</div>
        </>
      )}
    </div>
  )
}
