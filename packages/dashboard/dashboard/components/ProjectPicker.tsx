import { useEffect, useMemo, useState } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Cloud, Check, ChevronDown, ChevronsUpDown, Folder, FolderGit2, FolderPlus, FolderSearch, Layers, Plus, Search } from 'lucide-react'
import type { ProjectSummary } from '../../src/index.js'
import { machineKind, machineName, typedRepository } from '../../src/client.js'
import { onRepos, sendAddRepoFolder, type ReposRead } from '../rpc/projects.js'
import { useLoaded } from '../lib/use-async.js'
import { useMachines } from '../lib/machines.js'
import { useProjectLabel } from '../lib/project-labels.js'
import { cn } from '../lib/utils.js'
import { MACHINE_ICONS } from './MachineMark.js'
import { projectErrorTitle } from './ProjectErrorBanner.js'
import { rowButtonClass } from './ui/row-item.js'
import { buttonVariants } from './ui/button.js'
import { ScrollArea } from './ui/scroll-area.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { MENU_ITEM_CLASS, MENU_POPUP_CLASS, MENU_TRIGGER_OPEN_CLASS } from './ui/dropdown-menu.js'
import { usePopupPlacement } from './ui/popup-placement.js'
import { AddProjectPanel } from './AddProjectPanel.js'

/** How many repos the menu lists before a search: the search reaches the rest. */
export const REPOS_SHOWN = 20

/** How soon a menu asks again while repos are still being looked for: on this computer, or at the git hosts. */
export const ASK_AGAIN_MS = 2000

/** The most rows a search lists. */
const SEARCH_SHOWN = 200

/** A row of the menu: none, a project, a repo that is not one yet (on this computer, or at a git host), or the address typed, to add. */
interface Row {
  value: string
  label: string
  /** Under the label, muted: a repo's address, or its folder when it has none. */
  detail?: string
  pick: { kind: 'none' } | { kind: 'project'; project: ProjectSummary } | { kind: 'repo'; path: string } | { kind: 'hosted'; address: string } | { kind: 'address'; typed: string }
  /** What the search matches besides the label. */
  search: string
}

/** A type, not an interface: the combobox takes a group as a record of any fields. */
type Group = {
  value: string
  label?: string
  items: Row[]
}

/**
 * A repo's address as the menu says it: its host and path, as a browser shows a page's
 * (`github.com/vikejs/vike`), whether git reaches it over https or ssh.
 */
export function shownAddress(url: string): string {
  return url
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/^[^@/]+@/, '')
    .replace(/^([^/:]+):(?!\d+\/)/, '$1/')
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
}

const sameRow = (a: Row, b: Row): boolean => a.value === b.value

const matches = (row: Row, query: string): boolean => `${row.label}\n${row.search}`.toLowerCase().includes(query)

/**
 * The groups the menu lists for a search: the first row (no project, or all of them), the
 * projects, then the repos that are not projects. With nothing typed, only the first
 * {@link REPOS_SHOWN} repos; a search finds any of them, by name, folder or address. A group with
 * nothing that matches is not listed. Typed as a repository's address that no row has, one more
 * row offers to add it: cloned here and made a project, as the Add-by-address way did.
 */
function pickerGroups(none: Row | undefined, projects: readonly Row[], repos: readonly Row[], typed: string): Group[] {
  const query = typed.trim().toLowerCase()
  const kept = (rows: readonly Row[], most: number) => (query ? rows.filter(row => matches(row, query)) : rows).slice(0, most)
  const address = typedRepository(typed)?.address
  const known = address !== undefined && [...projects, ...repos].some(row => row.search.toLowerCase().includes(address))
  const add: Row[] = address !== undefined && !known ? [{ value: `address:${address}`, label: `Add ${address}`, detail: 'Cloned to this computer, as a project', pick: { kind: 'address', typed: typed.trim() }, search: '' }] : []
  const groups: Group[] = [
    { value: 'none', items: none ? kept([none], 1) : [] },
    { value: 'projects', label: 'Projects', items: kept(projects, SEARCH_SHOWN) },
    { value: 'repos', label: 'Repos', items: kept(repos, query ? SEARCH_SHOWN : REPOS_SHOWN) },
    { value: 'address', items: add },
  ]
  return groups.filter(group => group.items.length > 0)
}

