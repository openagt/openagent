import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Cloud, Folder, FolderGit2, FolderSearch, Layers, Plus, Search, Sparkles } from 'lucide-react'
import {
  cn,
  Combobox,
  Facts,
  MENU_BODY_CLASS,
  MENU_ITEM_CLASS,
  MENU_POPUP_CLASS,
  MENU_TRIGGER_OPEN_CLASS,
  MenuMark,
  MiddleCut,
  rowButtonClass,
  RowChevron,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useLoaded,
  useModuleHost,
  useOptionsAt,
  usePickerSearch,
  usePopupPosition,
  useProjectLabel,
  useProjects,
  type ProjectSummary,
  type ModuleHost,
  type UiComposerControlProps,
  type UiHost,
  type UiWhereRepo,
} from '@openagt/ui/module'
import { addressOfRemote, typedRepository } from '@openagt/hooks/repository-address'
import type { ReposRead } from '../src/server.js'
import { addFolderToSearch, readRepos } from './calls.js'
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
  detail?: ReactNode
  pick: { kind: 'none' } | { kind: 'project'; project: ProjectSummary } | { kind: 'repo'; path: string } | { kind: 'where'; address: string } | { kind: 'address'; typed: string }
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
 * The groups the menu lists for a search: the first row (no project), the projects, then each
 * module's repos (`composer.where`) under its own heading: the repos on this computer that are not
 * projects (this module's), and those a module's accounts reach. With nothing typed, only the first
 * {@link REPOS_SHOWN} repos of each; a search finds any of them, by name, folder or address. A
 * group with nothing that matches is not listed. Typed as a repository's address that no row has,
 * one more row offers to add it: cloned here and made a project, as the Add-by-address way did.
 */
function pickerGroups(none: Row, projects: readonly Row[], where: readonly Group[], typed: string): Group[] {
  const query = typed.trim().toLowerCase()
  const kept = (rows: readonly Row[], most: number) => (query ? rows.filter(row => matches(row, query)) : rows).slice(0, most)
  const address = typedRepository(typed)?.address
  const known = address !== undefined && [...projects, ...where.flatMap(group => group.items)].some(row => row.search.toLowerCase().includes(address))
  const add: Row[] = address !== undefined && !known ? [{ value: `address:${address}`, label: `Add ${address}`, detail: 'Cloned to this computer, as a project', pick: { kind: 'address', typed: typed.trim() }, search: '' }] : []
  const groups: Group[] = [
    { value: 'none', items: kept([none], 1) },
    { value: 'projects', label: 'Projects', items: kept(projects, SEARCH_SHOWN) },
    ...where.map(group => ({ ...group, items: kept(group.items, query ? SEARCH_SHOWN : REPOS_SHOWN) })),
    { value: 'address', items: add },
  ]
  return groups.filter(group => group.items.length > 0)
}

/** What a module's repos (`composer.where`) answered: its heading, its repos, and whether it is still reading or could not. */
interface WhereRead {
  key: string
  label: string
  /** What is said while it is still reading. */
  loadingWords: string
  repos: UiWhereRepo[]
  loading: boolean
  unreached?: string
}

/** A project's state as a dot: red when a module says something needs fixing there (#1500). */
export function ProjectDot({ project }: { project: ProjectSummary }) {
  return <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', project.errors?.length ? 'bg-danger' : 'bg-primary')} />
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

/** A project's row: its dot, its name, and under it what is wrong with it, or what the modules note of it. */
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
        {/* Nothing wrong: what the modules note under its name (why its data stays on this machine). */}
        {!project.errors?.length &&
          project.notes?.map(note => (
            <span key={note.id} data-line2 className="block truncate text-xs leading-4 text-muted-foreground">
              {note.words}
            </span>
          ))}
      </span>
    </>
  )
}


/**
 * What a module's repo says after its name: one on this computer its own words; one only at an
 * address whether only some can see it, that it is not on this computer, and why it is listed.
 */
function detailOf(repo: UiWhereRepo): ReactNode {
  if (repo.folder !== undefined) return repo.detail
  return <Facts facts={[repo.private ? 'Private' : undefined, 'Not on this computer', repo.why]} />
}

/**
 * The repos every module offers (`composer.where`): read as the picker is drawn, each time its menu
 * opens or `again` changes, and again shortly while the menu is open and one is still being read.
 * A module whose read fails lists nothing, and says it could not be read.
 */
