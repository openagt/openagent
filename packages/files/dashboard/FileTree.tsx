import { useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from 'react'
import { Check, FileIcon, FolderIcon, FolderOpenIcon } from 'lucide-react'
import { Input, cn, useModuleHost, usePolled, type ModulePanelProps } from '@openagt/dashboard/module'
import type { AgentTree } from '../src/tree.js'
import { projectKey, treeKey } from './keys.js'
import { readProject, readTree } from './reads.js'
import { FilePreviewHover } from './FilePreview.js'

/** One tree row: an icon and a name. */
function Row({ icon: Icon, className, children }: { icon: ElementType; className?: string; children: ReactNode }) {
  return (
    <span className={cn('flex items-center gap-2 p-2', className)}>
      <Icon className="size-4.5 shrink-0" />
      <span className="text-sm">{children}</span>
    </span>
  )
}

/**
 * A folder row. Its contents are built only while it is open: a closed folder costs one row however
 * much lies under it, so the pane opens as fast on a large repository as on a small one, and a
 * re-render of the page does not walk every file of the repository.
 */
function Folder({ name, children }: { name: string; children: () => ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <details className="group" onToggle={e => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer list-none rounded-lg hover:bg-accent">
        <Row icon={FolderIcon} className="group-open:hidden">
          {name}
        </Row>
        <Row icon={FolderOpenIcon} className="hidden group-open:flex">
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

/** Where a run's tree was read from, in the words the caption says it. */
function sourceCaption(tree: AgentTree): string | undefined {
  if (tree.source === 'checkout') return 'From the run’s checkout'
  if (tree.source === 'branch') return `From branch ${tree.branch}`
  if (tree.source === 'merge') return `From the merge of #${tree.number}`
  if (tree.source === 'landed') return 'From its last commit: its work was merged, and its branch is gone'
  if (tree.source === 'unchanged') return 'This run changed no files'
  if (tree.source === 'starting') return 'Starting from the project’s files'
  return undefined
}

// The Files pane (#492): a lazy, collapsible tree built from the flat `git ls-files`
// list, the project's own (the `project` read) on its page. A run's tree is its own read (the
// `tree` read): its checkout, then its branch, then its merge commit, so a finished run keeps
// showing its files; a run that changed nothing shows the project's files, and a run whose files
// none of those still holds says so in one line. No file is marked changed: what a run changed is
// another pane's to list. It is a viewer, not an editor: hovering a file previews it. With no
// files, it says so in one line.
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

const EMPTY_FILES: string[] = []

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

export function FileTree({ projectId, agentId, activity, context }: ModulePanelProps) {
  const host = useModuleHost()
  const [query, setQuery] = useState('')

  // The project's files (#492), polled so they track edits; with a run selected, the run's own
  // tree instead (#815), polled so they track an agent editing.
  const { value: projectFiles, loaded: projectLoaded } = usePolled<string[]>(
    agentId ? null : () => readProject(host, projectId),
    EMPTY_FILES,
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
  const shown = agentId ? (runFiles?.files ?? EMPTY_FILES) : projectFiles

  // A search narrows to matching files (and the folders on their way), so the tree is usable
  // on a large repo without scrolling. Empty query shows everything.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? shown.filter(f => f.toLowerCase().includes(q)) : shown
  }, [shown, query])

  const tree = useMemo(() => buildTree(visible), [visible])

  const renderNode = (node: TreeNode) => (
    <>
      {[...node.dirs.values()].sort(byName).map(dir => (
        <Folder key={dir.path} name={dir.name}>
          {() => renderNode(dir)}
        </Folder>
      ))}
      {[...node.files]
        .sort((a, b) => a.localeCompare(b))
        .map(path => {
          const name = path.slice(path.lastIndexOf('/') + 1)
          const isOn = context.files.has(path)
          // No `title`: the hover preview card already leads with the full path, and a native
          // tooltip on top of it is the slow system one the dashboard no longer uses (#1149).
          const item = (
            <button
              type="button"
              onClick={() => context.toggle(path)}
              className={cn('w-full rounded-lg text-start hover:bg-accent', isOn && 'text-primary')}
            >
              <Row icon={isOn ? Check : FileIcon}>{name}</Row>
            </button>
          )
          // Every file previews its contents on hover (#828).
          return (
            <FilePreviewHover key={path} projectId={projectId} agentId={agentId} path={path}>
              {item}
            </FilePreviewHover>
          )
        })}
    </>
  )

  if (agentId && (!treeLoaded || runTree?.source === 'pending')) {
    return <p className="p-3 text-xs text-muted-foreground">Looking for this run’s files…</p>
  }
  // No checkout, no branch and no merge commit on this machine: say so rather than show the
  // project's own files, which reads as "these are the run's".
  if (agentId && runTree?.source === 'gone') {
    return (
      <p className="p-3 text-xs text-muted-foreground">
        This run’s files are gone from this machine: its checkout was reclaimed and it left no branch or merged pull request here.
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
