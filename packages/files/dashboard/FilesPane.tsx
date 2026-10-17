import { useEffect, useRef, useState } from 'react'
import { ListTree, MoreVertical, Search, X } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  FileIcon,
  PaneActions,
  PaneTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  useModuleHost,
  useNarrow,
  usePolled,
  type ModulePanelProps,
} from '@openagt/dashboard/module'
import type { AgentTree } from '../src/tree.js'
import { projectKey, treeKey } from './keys.js'
import { readProject, readTree } from './reads.js'
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
  if (tree.source === 'checkout') return 'From the run’s checkout'
  if (tree.source === 'branch') return `From branch ${tree.branch}`
  if (tree.source === 'merge') return `From the merge of #${tree.number}`
  if (tree.source === 'landed') return 'From its last commit: its work was merged, and its branch is gone'
  if (tree.source === 'unchanged') return 'This run changed no files'
  if (tree.source === 'starting') return 'Starting from the project’s files'
  return undefined
}

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** One opened file's tab: a click shows it, a double click keeps a preview, the cross closes it. */
function Tab({ tab, shown, onShow, onKeep, onClose }: { tab: OpenTab; shown: boolean; onShow: () => void; onKeep: () => void; onClose: () => void }) {
  return (
    <div role="tab" aria-selected={shown} className={cn('flex h-7 shrink-0 items-center rounded-md text-xs text-muted-foreground hover:bg-accent', shown && 'bg-accent text-foreground')}>
      <button type="button" title={tab.path} onClick={onShow} onDoubleClick={onKeep} className="flex h-full items-center gap-1.5 pl-2">
        <FileIcon path={tab.path} className="size-3.5" />
        <span className={cn('max-w-40 truncate', !tab.kept && 'italic')}>{nameOf(tab.path)}</span>
      </button>
      <button type="button" aria-label={`Close ${nameOf(tab.path)}`} onClick={onClose} className="flex h-full items-center px-1.5 hover:text-foreground">
        <X aria-hidden className="size-3" />
      </button>
    </div>
  )
}

/** Narrower than this, the pane has room for the tree or the file, not both. */
const NARROW = 520

export function FilesPane({ projectId, agentId, activity, context }: ModulePanelProps) {
  const host = useModuleHost()
  const page = `${projectId}/${agentId ?? ''}`
  const { tabs, active, source } = useOpenFiles(page)
  const settings = useFilesSettings()
  const [body, setBody] = useState<HTMLElement | null>(null)
  const narrow = useNarrow(body, NARROW)
  // On a narrow pane the tree is shown on a press of its button, in the file's place, and hidden
  // again by the file opened from it; the setting is what a wide pane does.
  const [peek, setPeek] = useState(false)
  const tree = narrow ? peek : settings.tree
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
  const { value: projectFiles, loaded: projectLoaded } = usePolled<string[]>(agentId ? null : () => readProject(host, projectId), EMPTY_FILES, 8_000, [projectId, agentId], { remember: projectKey(projectId) })
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
  const files = agentId ? (runTree && 'files' in runTree ? runTree.files : EMPTY_FILES) : projectFiles
  // The tab shown is in view, though the header has room for fewer tabs than are open.
  const tablist = useRef<HTMLDivElement>(null)
  useEffect(() => {
    tablist.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, tabs.length])

  const header = (
    <>
      <PaneTitle>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn('shrink-0 text-muted-foreground', tree && 'bg-accent text-primary')}
                aria-label={tree ? 'Hide the file tree' : 'Show the file tree'}
                aria-pressed={tree}
                onClick={() => showTree(!tree)}
              />
            }
          >
            <ListTree className="size-4" />
          </TooltipTrigger>
          <TooltipContent>{tree ? 'Hide the file tree' : 'Show the file tree'}</TooltipContent>
        </Tooltip>
        {tabs.length === 0 ? (
          <h2 className="truncate pl-1 text-xs font-medium text-muted-foreground">Files</h2>
        ) : (
          <div ref={tablist} role="tablist" aria-label="Open files" className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {tabs.map(tab => (
              <Tab key={tab.path} tab={tab} shown={tab.path === active} onShow={() => showFile(page, tab.path)} onKeep={() => open(tab.path, true)} onClose={() => closeFile(page, tab.path)} />
            ))}
          </div>
        )}
      </PaneTitle>
      <PaneActions>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground"
                aria-label="Search files"
                onClick={() => {
                  showTree(true)
                  setSearch(n => n + 1)
                }}
              />
            }
          >
            <Search className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>Search files</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="The pane’s settings" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
            <MoreVertical aria-hidden className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[11rem]">
            <DropdownMenuCheckboxItem checked={tree} onCheckedChange={showTree}>
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

  const line = (text: string) => (
    <>
      {header}
      <p className="p-3 text-xs text-muted-foreground">{text}</p>
    </>
  )
  if (agentId && (!treeLoaded || runTree?.source === 'pending')) return line('Looking for this run’s files…')
  // No checkout, no branch and no merge commit on this machine: say so rather than show the
  // project's own files, which reads as "these are the run's".
  if (agentId && runTree?.source === 'gone') return line('This run’s files are gone from this machine: its checkout was reclaimed and it left no branch or merged pull request here.')
  if (!agentId && !projectLoaded) return line('Reading the project’s files…')
  if (files.length === 0) return line('No files here.')

  return (
    <>
      {header}
      {/* Beside each other while the pane is wide enough; on a narrow pane, one or the other. */}
      <div ref={setBody} className="flex min-h-0 min-w-0 flex-auto">
        {tree && (
          <div className={cn('flex min-h-0 flex-col', narrow ? 'w-full' : 'w-2/5 max-w-72 min-w-40 shrink-0 border-r border-border')}>
            <FileTree files={files} caption={runTree ? sourceCaption(runTree) : undefined} shown={active} context={context} filter={filter} onOpen={open} />
          </div>
        )}
        {narrow && tree ? null : active !== undefined ? (
          <FileView key={active} page={page} projectId={projectId} agentId={agentId} path={active} wrap={settings.wrap} source={source?.has(active) ?? false} />
        ) : (
          <NoFileOpen tree={tree} />
        )}
      </div>
    </>
  )
}
