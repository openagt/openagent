import { useEffect, useMemo, useRef, useState } from 'react'
import { ListTree, MoreVertical, Search, X } from 'lucide-react'
import {
  Button,
  buttonVariants,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  FileIcon,
  PaneActions,
  PaneNote,
  RowShapes,
  PaneTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  useModuleHost,
  useNarrow,
  usePolled,
  Waiting,
  type UiPaneProps,
} from '@openagt/ui/module'
import type { AgentTree } from '../src/tree.js'
import { projectKey, treeKey } from './keys.js'
import { readCopies, readProject, readTree } from './reads.js'
import { FileTree } from './FileTree.js'
import { FileView, NoFileOpen } from './FileView.js'
import { closeFile, openFile, setFilesSetting, showFile, useFilesSettings, useOpenFiles, type OpenTab } from './open-files.js'

// The Files pane, as Claude Code on the web has it: the tree on the left, the file shown on the
// right, and in the pane's header a button that hides the tree, then the opened files as tabs (the
// word "Files" while none is), then search, which shows the tree and puts the cursor in its
// "Filter files…", and a ⋮ menu of the pane's settings. A pane too narrow for both hides the tree:
// its button then shows the tree in the file's place, until a file is opened from it.
//
// The tree is the project's own files (the `project` read) on its page, and a run's (the `tree`
// read) on the run's page: its checkout, then its branch, then its merge commit, so a finished run
// keeps showing its files; a run that changed nothing shows the project's files, and a run whose
// files none of those still holds says so in one line. No file is marked changed: what a run
// changed is another pane's to list. It is a viewer, not an editor.

const EMPTY_FILES: string[] = []

/** Where a run's tree was read from, in the words the caption says it. */
function sourceCaption(tree: AgentTree): string | undefined {
  if (tree.source === 'checkout') return 'From the session’s checkout'
  if (tree.source === 'branch') return `From branch ${tree.branch}`
  if (tree.source === 'merge') return `From the merge of #${tree.number}`
  if (tree.source === 'landed') return 'From its last commit: its work was merged, and its branch is gone'
  if (tree.source === 'unchanged') return 'This session changed no files'
  if (tree.source === 'starting') return 'Starting from the project’s files'
  return undefined
}

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** The last ask from the chat that was taken: a pane opened again later does not take it a second time. */
let showTaken = 0

/**
 * The file of the tree a path names: the path itself, or the longest file it ends with, for a
 * path whole on the computer the run is on ("/home/user/test-project/index.html").
 */
export function fileAt(files: readonly string[], path: string): string | undefined {
  const asked = path.replace(/^\.\//, '')
  if (files.includes(asked)) return asked
  let found: string | undefined
  for (const file of files) if (asked.endsWith(`/${file}`) && (found === undefined || file.length > found.length)) found = file
  return found
}

/** One opened file's tab: a click shows it, a double click keeps a preview, the cross closes it. */
function Tab({ tab, shown, onShow, onKeep, onClose }: { tab: OpenTab; shown: boolean; onShow: () => void; onKeep: () => void; onClose: () => void }) {
  return (
    <div role="tab" aria-selected={shown} className={cn('flex h-7 shrink-0 items-center rounded-md text-sm text-muted-foreground hover:bg-accent', shown && 'bg-accent text-foreground')}>
      <button type="button" title={tab.path} onClick={onShow} onDoubleClick={onKeep} className="flex h-full items-center gap-2 rounded-md pl-2 focus-ring-inset">
        <FileIcon path={tab.path} />
        {/* A preview's name is slanted; its last letter leans past the box `truncate` clips at, so a
            hair of room is left for it: "README.md" read "README.ma". */}
        <span className={cn('max-w-40 truncate', !tab.kept && 'pr-0.5 italic')}>{nameOf(tab.path)}</span>
      </button>
      <button type="button" aria-label={`Close ${nameOf(tab.path)}`} onClick={onClose} className="flex h-full items-center rounded-md px-1.5 hover:text-foreground focus-ring-inset">
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  )
}

/**
 * The pane's header: the opened files as tabs (the word "Files" while none is), then search, the
 * button that hides the tree, and the ⋮ menu of the pane's settings.
 */
function FilesHeader({ page, tabs, active, tree, onOpen, onSearch, onShowTree }: {
  page: string
  tabs: OpenTab[]
  active: string | undefined
  /** Whether the tree shows. */
  tree: boolean
  onOpen: (path: string, keep: boolean) => void
  onSearch: () => void
  onShowTree: (shown: boolean) => void
}) {
  const settings = useFilesSettings()
  // The tab shown is in view, though the header has room for fewer tabs than are open.
  const tablist = useRef<HTMLDivElement>(null)
  useEffect(() => {
    tablist.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, tabs.length])
  return (
    <>
      <PaneTitle>
        {tabs.length === 0 ? (
          <h2 className="truncate pl-2 text-sm font-medium">Files</h2>
        ) : (
          <div ref={tablist} role="tablist" aria-label="Open files" className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {tabs.map(tab => (
              <Tab key={tab.path} tab={tab} shown={tab.path === active} onShow={() => showFile(page, tab.path)} onKeep={() => onOpen(tab.path, true)} onClose={() => closeFile(page, tab.path)} />
            ))}
          </div>
        )}
      </PaneTitle>
      <PaneActions>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label="Search files" onClick={onSearch} />}>
            <Search className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Search files</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn('shrink-0 text-muted-foreground', tree && 'bg-accent text-accent-foreground')}
                aria-label="File tree"
                aria-pressed={tree}
                onClick={() => onShowTree(!tree)}
              />
            }
          >
            <ListTree className="size-4" />
          </TooltipTrigger>
          <TooltipContent>{tree ? 'Hide the file tree' : 'Show the file tree'}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="The pane’s settings" className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'shrink-0 text-muted-foreground data-[popup-open]:bg-accent')}>
            <MoreVertical aria-hidden className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[11rem]">
            <DropdownMenuCheckboxItem checked={tree} onCheckedChange={onShowTree}>
              Show file tree
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={settings.previews} onCheckedChange={checked => setFilesSetting('previews', checked)}>
              Preview tabs
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={settings.wrap} onCheckedChange={checked => setFilesSetting('wrap', checked)}>
              Word wrap
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PaneActions>
    </>
  )
}