/** A project's state as a dot: red when the daemon recorded an error for it (#1500), else whether it is activated. */
function ProjectDot({ project }: { project: ProjectSummary }) {
  return <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', project.errors?.length ? 'bg-danger' : project.activated ? 'bg-primary' : 'bg-muted-foreground')} />
}

/** A project's name, after the folders that tell it from another of the same name, muted, so the names line up. */
function ProjectName({ name, label }: { name: string; label: string }) {
  const folders = label.endsWith(name) ? label.slice(0, -name.length) : ''
  return (
    <span className="block truncate">
      {folders && <span className="text-muted-foreground">{folders}</span>}
      {folders ? name : label}
    </span>
  )
}

/** Where a project only another computer of the person's has is (elsewhere.ts): that computer, by its name and its kind's icon. */
function ElsewhereLine({ machineId }: { machineId: string }) {
  const machine = useMachines().find(saved => saved.id === machineId)
  if (!machine) return null
  const Icon = MACHINE_ICONS[machineKind(machine).kind]
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">on {machineName(machine)}</span>
    </span>
  )
}

/** A project's row: its dot, its name, and under it where it is, what is wrong with it, or how its records are kept. */
function ProjectLine({ project, label }: { project: ProjectSummary; label: string }) {
  return (
    <>
      {/* The dot in a box the size of the other rows' icons, so every row's name starts at one edge. */}
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <ProjectDot project={project} />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <ProjectName name={project.name} label={label} />
        {project.machine !== undefined && <ElsewhereLine machineId={project.machine} />}
        {/* What the daemon finds wrong with it, in words: the project's own page carries the detail. */}
        {project.errors?.map(e => (
          <span key={e.code} title={e.message} className="block truncate text-xs text-danger">
            {projectErrorTitle(e.code)}
          </span>
        ))}
        {!project.errors?.length && !project.activated && <span className="block text-xs text-muted-foreground">Not activated</span>}
        {/* Nothing wrong: the repository has no remote, or the person keeps the agents' records here. */}
        {!project.errors?.length && project.activated && project.local && (
          <span className="block text-xs text-muted-foreground">{project.local === 'no-remote' ? 'Local only, no remote' : 'Records kept on this machine'}</span>
        )}
      </span>
    </>
  )
}

