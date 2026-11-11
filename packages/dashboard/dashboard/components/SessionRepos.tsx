import { useEffect, useMemo, useState } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { FolderGit2, Plus, Search, X } from 'lucide-react'
import type { ProjectSummary } from '../../src/index.js'
import { onRepos, type ReposRead } from '../rpc/projects.js'
import { useLoaded } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { rowButtonClass, rowItemClass, RowOff } from './ui/row-item.js'
import { ScrollArea } from './ui/scroll-area.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { MENU_ITEM_CLASS, MENU_POPUP_CLASS, MENU_TRIGGER_OPEN_CLASS } from './ui/dropdown-menu.js'
import { usePopupPlacement } from './ui/popup-placement.js'
import { ASK_AGAIN_MS, REPOS_SHOWN, repoDetail } from './ProjectPicker.js'

/** The most rows a search lists. */
const SEARCH_SHOWN = 200

/** A repo picked as a session's context: its folder on this computer, and the name its copy in the session's folder has. */
export interface PickedRepo {
  path: string
  name: string
}

/** The name a folder's copy has in a session's folder: the folder's own name, as the run that copies it names it. */
export function folderName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
}

/** A row of the menu: a repo, a project's or one that is no project. */
interface Row {
  value: string
  label: string
  /** Under the label, muted: the repo's address, or its folder when it has none. */
  detail: string
  path: string
  /** What the search matches besides the label. */
  search: string
}

type Group = {
  value: string
  label: string
  items: Row[]
}

/**
 * The groups "Add repo" lists for a search: the projects of this computer, then the repos that are
 * no project, each without the ones already picked. With nothing typed, only the first
 * {@link REPOS_SHOWN} repos; a search finds any of them, by name, folder or address.
 */
export function addRepoGroups(projects: readonly Row[], repos: readonly Row[], picked: readonly PickedRepo[], typed: string): Group[] {
  const query = typed.trim().toLowerCase()
  const kept = (rows: readonly Row[], most: number) =>
    rows
      .filter(row => !picked.some(repo => repo.path === row.path))
      .filter(row => !query || `${row.label}\n${row.search}`.toLowerCase().includes(query))
      .slice(0, most)
  return [
    { value: 'projects', label: 'Projects', items: kept(projects, SEARCH_SHOWN) },
    { value: 'repos', label: 'Repos', items: kept(repos, query ? SEARCH_SHOWN : REPOS_SHOWN) },
  ].filter(group => group.items.length > 0)
}