function useWhere(open: boolean, again: number, known: ReadonlySet<string>): WhereRead[] {
  const where = useOptionsAt('composer.where', undefined)
  const [read, setRead] = useState<WhereRead[]>([])
  const [more, setMore] = useState(0)
  // Read as the picker is drawn, so the crawl that finds this computer's repos has run by the time the menu opens.
  useEffect(() => {
    if (where.length === 0) return
    let live = true
    void Promise.all(
      where.map(async ({ option, host }): Promise<WhereRead> => {
        const key = `${option.package}/${option.id}`
        const loadingWords = option.loadingWords ?? `${option.label}: still being read…`
        try {
          const answer = await option.repos(host)
          return { key, label: option.label, loadingWords, repos: answer.repos, loading: answer.loading === true, ...(answer.unreached !== undefined ? { unreached: answer.unreached } : {}) }
        } catch {
          return { key, label: option.label, loadingWords, repos: [], loading: false, unreached: `${option.label} could not be read: its repos are not listed.` }
        }
      }),
    ).then(answers => live && setRead(answers))
    return () => {
      live = false
    }
  }, [open, where, again, more])
  useEffect(() => {
    if (!open || !read.some(one => one.loading)) return
    const timer = setTimeout(() => setMore(n => n + 1), ASK_AGAIN_MS)
    return () => clearTimeout(timer)
  }, [open, read])
  // A repository here already, as a repo or a project, is listed once: by its folder.
  const here = new Set([...known, ...read.flatMap(one => one.repos.flatMap(repo => (repo.folder !== undefined && repo.address !== undefined ? [repo.address.toLowerCase()] : [])))])
  return read.map(one => ({ ...one, repos: one.repos.filter(repo => repo.folder !== undefined || repo.address === undefined || !here.has(repo.address.toLowerCase())) }))
}

/** This computer's repos that are not projects yet, as the picker lists a module's (`composer.where`): each by its folder. */
export async function reposHere(host: UiHost): Promise<{ repos: UiWhereRepo[]; loading: boolean }> {
  const read = await readRepos(host as unknown as ModuleHost)
  return {
    repos: read.repos.map(repo => {
      const address = repo.url ? addressOfRemote(repo.url) : undefined
      return { folder: repo.path, label: repo.name, detail: repoDetail(repo), ...(address !== undefined ? { address } : {}) }
    }),
    loading: read.loading,
  }
}