// The one picker of a project, in two places (Rom's "repos are not projects"): in the row above
// the box on the "New agent session" page, where a session works — no project, one of the
// projects, or any repo on this computer; and at the top of the sidebar, the project every page
// shows (#1513) — all of them, or one. The menu is the same: the first row, the projects with
// their lines, the repos searchable, "Search another folder…" to look in one more folder, and a
// repository's address typed into the search offered to add. The button reads the pick, so it is
// on screen with the menu shut.
//
// A repo that is not a project is asked the trust question for its folder, and on a yes it is a
// project (a sticky repo) and picked: the session works in it, or the pages show it. The repos
// are read when the page opens, so the crawl that finds them has run by the time the menu is
// opened, and again each time it opens: an old list is crawled again behind the answer.
export function ProjectPicker({
  picked,
  pickedName,
  projects,
  busy = false,
  pending = false,
  none,
  look,
  onPick,
  onProjectAdded,
}: {
  /** The project picked, or null for none. */
  picked: string | null
  /** The picked project's name, where it is known before the projects are read. */
  pickedName?: string | null | undefined
  projects: readonly ProjectSummary[]
  busy?: boolean
  /** The address names a project the dashboard has not read yet: which one it is, or whether it is one, is not known. */
  pending?: boolean
  /** The first row: what no project means here; for the `add` look, the button's words. */
  none: { label: string; tip?: string }
  /** The button: a row button under the box, the sidebar's full-width one, or a button that adds a project (the Overview's first steps). */
  look: 'row' | 'sidebar' | 'add'
  /** A project, or none, was picked. */
  onPick: (projectId: string | null) => void
  /** A repo was added as a project: the projects are to be read again. */
  onProjectAdded: () => void
}) {
  const label = useProjectLabel()
  const positionMethod = usePopupPlacement()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [adding, setAdding] = useState<{ folder: string } | { address: string } | null>(null)
  // The folder just added, until the projects read again have it: then it is picked.
  const [added, setAdded] = useState<string | null>(null)
  const [folderError, setFolderError] = useState<string | null>(null)
  // Read again after a folder is added: the daemon has crawled it by then.
  const [folders, setFolders] = useState(0)
  const repos = useLoaded<ReposRead | null>(() => onRepos().catch(() => ({ repos: [], hosted: [], reposLoading: false, hostedLoading: false, canAddFolder: false })), null, [open, folders])
  // This computer's or the git hosts' lists are still being read: asked again shortly, while the menu is open.
  useEffect(() => {
    if (!open || !(repos?.reposLoading || repos?.hostedLoading)) return
    const again = setTimeout(() => setFolders(k => k + 1), ASK_AGAIN_MS)
    return () => clearTimeout(again)
  }, [open, repos])

  useEffect(() => {
    if (added === null) return
    const project = projects.find(p => p.path === added && p.machine === undefined)
    if (!project) return
    setAdded(null)
    setAdding(null)
    onPick(project.id)
  }, [added, projects, onPick])

  const NONE: Row = useMemo(() => ({ value: 'none', label: none.label, pick: { kind: 'none' }, search: '' }), [none.label])
  const projectRows = useMemo<Row[]>(
    () => projects.map(p => ({ value: `project:${p.id}`, label: label(p.id, p.name), pick: { kind: 'project', project: p }, search: p.machine === undefined ? p.path : '' })),
    [projects, label],
  )
  const repoRows = useMemo<Row[]>(
    () => [
      ...(repos?.repos ?? []).map((repo): Row => ({ value: `repo:${repo.path}`, label: repo.name, detail: repo.url ? shownAddress(repo.url) : repo.path, pick: { kind: 'repo', path: repo.path }, search: `${repo.path}\n${repo.url ?? ''}` })),
      // Not on this computer: picked, it is cloned, as an address typed is.
      ...(repos?.hosted ?? []).map((repo): Row => ({
        value: `hosted:${repo.address}`,
        label: repo.address.split('/').slice(1).join('/'),
        detail: `${repo.private ? 'Private · ' : ''}Not on this computer · ${repo.from}`,
        pick: { kind: 'hosted', address: repo.address },
        search: `${repo.address}\n${repo.description ?? ''}`,
      })),
    ],
    [repos],
  )
  // A button that adds one has no "none" to pick: it is what the button says.
  const groups = pickerGroups(look === 'add' ? undefined : NONE, projectRows, repoRows, typed)
  const current = picked === null ? NONE : (projectRows.find(row => row.value === `project:${picked}`) ?? { value: `project:${picked}`, label: pickedName ?? '', pick: { kind: 'none' }, search: '' })
  const shown = current.label
  // No project word until the name is known, never a wrong one.
  if (!shown && !pending) return null
  const project = current.pick.kind === 'project' ? current.pick.project : undefined

  const addFolder = async () => {
    setFolderError(null)
    const outcome = await sendAddRepoFolder().catch(() => ({ ok: false as const, error: 'Could not reach the daemon.' }))
    if (!outcome.ok) setFolderError(outcome.error)
    else if (outcome.added) setFolders(k => k + 1)
  }

  const name = look === 'sidebar' ? `Project: ${pending ? 'loading' : shown}` : look === 'add' ? none.label : 'The session works in'
  const button =
    look === 'add' ? (
      <button type="button" className={buttonVariants({ size: 'sm' })}>
        <FolderPlus className="h-3.5 w-3.5" aria-hidden />
        {none.label}
      </button>
    ) : look === 'sidebar' ? (
      <button type="button" className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-background px-2 py-1.5 text-sm font-medium transition-colors hover:bg-sidebar-accent/60">
        {/* Until the projects are read, the project the address names is not known: a bar where its
            name goes, rather than "All projects" for a moment. */}
        {pending ? (
          <>
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-muted" />
            <span className="flex-1">
              <span aria-hidden className="block h-3.5 w-24 animate-pulse rounded bg-muted" />
            </span>
          </>
        ) : (
          <>
            {project ? <ProjectDot project={project} /> : <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="flex-1 truncate text-left">{shown}</span>
          </>
        )}
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
      </button>
    ) : (
      <button type="button" className={cn(rowButtonClass, 'max-w-[16rem]!')}>
        <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{shown}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      </button>
    )
  const trigger = <Combobox.Trigger disabled={busy || pending} aria-label={name} className={MENU_TRIGGER_OPEN_CLASS} render={button} />

  return (
    <>
      <Combobox.Root<Row>
        items={groups}
        filteredItems={groups}
        value={current}
        isItemEqualToValue={sameRow}
        itemToStringLabel={row => row.label}
        inputValue={typed}
        onInputValueChange={setTyped}
        open={open}
        onOpenChange={next => {
          setOpen(next)
          if (!next) setTyped('')
        }}
        onValueChange={row => {
          if (!row) return
          if (row.pick.kind === 'none') onPick(null)
          else if (row.pick.kind === 'project') onPick(row.pick.project.id)
          else if (row.pick.kind === 'repo') setAdding({ folder: row.pick.path })
          else if (row.pick.kind === 'hosted') setAdding({ address: row.pick.address })
          else setAdding({ address: row.pick.typed })
        }}
      >
        {look === 'row' ? (
          <Tooltip>
            <TooltipTrigger render={trigger} />
            <TooltipContent>{picked === null ? none.tip : `The session works in ${shown}`}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
        <Combobox.Portal>
          <Combobox.Positioner positionMethod={positionMethod} sideOffset={6} align="start" className="z-50 outline-none">
            <Combobox.Popup aria-label={name} className={cn(MENU_POPUP_CLASS, 'w-[22rem] max-w-[var(--available-width)]')}>
              <div className="flex items-center gap-2 border-b border-border px-3">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <Combobox.Input aria-label="Search projects and repos" placeholder="Search, or paste a GitHub address" className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              </div>
              <ScrollArea viewportClassName="h-[min(20rem,calc(var(--available-height)-5rem))]">
                <div className="p-1">
                  <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground empty:hidden">No project or repo by that name.</Combobox.Empty>
                  <Combobox.List>
                    {(group: Group) => (
                      <Combobox.Group key={group.value} items={group.items}>
                        {group.label && <Combobox.GroupLabel className="px-2 pt-2 pb-1 text-xs font-normal text-muted-foreground">{group.label}</Combobox.GroupLabel>}
                        <Combobox.Collection>
                          {(row: Row) => (
                            <Combobox.Item key={row.value} value={row} className={cn(MENU_ITEM_CLASS, 'items-start')}>
                              {/* Each row leads with its own mark; the pick is the tick at the row's end. */}
                              {row.pick.kind === 'address' ? (
                                <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                              ) : row.pick.kind === 'none' ? (
                                <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                              ) : row.pick.kind === 'repo' ? (
                                <FolderGit2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                              ) : row.pick.kind === 'hosted' ? (
                                <Cloud className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                              ) : null}
                              {row.pick.kind === 'project' ? (
                                <ProjectLine project={row.pick.project} label={row.label} />
                              ) : (
                                <span className="min-w-0 flex-1 leading-tight">
                                  <span className="block truncate">{row.label}</span>
                                  {row.detail && <span className="block truncate text-xs text-muted-foreground">{row.detail}</span>}
                                </span>
                              )}
                              {row.value === current.value && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
                            </Combobox.Item>
                          )}
                        </Combobox.Collection>
                      </Combobox.Group>
                    )}
                  </Combobox.List>
                  {repos === null || repos.reposLoading ? (
                    <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">Looking for repos on this computer…</p>
                  ) : !typed.trim() && repoRows.length > REPOS_SHOWN ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">Search to see more of the {repoRows.length} repos.</p>
                  ) : null}
                  {repos?.hostedLoading && (
                    <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">
                      Asking GitHub for repos…
                    </p>
                  )}
                </div>
              </ScrollArea>
              {repos?.canAddFolder && (
                <div className="border-t border-border p-1">
                  <button type="button" onClick={() => void addFolder()} className={cn(MENU_ITEM_CLASS, 'w-full text-muted-foreground')}>
                    <FolderSearch className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>Search another folder…</span>
                  </button>
                  {folderError && <p className="px-2 py-1.5 text-xs text-danger">{folderError}</p>}
                </div>
              )}
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {adding !== null && (
        <AddProjectPanel
          {...('folder' in adding ? { folder: adding.folder } : { address: adding.address })}
          onAdded={path => {
            setAdded(path)
            onProjectAdded()
          }}
          onClose={() => {
            setAdding(null)
            setAdded(null)
          }}
        />
      )}
    </>
  )
}
