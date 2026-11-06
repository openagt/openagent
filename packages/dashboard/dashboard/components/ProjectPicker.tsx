import { useEffect, useMemo, useState } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Check, ChevronDown, Folder, FolderSearch, Search } from 'lucide-react'
import type { ProjectSummary } from '../../src/index.js'
import { SESSIONS_ID } from '../../src/project-address.js'
import { onRepos, sendAddRepoFolder, type ReposRead } from '../rpc/projects.js'
import { useLoaded } from '../lib/use-async.js'
import { useProjectLabel } from '../lib/project-labels.js'
import { cn } from '../lib/utils.js'
import { rowButtonClass } from './ui/row-item.js'
import { ScrollArea } from './ui/scroll-area.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { MENU_ITEM_CLASS, MENU_POPUP_CLASS, MENU_TRIGGER_OPEN_CLASS } from './ui/dropdown-menu.js'
import { AddProjectPanel } from './AddProjectPanel.js'

/** How many repos the menu lists before a search: the search reaches the rest. */
export const REPOS_SHOWN = 20

/** The most rows a search lists. */
const SEARCH_SHOWN = 200

/** A row of the menu: no project, a project, or a repo that is not one yet. */
interface Row {
  value: string
  label: string
  /** Under the label, muted: a repo's address, or its folder when it has none. */
  detail?: string
  pick: { kind: 'none' } | { kind: 'project'; id: string } | { kind: 'repo'; path: string }
  /** What the search matches besides the label. */
  search: string
}

/** A type, not an interface: the combobox takes a group as a record of any fields. */
type Group = {
  value: string
  label?: string
  items: Row[]
}

const NO_PROJECT: Row = { value: 'none', label: 'No project', pick: { kind: 'none' }, search: '' }

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
 * The groups the menu lists for a search: "No project", the projects, then the repos that are not
 * projects. With nothing typed, only the first {@link REPOS_SHOWN} repos; a search finds any of
 * them, by name, folder or address. A group with nothing that matches is not listed.
 */
export function pickerGroups(projects: readonly Row[], repos: readonly Row[], typed: string): Group[] {
  const query = typed.trim().toLowerCase()
  const kept = (rows: readonly Row[], most: number) => (query ? rows.filter(row => matches(row, query)) : rows).slice(0, most)
  return [
    { value: 'none', items: kept([NO_PROJECT], 1) },
    { value: 'projects', label: 'Projects', items: kept(projects, SEARCH_SHOWN) },
    { value: 'repos', label: 'Repos', items: kept(repos, query ? SEARCH_SHOWN : REPOS_SHOWN) },
  ].filter(group => group.items.length > 0)
}

