import { useEffect, useMemo, useRef, useState } from 'react'
import { ListTree, MoreVertical, Search, X } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
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
  useModuleHost,
  usePolled,
  type ModulePanelProps,
} from '@openagt/dashboard/module'
import type { AgentTree } from '../src/tree.js'
import { projectKey, treeKey } from './keys.js'
import { readProject, readTree } from './reads.js'
import { FileIcon } from './file-icon.js'
import { FileTree } from './FileTree.js'
import { FileView, NoFileOpen } from './FileView.js'
import { closeFile, openFile, setFilesSetting, showFile, useFilesSettings, useOpenFiles, type OpenTab } from './open-files.js'

// The Files pane, as Claude Code on the web has it: the tree on the left, the file shown on the
// right, and in the pane's header a button that hides the tree, then the opened files as tabs (the
// word "Files" while none is), then search and a ⋮ menu of the pane's settings.
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

/** Search the files by name, and open the one picked. */
function FileSearch({ files, onOpen }: { files: string[]; onOpen: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return files.slice(0, 50)
    // A name that matches comes before a folder that does.
    const named = files.filter(f => nameOf(f).toLowerCase().includes(q))
    const inFolder = files.filter(f => !nameOf(f).toLowerCase().includes(q) && f.toLowerCase().includes(q))
    return [...named, ...inFolder].slice(0, 50)
  }, [files, query])
  const pick = (path: string) => {
    onOpen(path)
    setOpen(false)
    setQuery('')
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger render={<Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label="Search files" />} />}>
          <Search className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent>Search files</TooltipContent>
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
          placeholder="Search files"
          aria-label="Search files"
          className="mb-1 h-7 text-xs shadow-none"
        />
        <ul aria-label="Files found" className="max-h-72 overflow-y-auto">
          {matches.map(path => (
            <li key={path}>
              <button type="button" onClick={() => pick(path)} className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-start text-xs hover:bg-accent">
                <FileIcon path={path} className="size-3.5" />
                <span className="shrink-0">{nameOf(path)}</span>
                <span className="min-w-0 truncate text-muted-foreground">{path.slice(0, -nameOf(path).length - 1)}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">No file is called so.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export function FilesPane({ projectId, agentId, activity, context }: ModulePanelProps) {
  const host = useModuleHost()
  const page = `${projectId}/${agentId ?? ''}`
  const { tabs, active } = useOpenFiles(page)
  const settings = useFilesSettings()
  const open = (path: string, keep: boolean) => openFile(page, path, keep)

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

  const header = (
    <>
      <PaneTitle>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn('shrink-0 text-muted-foreground', settings.tree && 'bg-accent text-primary')}
                aria-label={settings.tree ? 'Hide the file tree' : 'Show the file tree'}
                aria-pressed={settings.tree}
                onClick={() => setFilesSetting('tree', !settings.tree)}
              />
            }
          >
            <ListTree className="size-4" />
          </TooltipTrigger>
          <TooltipContent>{settings.tree ? 'Hide the file tree' : 'Show the file tree'}</TooltipContent>
        </Tooltip>
        {tabs.length === 0 ? (
          <h2 className="truncate pl-1 text-xs font-medium text-muted-foreground">Files</h2>
        ) : (
          <div role="tablist" aria-label="Open files" className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {tabs.map(tab => (
              <Tab key={tab.path} tab={tab} shown={tab.path === active} onShow={() => showFile(page, tab.path)} onKeep={() => open(tab.path, true)} onClose={() => closeFile(page, tab.path)} />
            ))}
          </div>
        )}
      </PaneTitle>
      <PaneActions>
        <FileSearch files={files} onOpen={path => open(path, false)} />
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="The pane’s settings" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
            <MoreVertical aria-hidden className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[11rem]">
            <DropdownMenuCheckboxItem checked={settings.tree} onCheckedChange={checked => setFilesSetting('tree', checked)}>
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
      {/* Beside each other while the pane is wide enough; on a narrow pane, as on a phone, the tree is over the file. */}
      <div className="@container flex min-h-0 flex-auto">
        <div className="flex min-h-0 min-w-0 flex-auto @max-md:flex-col">
          {settings.tree && (
            <div className="flex min-h-0 w-2/5 max-w-72 min-w-40 shrink-0 flex-col border-r border-border @max-md:max-h-[45%] @max-md:w-full @max-md:max-w-none @max-md:border-r-0 @max-md:border-b">
              <FileTree files={files} caption={runTree ? sourceCaption(runTree) : undefined} shown={active} context={context} onOpen={open} />
            </div>
          )}
          {active !== undefined ? <FileView key={active} projectId={projectId} agentId={agentId} path={active} wrap={settings.wrap} /> : <NoFileOpen />}
        </div>
      </div>
    </>
  )
}