// The project picker of the launcher, in the row above its box (Rom's "repos are not projects"):
// where a session works — no project, one of the projects, any repo on this computer, or one a
// module's accounts reach (`composer.where`). The menu is the first row, the projects with their
// lines, the repos searchable, "Search another folder…" to look in one more folder, and a
// repository's address typed into the search offered to add. The button reads the pick, so it is
// on screen with the menu shut.
//
// A repo that is not a project is asked the trust question for its folder, and on a yes it is a
// project (a sticky repo) and picked: the session works in it. The repos are read when the picker
// is drawn, so the crawl that finds them has run by the time the menu is opened, and again each
// time it opens: an old list is crawled again behind the answer.
export function ProjectPicker({
  picked,
  busy = false,
  none,
  onPick,
}: {
  /** The project picked, or null for none. */
  picked: string | null
  busy?: boolean
  /** The first row: what no project means here. */
  /**
   * The first row: what no project means here. `row` is that row in the list where it says more
   * than the button (its words and a line under them), and `agent` marks the pick where the agent
   * picks the project (his words "Agent picks").
   */
  none: { label: string; tip: string; row?: { label: string; detail: string }; agent?: boolean }
  /** A project, or none, was picked. */
  onPick: (projectId: string | null) => void
}) {
  const host = useModuleHost()
  const projects = useProjects()
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
  // Read again after a folder is added: the crawl has looked in it by then.
  const [folders, setFolders] = useState(0)
  // What this computer can do (a folder dialog), and the projects' addresses, which a module's repo at one is not listed under.
  const here = useLoaded<ReposRead | null>(() => readRepos(host).catch(() => null), null, [open, folders])
  const known = useMemo(() => new Set(here?.projects ?? []), [here])
  const where = useWhere(open, folders, known)

  useEffect(() => {
    if (added === null) return
    if (picked !== added.over) return setAdded(null)
    const project = projects.find(p => p.path === added.path)
    if (!project) return
    setAdded(null)
    onPick(project.id)
  }, [added, picked, projects, onPick])

  const NONE: Row = useMemo(
    () => ({ value: 'none', label: none.row?.label ?? none.label, ...(none.row ? { detail: none.row.detail } : {}), pick: { kind: 'none' }, search: '' }),
    [none.label, none.row?.label, none.row?.detail],
  )
  const projectRows = useMemo<Row[]>(
    () => projects.map(p => ({ value: `project:${p.id}`, label: label(p.id, p.name), pick: { kind: 'project', project: p }, search: p.path })),
    [projects, label],
  )
  // A folder here is added as it is; one only at an address is cloned, as an address typed is.
  const whereGroups = useMemo<Group[]>(
    () =>
      where.map(one => ({
        value: `where:${one.key}`,
        label: one.label,
        items: one.repos.map(
          (repo): Row => ({
            value: repo.folder !== undefined ? `repo:${repo.folder}` : `where:${repo.address}`,
            label: repo.label,
            ...(detailOf(repo) !== undefined ? { detail: detailOf(repo) } : {}),
            pick: repo.folder !== undefined ? { kind: 'repo', path: repo.folder } : { kind: 'where', address: repo.address ?? '' },
            search: `${repo.folder ?? ''}\n${repo.address ?? ''}\n${repo.detail ?? ''}`,
          }),
        ),
      })),
    [where],
  )
  const groups = pickerGroups(NONE, projectRows, whereGroups, typed)
  const current = picked === null ? NONE : (projectRows.find(row => row.value === `project:${picked}`) ?? { value: `project:${picked}`, label: '', pick: { kind: 'none' }, search: '' })
  // The button says the pick in its own words: the list's row may say more.
  const shown = picked === null ? none.label : current.label
  // No project word until the name is known, never a wrong one.
  if (!shown) return null

  const addFolder = async () => {
    setFolderError(null)
    const outcome = await addFolderToSearch(host).catch(() => ({ ok: false as const, error: 'Could not reach the daemon.' }))
    if (!outcome.ok) setFolderError(outcome.error)
    else if (outcome.added) setFolders(k => k + 1)
  }

  const name = 'The session works in'
  const button = (
    <button type="button" className={cn(rowButtonClass, 'max-w-[16rem]!')}>
      {picked === null && none.agent ? <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      <span className="truncate">{shown}</span>
      <RowChevron />
    </button>
  )
  const trigger = <Combobox.Trigger ref={triggerRef} disabled={busy} aria-label={name} className={MENU_TRIGGER_OPEN_CLASS} render={button} {...search.trigger} />

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
          else if (row.pick.kind === 'where') setAdding({ address: row.pick.address })
          else setAdding({ address: row.pick.typed })
        }}
      >
        <Tooltip>
          <TooltipTrigger render={trigger} />
          <TooltipContent>{picked === null ? none.tip : `The session works in ${shown}`}</TooltipContent>
        </Tooltip>
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
                                  {none.agent ? <Sparkles className="size-3.5 text-muted-foreground" aria-hidden /> : <Layers className="size-3.5 text-muted-foreground" aria-hidden />}
                                </MenuMark>
                              ) : row.pick.kind === 'repo' ? (
                                <MenuMark>
                                  <FolderGit2 className="size-3.5 text-muted-foreground" aria-hidden />
                                </MenuMark>
                              ) : row.pick.kind === 'where' ? (
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
                                      {/* The agent's pick says what it does whole, over two lines where it needs them. */}
                                      {row.pick.kind === 'repo' && typeof row.detail === 'string' ? <MiddleCut text={row.detail} /> : row.pick.kind === 'none' ? <span className="min-w-0">{row.detail}</span> : <span className="min-w-0 truncate">{row.detail}</span>}
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
                  {where.map(one =>
                    one.loading ? (
                      <p key={one.key} role="status" className="px-2 py-1.5 text-xs text-muted-foreground">
                        {one.loadingWords}
                      </p>
                    ) : !typed.trim() && one.repos.length > REPOS_SHOWN ? (
                      <p key={one.key} className="px-2 py-1.5 text-xs text-muted-foreground">
                        Search to see more of the {one.repos.length} repos.
                      </p>
                    ) : one.unreached ? (
                      <p key={one.key} className="px-2 py-1.5 text-xs text-muted-foreground">
                        {one.unreached}
                      </p>
                    ) : null,
                  )}
                </div>
              </ScrollArea>
              {here?.canAddFolder && (
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
          onAdded={path => setAdded({ path, over: picked })}
          onClose={() => setAdding(null)}
        />
      )}
    </>
  )
}

/**
 * The picker as the launcher's control (`composer.control` at `start`): where the next session
 * works, a pick moving the launcher to that project, or to none, with what is typed. A session's
 * box says its project elsewhere, and a profile is for any project: neither has it.
 */
export function ProjectControl({ in: box, projectId, busy, pickProject }: UiComposerControlProps) {
  const projects = useProjects()
  const label = useProjectLabel()
  if (box !== 'launcher' || !pickProject) return null
  // The first pick: the agent picks the project the task needs, from the person's, and asks when it cannot tell (Rom 11-22; his words C, 11-25).
  const none = { label: 'Agent picks', tip: 'The agent picks the project your task needs, and asks you when it can\u2019t tell', row: { label: 'Agent picks the project', detail: agentPicksDetail(projects.map(project => label(project.id, project.name))) }, agent: true }
  return <ProjectPicker none={none} picked={projectId ?? null} busy={busy} onPick={id => pickProject(id ?? undefined)} />
}

/**
 * What the agent's pick says under its name (his pick C, 11-25): the projects it picks from, by
 * name, the first few and how many more, and that it asks when it cannot tell.
 */
export function agentPicksDetail(names: readonly string[]): string {
  if (names.length === 0) return 'From the projects you add, by your task. It asks you when it can\u2019t tell.'
  const shown = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : [...names]
  const said = shown.length === 1 ? shown[0]! : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)!}`
  return `From ${said}, by your task. It asks you when it can\u2019t tell.`
}