// Where a new session works, in the row above the box on the "New agent session" page (Rom's
// "repos are not projects"): no project, one of the projects, or any repo on this computer. The
// button reads the pick, so where the session starts is on screen with the menu shut.
//
// A project opens its own "New agent session" page; the prompt typed stays in the box. A repo that
// is not a project is asked the trust question Add project asks, for its folder, and on a yes it is
// a project and its page opens: a session works in a project, so the repo is pinned on first use.
//
// The repos are read when the page opens, so the crawl that finds them has run by the time the menu
// is opened, and again each time it opens: an old list is crawled again behind the answer.
export function ProjectPicker({
  projectId,
  projectName,
  projects,
  busy,
  onPick,
  onProjectAdded,
}: {
  /** The project the page is for, or {@link SESSIONS_ID} for no project. */
  projectId: string
  projectName?: string | null | undefined
  projects: readonly ProjectSummary[]
  busy: boolean
  /** Open the "New agent session" page of a project, or of no project ({@link SESSIONS_ID}). */
  onPick: (projectId: string) => void
  /** A repo was added as a project: the projects are to be read again. */
  onProjectAdded: () => void
}) {
  const label = useProjectLabel()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  // The folder just added, until the projects read again have it: then its page opens.
  const [added, setAdded] = useState<string | null>(null)
  const [folderError, setFolderError] = useState<string | null>(null)
  // Read again after a folder is added: the daemon has crawled it by then.
  const [folders, setFolders] = useState(0)
  const repos = useLoaded<ReposRead | null>(() => onRepos().catch(() => ({ repos: [], canAddFolder: false })), null, [open, folders])

  useEffect(() => {
    if (added === null) return
    const project = projects.find(p => p.path === added && p.machine === undefined)
    if (!project) return
    setAdded(null)
    setAdding(null)
    onPick(project.id)
  }, [added, projects, onPick])

  const projectRows = useMemo<Row[]>(
    () => projects.map(p => ({ value: `project:${p.id}`, label: label(p.id, p.name), pick: { kind: 'project', id: p.id }, search: p.machine === undefined ? p.path : '' })),
    [projects, label],
  )
  const repoRows = useMemo<Row[]>(
    () => (repos?.repos ?? []).map(repo => ({ value: `repo:${repo.path}`, label: repo.name, detail: repo.url ? shownAddress(repo.url) : repo.path, pick: { kind: 'repo', path: repo.path }, search: `${repo.path}\n${repo.url ?? ''}` })),
    [repos],
  )
  const groups = pickerGroups(projectRows, repoRows, typed)
  const noProject = projectId === SESSIONS_ID
  const picked = noProject ? NO_PROJECT : (projectRows.find(row => row.value === `project:${projectId}`) ?? { value: `project:${projectId}`, label: projectName ?? '', pick: { kind: 'project', id: projectId }, search: '' })
  const shown = noProject ? 'No project' : projectName
  // No project word until the name is known, never a wrong one.
  if (!shown) return null

  const addFolder = async () => {
    setFolderError(null)
    const outcome = await sendAddRepoFolder().catch(() => ({ ok: false as const, error: 'Could not reach the daemon.' }))
    if (!outcome.ok) setFolderError(outcome.error)
    else if (outcome.added) setFolders(k => k + 1)
  }

  return (
    <>
      <Combobox.Root<Row>
        items={groups}
        filteredItems={groups}
        value={picked}
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
          if (row.pick.kind === 'none') onPick(SESSIONS_ID)
          else if (row.pick.kind === 'project') onPick(row.pick.id)
          else setAdding(row.pick.path)
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Combobox.Trigger
                disabled={busy}
                aria-label="The session works in"
                className={MENU_TRIGGER_OPEN_CLASS}
                render={
                  <button type="button" className={cn(rowButtonClass, 'max-w-[16rem]!')}>
                    <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{shown}</span>
                    <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                  </button>
                }
              />
            }
          />
          <TooltipContent>{noProject ? 'The session works in a folder of its own' : `The session works in ${shown}`}</TooltipContent>
        </Tooltip>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={6} align="start" className="z-50 outline-none">
            <Combobox.Popup aria-label="The session works in" className={cn(MENU_POPUP_CLASS, 'w-[24rem] max-w-[var(--available-width)]')}>
              <div className="flex items-center gap-2 border-b border-border px-3">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <Combobox.Input aria-label="Search projects and repos" placeholder="Search projects and repos" className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
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
                              <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', row.value === picked.value ? 'opacity-100' : 'opacity-0')} aria-hidden />
                              <span className="min-w-0 leading-tight">
                                <span className="block truncate">{row.label}</span>
                                {row.detail && <span className="block truncate text-xs text-muted-foreground">{row.detail}</span>}
                              </span>
                            </Combobox.Item>
                          )}
                        </Combobox.Collection>
                      </Combobox.Group>
                    )}
                  </Combobox.List>
                  {repos === null ? (
                    <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">Looking for repos on this computer…</p>
                  ) : !typed.trim() && repos.repos.length > REPOS_SHOWN ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">Search to see more of the {repos.repos.length} repos.</p>
                  ) : null}
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
          folder={adding}
          onAdded={() => {
            setAdded(adding)
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