/** Narrower than this, the pane has room for the tree or the file, not both. */
const NARROW = 520

/** What the server says of the run's copies: their files, and the project's own folder's name. */
interface CopiesRead {
  project: string
  copies: { name: string; files: string[] }[]
}

/** The repos of a tree with a folder per repo: the project's folder's name and the copies; none for a run with no copy. */
type Repos = { project: string; copies: CopiesRead['copies'] }

function reposOf(read: CopiesRead | null, copiesOnly: boolean): Repos | undefined {
  if (!read || read.copies.length === 0) return undefined
  // A copy named as the project's folder is would share its folder in the tree: the project's is told apart. With no project there is none.
  const project = copiesOnly ? '' : read.copies.some(copy => copy.name === read.project) ? `${read.project} (project)` : read.project
  return { project, copies: read.copies }
}

/** Where a path of the tree with a folder per repo is: in a copy (`repo`), or the project's own, and its path there. */
export function whereIs(repos: Repos, path: string): { repo?: string; path: string } {
  const cut = path.indexOf('/')
  const top = cut < 0 ? path : path.slice(0, cut)
  const rest = cut < 0 ? '' : path.slice(cut + 1)
  if (top === repos.project) return { path: rest }
  return repos.copies.some(copy => copy.name === top) ? { repo: top, path: rest } : { path }
}

