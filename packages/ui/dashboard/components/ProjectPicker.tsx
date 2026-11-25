import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { addressOfRemote } from '@openagt/agent-data/repository-address'
import { Cloud, Check, ChevronsUpDown, Folder, FolderGit2, FolderPlus, FolderSearch, Layers, Plus, Search } from 'lucide-react'
import type { ProjectSummary } from '../../src/index.js'
import { typedRepository } from '../../src/client.js'
import { onRepos, sendAddRepoFolder, type ReposRead } from '../rpc/projects.js'
import { useLoaded } from '../lib/use-async.js'
import { useProjectLabel } from '../lib/project-labels.js'
import { cn } from '../lib/utils.js'
import { rowButtonClass, RowChevron } from './ui/row-item.js'
import { buttonVariants } from './ui/button.js'
import { ScrollArea } from './ui/scroll-area.js'
import { Skeleton, useSkeleton } from './ui/skeleton.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { MENU_BODY_CLASS, MENU_ITEM_CLASS, MENU_POPUP_CLASS, MENU_TRIGGER_OPEN_CLASS, MenuMark } from './ui/dropdown-menu.js'
import { PROJECT_ROW_CLASS } from './ui/nav-row.js'
import { usePopupPosition } from './ui/popup-placement.js'
import { usePickerSearch } from './ui/picker-search.js'
import { AddProjectPanel } from './AddProjectPanel.js'
import { Facts } from './ui/panel.js'
import { MiddleCut } from './MiddleCut.js'
import { useWhereRepos } from './Places.js'

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
  detail?: ReactNode
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