// The repos a session with no project has as context, in the row above the box after "No project"
// (Rom's "repos are just context"): each picked one is a chip, and "Add repo" adds another, from
// the projects of this computer and the repos the picker lists. A repo added here stays no project:
// the run copies it into the session's folder, and leaves the repo's own folder as it was.
export function SessionRepoPicks({
  picked,
  projects,
  busy,
  onChange,
}: {
  picked: readonly PickedRepo[]
  projects: readonly ProjectSummary[]
  busy: boolean
  onChange: (picked: PickedRepo[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const positionMethod = usePopupPlacement()
  // Asked again shortly while the look through this computer is still on its way, and the menu is open.
  const [again, setAgain] = useState(0)
  const repos = useLoaded<ReposRead | null>(() => onRepos().catch(() => ({ repos: [], hosted: [], reposLoading: false, hostedLoading: false, canAddFolder: false })), null, [open, again])
  useEffect(() => {
    if (!open || !repos?.reposLoading) return
    const later = setTimeout(() => setAgain(k => k + 1), ASK_AGAIN_MS)
    return () => clearTimeout(later)
  }, [open, repos])
  const projectRows = useMemo<Row[]>(
    () => projects.filter(p => p.machine === undefined).map(p => ({ value: `project:${p.id}`, label: folderName(p.path), detail: p.path, path: p.path, search: p.path })),
    [projects],
  )
  const repoRows = useMemo<Row[]>(
    () => (repos?.repos ?? []).map(repo => ({ value: `repo:${repo.path}`, label: repo.name, detail: repoDetail(repo), path: repo.path, search: `${repo.path}\n${repo.url ?? ''}` })),
    [repos],
  )
  const groups = addRepoGroups(projectRows, repoRows, picked, typed)

  return (
    <>
      {picked.map(repo => (
        <RepoChip key={repo.path} repo={repo} tip={repo.path} onRemove={busy ? undefined : () => onChange(picked.filter(other => other.path !== repo.path))} />
      ))}
      <Combobox.Root<Row>
        items={groups}
        filteredItems={groups}
        value={null}
        itemToStringLabel={row => row.label}
        inputValue={typed}
        autoHighlight
        onInputValueChange={setTyped}
        open={open}
        onOpenChange={next => {
          setOpen(next)
          if (!next) setTyped('')
        }}
        onValueChange={row => {
          if (row) onChange([...picked, { path: row.path, name: folderName(row.path) }])
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Combobox.Trigger
                disabled={busy}
                aria-label="Add repo"
                className={MENU_TRIGGER_OPEN_CLASS}
                render={
                  <button type="button" className={cn(rowButtonClass, 'shrink-0')}>
                    <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">Add repo</span>
                  </button>
                }
              />
            }
          />
          <TooltipContent>A copy of the repo in the session's folder, on a branch of its own</TooltipContent>
        </Tooltip>
        <Combobox.Portal>
          <Combobox.Positioner positionMethod={positionMethod} sideOffset={6} align="start" className="z-50 outline-none">
            <Combobox.Popup aria-label="Add repo" className={cn(MENU_POPUP_CLASS, 'w-[24rem] max-w-[var(--available-width)]')}>
              <div className="flex items-center gap-2 border-b border-border px-3">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <Combobox.Input aria-label="Search repos" placeholder="Search repos" className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              </div>
              <ScrollArea viewportClassName="h-[min(20rem,calc(var(--available-height)-5rem))]">
                <div className="p-1">
                  <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground empty:hidden">{repos === null ? '' : 'No repo by that name.'}</Combobox.Empty>
                  <Combobox.List>
                    {(group: Group) => (
                      <Combobox.Group key={group.value} items={group.items}>
                        <Combobox.GroupLabel className="px-2 pt-2 pb-1 text-xs font-normal text-muted-foreground">{group.label}</Combobox.GroupLabel>
                        <Combobox.Collection>
                          {(row: Row) => (
                            <Combobox.Item key={row.value} value={row} className={cn(MENU_ITEM_CLASS, 'items-start')}>
                              <FolderGit2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                              <span className="min-w-0 leading-tight">
                                <span className="block truncate">{row.label}</span>
                                <span className="block truncate text-xs text-muted-foreground">{row.detail}</span>
                              </span>
                            </Combobox.Item>
                          )}
                        </Combobox.Collection>
                      </Combobox.Group>
                    )}
                  </Combobox.List>
                  {repos === null || repos.reposLoading ? (
                    <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">Looking for repos on this computer…</p>
                  ) : !typed.trim() && repos.repos.length > REPOS_SHOWN ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">Search to see more of the {repos.repos.length} repos.</p>
                  ) : null}
                </div>
              </ScrollArea>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </>
  )
}

/**
 * A repo of a session's, in the row above the box: its name, and what its hover says. With
 * `onRemove`, a ✕ takes it out (the "New agent session" page); without, it only says it (a
 * session's own page, which keeps the repos it started with).
 */
export function RepoChip({ repo, tip, onRemove }: { repo: { name: string }; tip: string; onRemove?: (() => void) | undefined }) {
  if (!onRemove) {
    return (
      <RowOff tip={tip}>
        <span className={rowItemClass}>
          <FolderGit2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{repo.name}</span>
        </span>
      </RowOff>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn(rowItemClass, 'gap-1 pr-1')} />}>
        <FolderGit2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{repo.name}</span>
        <button type="button" aria-label={`Remove ${repo.name}`} onClick={onRemove} className="rounded-sm p-0.5 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <X className="h-3 w-3" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}