export function FilesPane({ projectId, agentId, activity, show, context, copiesOnly }: UiPaneProps) {
  const host = useModuleHost()
  const page = `${projectId}/${agentId ?? ''}`
  const { tabs, active, source } = useOpenFiles(page)
  const settings = useFilesSettings()
  const [body, setBody] = useState<HTMLElement | null>(null)
  const narrow = useNarrow(body, NARROW)
  // With no file open the tree is shown, in the file's place where there is room for one only, as
  // Claude Code's pane shows its files when it opens and when its last tab is closed. On a narrow
  // pane with a file open, the tree takes the file's place on a press of its button; a file opened
  // from it hides it again. The setting is what a wide pane does.
  const [peek, setPeek] = useState(false)
  const tree = active === undefined || (narrow ? peek : settings.tree)
  const showTree = (shown: boolean) => (narrow ? setPeek(shown) : setFilesSetting('tree', shown))
  const open = (path: string, keep: boolean) => {
    openFile(page, path, keep)
    setPeek(false)
  }
  // Search: the tree shows, and the cursor is put in its filter once it is there.
  const filter = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState(0)
  useEffect(() => {
    if (search > 0) filter.current?.focus()
  }, [search])

  // The project's files (#492), polled so they track edits; with a run selected, the run's own
  // tree instead (#815), polled so they track an agent editing.
  const { value: projectFiles, state: projectState } = usePolled<string[]>(agentId ? null : () => readProject(host, projectId), EMPTY_FILES, 8_000, [projectId, agentId], { remember: projectKey(projectId) })
  const { value: answer, state: treeState, reload: reloadTree } = usePolled<AgentTree | null>(
    agentId && !copiesOnly ? () => readTree(host, projectId, agentId) : null,
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
  const own = agentId ? (runTree && 'files' in runTree ? runTree.files : EMPTY_FILES) : projectFiles
  // The run's copies of other repositories: with any, the tree has a folder per repo, the project's
  // first, named as its folder is, then the copies by name, as Claude Code's tree has a top folder per repo.
  const { value: copiesRead } = usePolled<CopiesRead | null>(agentId ? () => readCopies(host, projectId, agentId) : null, null, 15_000, [projectId, agentId], agentId ? { remember: `files:copies:${projectId}:${agentId}` } : undefined)
  const repos = useMemo(() => reposOf(copiesRead, copiesOnly === true), [copiesRead, copiesOnly])
  // A session with no project has its copies' folders alone.
  const files = useMemo(() => (repos ? [...(copiesOnly ? [] : own.map(path => `${repos.project}/${path}`)), ...repos.copies.flatMap(copy => copy.files.map(path => `${copy.name}/${path}`))] : own), [own, repos, copiesOnly])
  // The Context holds the project's own files: in the tree with folders, under the project's.
  const shownContext = useMemo<UiPaneProps['context']>(
    () => (repos ? { files: new Set([...context.files].map(path => `${repos.project}/${path}`)), toggle: path => { const at = whereIs(repos, path); if (at.repo === undefined) context.toggle(at.path) } } : context),
    [repos, context],
  )
  // A file asked for from the chat, by the path its agent named it by: whole, on whichever computer
  // the run is on, so it is found in the tree by its end. Opened as a click in the tree opens one,
  // once the tree has it; each ask once.
  useEffect(() => {
    if (show === undefined || show.at <= showTaken || files.length === 0) return
    showTaken = show.at
    const path = fileAt(files, show.path)
    if (path !== undefined) open(path, false)
  }, [show, files])
  const header = (
    <FilesHeader
      page={page}
      tabs={tabs}
      active={active}
      tree={tree}
      onOpen={open}
      onSearch={() => {
        showTree(true)
        setSearch(n => n + 1)
      }}
      onShowTree={showTree}
    />
  )

  const line = (text: string) => (
    <>
      {header}
      <PaneNote>{text}</PaneNote>
    </>
  )
  // The tree while it is read: rows in a row's shape, unseen for the first 200ms.
  const waiting = (
    <>
      {header}
      <Waiting shape={<RowShapes rows={3} />} className="px-3 py-1" />
    </>
  )
  if (copiesOnly) {
    if (copiesRead === null) return waiting
    if (files.length === 0) return line('This session has no copy of a repository.')
  }
  if (agentId && !copiesOnly && (treeState === 'unknown' || runTree?.source === 'pending')) return waiting
  // No checkout, no branch and no merge commit on this machine: say so rather than show the
  // project's own files, which reads as "these are the run's".
  if (agentId && !copiesOnly && runTree?.source === 'gone') return line('This session’s files are gone from this machine: its checkout was reclaimed and it left no branch or merged pull request here.')
  if (!agentId && projectState === 'unknown') return waiting
  if (files.length === 0) return line('No files here.')

  return (
    <>
      {header}
      {/* Beside each other while the pane is wide enough; on a narrow pane, one or the other. */}
      <div ref={setBody} className="flex min-h-0 min-w-0 flex-auto">
        {tree && (
          <div className={cn('flex min-h-0 flex-col', narrow ? 'w-full' : 'w-1/2 max-w-72 min-w-48 shrink-0 border-r border-hairline')}>
            <FileTree files={files} first={repos?.project} caption={runTree ? sourceCaption(runTree) : undefined} shown={active} context={shownContext} filter={filter} onOpen={open} />
          </div>
        )}
        {narrow && tree ? null : active !== undefined ? (
          <FileView key={active} page={page} projectId={projectId} agentId={agentId} path={active} {...(repos ? { at: whereIs(repos, active) } : {})} wrap={settings.wrap} source={source?.has(active) ?? false} files={files} onOpen={open} />
        ) : (
          <NoFileOpen />
        )}
      </div>
    </>
  )
}