/** Under a repo's name: its address at its host, or its folder when it has no remote or its remote is a folder too. */
export function repoDetail(repo: { path: string; url?: string | undefined }): string {
  return repo.url && addressOfRemote(repo.url) ? shownAddress(repo.url) : repo.path
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
export function ProjectDot({ project }: { project: ProjectSummary }) {
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

/** A project's row: its dot, its name, and under it what is wrong with it, or how its records are kept. */
function ProjectLine({ project, label }: { project: ProjectSummary; label: string }) {
  return (
    <>
      {/* The dot in a box the size of the other rows' icons, so every row's name starts at one edge. */}
      <MenuMark className="w-3.5 justify-center">
        <ProjectDot project={project} />
      </MenuMark>
      <span className="min-w-0 flex-1 leading-5">
        <ProjectName name={project.name} label={label} />
        {/* What the person has to fix there, in words: the project's own page carries the detail. */}
        {project.errors?.map(e => (
          <span key={e.id} data-line2 title={e.message} className="block truncate text-xs leading-4 text-danger">
            {e.title}
          </span>
        ))}
        {!project.errors?.length && !project.activated && <span data-line2 className="block text-xs leading-4 text-muted-foreground">Not activated</span>}
        {/* Nothing wrong: the repository has no remote, or the person keeps the agents' records here. */}
        {!project.errors?.length && project.activated && project.local && (
          <span data-line2 className="block text-xs leading-4 text-muted-foreground">{project.local === 'no-remote' ? 'Local only, no remote' : 'Records kept on this machine'}</span>
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
  const position = usePopupPosition()
  const search = usePickerSearch()
  const { open, typed } = search
  const [adding, setAdding] = useState<{ folder: string } | { address: string } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // The list as tall as its rows with nothing typed, and that tall while a person types, so the search
  // stays where it is as the rows narrow (opened upward too, where the list's top would move down).
  const list = useRef<HTMLDivElement>(null)
  const untyped = useRef<number>(undefined)
  useLayoutEffect(() => {
    if (!typed && list.current) untyped.current = list.current.offsetHeight
  })
  // The folder just added, and what was picked then, until the projects read again have it: then it
  // is picked, however late that is, unless another pick was made meanwhile, which stays. The panel
  // says it was added until it closes itself or Done closes it, whether the pick came yet or not.
  const [added, setAdded] = useState<{ path: string; over: string | null } | null>(null)
  const [folderError, setFolderError] = useState<string | null>(null)
  // Read again after a folder is added: the daemon has crawled it by then.
  const [folders, setFolders] = useState(0)
  const repos = useLoaded<ReposRead | null>(() => onRepos().catch(() => ({ repos: [], here: [], reposLoading: false, canAddFolder: false })), null, [open, folders])
  // The repos the modules' accounts reach (`composer.where`), less the ones on this computer.
  const where = useWhereRepos(open, repos?.here ?? [], folders)
  const whereLoading = where.some(group => group.loading)
  // This computer's or the modules' lists are still being read: asked again shortly, while the menu is open.
  useEffect(() => {
    if (!open || !(repos?.reposLoading || whereLoading)) return
    const again = setTimeout(() => setFolders(k => k + 1), ASK_AGAIN_MS)
    return () => clearTimeout(again)
  }, [open, repos, whereLoading])

  useEffect(() => {
    if (added === null) return
    if (picked !== added.over) return setAdded(null)
    const project = projects.find(p => p.path === added.path)
    if (!project) return
    setAdded(null)
    onPick(project.id)
  }, [added, picked, projects, onPick])

  const NONE: Row = useMemo(() => ({ value: 'none', label: none.label, pick: { kind: 'none' }, search: '' }), [none.label])
  const projectRows = useMemo<Row[]>(
    () => projects.map(p => ({ value: `project:${p.id}`, label: label(p.id, p.name), pick: { kind: 'project', project: p }, search: p.path })),
    [projects, label],
  )
  const repoRows = useMemo<Row[]>(
    () => [
      ...(repos?.repos ?? []).map((repo): Row => ({ value: `repo:${repo.path}`, label: repo.name, detail: repoDetail(repo), pick: { kind: 'repo', path: repo.path }, search: `${repo.path}\n${repo.url ?? ''}` })),
      // Not on this computer: picked, it is cloned, as an address typed is.
      ...where.flatMap(group =>
        group.repos.map((repo): Row => ({
          value: `hosted:${repo.address}`,
          label: repo.label,
          detail: <Facts facts={[repo.private ? 'Private' : undefined, 'Not on this computer', repo.why]} />,
          pick: { kind: 'hosted', address: repo.address },
          search: `${repo.address}\n${repo.detail ?? ''}`,
        })),
      ),
    ],
    [repos, where],
  )
  // A button that adds one has no "none" to pick: it is what the button says.
  const groups = pickerGroups(look === 'add' ? undefined : NONE, projectRows, repoRows, typed)
  const current = picked === null ? NONE : (projectRows.find(row => row.value === `project:${picked}`) ?? { value: `project:${picked}`, label: pickedName ?? '', pick: { kind: 'none' }, search: '' })
  const shown = current.label
  const loading = useSkeleton(pending)
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
      <button type="button" className={buttonVariants()}>
        <FolderPlus className="h-3.5 w-3.5" aria-hidden />
        {none.label}
      </button>
    ) : look === 'sidebar' ? (
      // A card on the sidebar, as high whatever it shows, so the rows under it never move: the chevrons say it opens.
      <button type="button" className={PROJECT_ROW_CLASS}>
        <span className="flex size-4 shrink-0 items-center justify-center">
          {pending ? null : project ? <ProjectDot project={project} /> : <Layers className="size-4 text-muted-foreground" aria-hidden />}
        </span>
        {/* Until the projects are read, the project the address names is not known: a bar where its
            name goes, rather than "All projects" for a moment. */}
        {loading ? <Skeleton className="h-4 w-24" /> : <span className="flex-1 truncate text-left">{pending ? '' : shown}</span>}
        <ChevronsUpDown className="ml-auto" aria-hidden />
      </button>
    ) : (
      <button type="button" className={cn(rowButtonClass, 'max-w-[16rem]!')}>
        <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{shown}</span>
        <RowChevron />
      </button>
    )
  const trigger = <Combobox.Trigger ref={triggerRef} disabled={busy || pending} aria-label={name} className={MENU_TRIGGER_OPEN_CLASS} render={button} {...search.trigger} {...(look === 'sidebar' ? { 'data-project-picker': '' } : {})} />

  return (
    <>
      <Combobox.Root<Row>
        items={groups}
        filteredItems={groups}
        value={current}
        isItemEqualToValue={sameRow}
        itemToStringLabel={row => row.label}
        autoHighlight
        {...search.root}
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
          <Combobox.Positioner {...position} sideOffset={6} align="start" className="z-50 outline-none">
            <Combobox.Popup data-overlay="picker" aria-label={name} className={cn(MENU_POPUP_CLASS, 'w-[22rem] max-w-[var(--available-width)]')}>
              {/* The field one line tall, 16 in from the band's every edge, as the jump's is. */}
              <div className="flex h-13 items-center gap-3 border-b border-hairline px-4">
                <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Combobox.Input aria-label="Search projects and repos" placeholder="Search, or paste a GitHub address" className="h-5 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              </div>
              <ScrollArea ref={list} style={typed ? { minHeight: untyped.current } : undefined} viewportClassName="max-h-[min(20rem,calc(var(--available-height)-5rem))]">
                <div className={MENU_BODY_CLASS}>
                  <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground empty:hidden">No project or repo by that name.</Combobox.Empty>
                  <Combobox.List>
                    {(group: Group) => (
                      <Combobox.Group key={group.value} items={group.items}>
                        {group.label && <Combobox.GroupLabel className="px-2 pt-2 pb-1 text-xs font-normal text-muted-foreground">{group.label}</Combobox.GroupLabel>}
                        <Combobox.Collection>
                          {(row: Row) => (
                            <Combobox.Item key={row.value} value={row} className={MENU_ITEM_CLASS}>
                              {/* Each row leads with its own mark; the pick is the tick at the row's end. */}
                              {row.pick.kind === 'address' ? (
                                <MenuMark>
                                  <Plus className="size-3.5 text-muted-foreground" aria-hidden />
                                </MenuMark>
                              ) : row.pick.kind === 'none' ? (
                                <MenuMark>
                                  <Layers className="size-3.5 text-muted-foreground" aria-hidden />
                                </MenuMark>
                              ) : row.pick.kind === 'repo' ? (
                                <MenuMark>
                                  <FolderGit2 className="size-3.5 text-muted-foreground" aria-hidden />
                                </MenuMark>
                              ) : row.pick.kind === 'hosted' ? (
                                <MenuMark>
                                  <Cloud className="size-3.5 text-muted-foreground" aria-hidden />
                                </MenuMark>
                              ) : null}
                              {row.pick.kind === 'project' ? (
                                <ProjectLine project={row.pick.project} label={row.label} />
                              ) : (
                                <span className="min-w-0 flex-1 leading-5">
                                  <span className="block truncate">{row.label}</span>
                                  {row.detail && (
                                    <span
                                      data-line2
                                      className="flex min-w-0 text-xs leading-4 text-muted-foreground"
                                      {...(row.pick.kind === 'repo' && typeof row.detail === 'string' ? { title: row.detail } : {})}
                                    >
                                      {/* A repo's path on one line, cut in its middle: where it starts and the folder it ends in show, and
                                          the whole of it is in the title and said to a screen reader. */}
                                      {row.pick.kind === 'repo' && typeof row.detail === 'string' ? <MiddleCut text={row.detail} /> : <span className="min-w-0 truncate">{row.detail}</span>}
                                    </span>
                                  )}
                                </span>
                              )}
                              {row.value === current.value && (
                                <MenuMark>
                                  <Check className="size-3.5" aria-hidden />
                                </MenuMark>
                              )}
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
                  {where.map(group =>
                    group.loading ? (
                      <p key={group.key} role="status" className="px-2 py-1.5 text-xs text-muted-foreground">
                        {`Asking for the repos ${group.label.charAt(0).toLowerCase()}${group.label.slice(1)}…`}
                      </p>
                    ) : group.unreached !== undefined ? (
                      <p key={group.key} className="px-2 py-1.5 text-xs text-muted-foreground">
                        {group.unreached}
                      </p>
                    ) : null,
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
          opener={triggerRef}
          onAdded={path => {
            setAdded({ path, over: picked })
            onProjectAdded()
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </>
  )
}
