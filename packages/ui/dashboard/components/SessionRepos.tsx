import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Check, FolderGit2, Layers, Search } from 'lucide-react'
import type { ProjectSummary } from '../../src/index.js'
import { onRepos, type ReposRead } from '../rpc/projects.js'
import { useLoaded } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { BoxOfRow, rowButtonClass } from './ui/row-item.js'
import { ScrollArea } from './ui/scroll-area.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, MENU_BODY_CLASS, MENU_ITEM_CLASS, MENU_POPUP_CLASS, MENU_TRIGGER_OPEN_CLASS, MenuMark } from './ui/dropdown-menu.js'
import { usePopupPosition } from './ui/popup-placement.js'
import { usePickerSearch } from './ui/picker-search.js'
import { ASK_AGAIN_MS, REPOS_SHOWN, repoDetail } from './ProjectPicker.js'
import { MiddleCut } from './MiddleCut.js'

/** The room the menu takes over the box at its full height: its search, its list (20rem) and the page's edge. */
const ROOM_ABOVE_PX = 400

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
 * The groups the menu lists for a search: the projects of this computer, then the repos that are
 * no project, the picked ones among them. With nothing typed, only the first {@link REPOS_SHOWN}
 * repos and every picked one; a search finds any of them, by name, folder or address.
 */
export function repoGroups(projects: readonly Row[], repos: readonly Row[], picked: readonly PickedRepo[], typed: string): Group[] {
  const query = typed.trim().toLowerCase()
  const isPicked = (row: Row) => picked.some(repo => repo.path === row.path)
  const kept = (rows: readonly Row[], most: number) => {
    const matching = rows.filter(row => !query || `${row.label}\n${row.search}`.toLowerCase().includes(query))
    const shown = new Set(matching.slice(0, most))
    return matching.filter(row => shown.has(row) || isPicked(row))
  }
  return [
    { value: 'projects', label: 'Projects', items: kept(projects, SEARCH_SHOWN) },
    { value: 'repos', label: 'Repos', items: kept(repos, query ? SEARCH_SHOWN : REPOS_SHOWN) },
  ].filter(group => group.items.length > 0)
}

/** The files of a project's Context in the menu, set apart from the repos by a hairline: before them, or after. */
function filesPart(list: ReactNode, place: 'first' | 'last'): ReactNode {
  const line = <div role="separator" className="mx-2 my-1 h-px bg-hairline" />
  return (
    <>
      {place === 'last' && line}
      <p className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground">Files</p>
      {list}
      {place === 'first' && line}
    </>
  )
}

/** What the Context button's hover says of a session's repos, with or without any. */
export function reposSaid(names: readonly string[]): string {
  return names.length === 0 ? "Repos to copy into the session's folder" : `Copied into the session's folder: ${names.join(', ')}`
}

/** How many repos, in words: what stands on the Context button after its name. */
const counted = (count: number): string => `${count} repo${count === 1 ? '' : 's'}`

// The Context menu under the box, one on both pages (his pick, over "Add repo" and a chip per repo
// in the row above the box, and over a project's own shorter list): the repos the session works
// with (Rom's "repos are just context"), ticked on and off, as many as wanted, from the projects
// of this computer and the repos the picker lists. The button says how many, and its hover their
// names. A tick does the same with a project and with none, and the menu's heading says it: the
// run copies the repo into the session's folder, and leaves the repo's own folder as it was. A
// project's menu lists the files picked for it over the repos (`files`, ContextMenu.tsx).
export function ReposMenu({
  picked,
  projects,
  busy,
  onChange,
  without,
  files,
}: {
  picked: readonly PickedRepo[]
  projects: readonly ProjectSummary[]
  busy: boolean
  onChange: (picked: PickedRepo[]) => void
  /** A folder left out of the list: the session's own project. */
  without?: string | undefined
  /** The files picked beside the repos: how many, said on the button, and their list. */
  files?: { count: number; list: ReactNode } | undefined
}) {
  const search = usePickerSearch()
  const { open, typed } = search
  const position = usePopupPosition()
  // Above the box on its left edge, as the gear's menu, where the page has the room over the box for its whole
  // height; under its own button otherwise, as on a launcher whose box stands high: turned under the box, it
  // would cover the row it was opened from.
  const box = useContext(BoxOfRow)
  const above = open && box?.current != null && box.current.getBoundingClientRect().top >= ROOM_ABOVE_PX
  // Asked again shortly while the look through this computer is still on its way, and the menu is open.
  const [again, setAgain] = useState(0)
  const repos = useLoaded<ReposRead | null>(() => onRepos().catch(() => ({ repos: [], here: [], reposLoading: false, canAddFolder: false })), null, [open, again])
  useEffect(() => {
    if (!open || !repos?.reposLoading) return
    const later = setTimeout(() => setAgain(k => k + 1), ASK_AGAIN_MS)
    return () => clearTimeout(later)
  }, [open, repos])
  const projectRows = useMemo<Row[]>(
    () => projects.filter(p => p.path !== without).map(p => ({ value: `project:${p.id}`, label: folderName(p.path), detail: p.path, path: p.path, search: p.path })),
    [projects, without],
  )
  const repoRows = useMemo<Row[]>(
    () => (repos?.repos ?? []).filter(repo => repo.path !== without).map(repo => ({ value: `repo:${repo.path}`, label: repo.name, detail: repoDetail(repo), path: repo.path, search: `${repo.path}\n${repo.url ?? ''}` })),
    [repos, without],
  )
  const groups = repoGroups(projectRows, repoRows, picked, typed)
  // The picked ones as the menu's rows: a row is the same repo as a pick by its folder.
  const pickedRows = picked.map<Row>(repo => ({ value: `picked:${repo.path}`, label: repo.name, detail: repo.path, path: repo.path, search: repo.path }))
  // What is picked, on the button after its name: the repos, then the files.
  const counts = [picked.length > 0 ? counted(picked.length) : null, files && files.count > 0 ? `${files.count} file${files.count === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')

  return (
    <Combobox.Root<Row, true>
      multiple
      items={groups}
      filteredItems={groups}
      value={pickedRows}
      isItemEqualToValue={(row, pick) => row.path === pick.path}
      itemToStringLabel={row => row.label}
      autoHighlight
      {...search.root}
      onValueChange={rows => onChange(rows.map(row => ({ path: row.path, name: folderName(row.path) })))}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Combobox.Trigger
              disabled={busy}
              aria-label={counts ? `Context: ${counts}` : 'Context'}
              className={MENU_TRIGGER_OPEN_CLASS}
              {...search.trigger}
              render={
                <button type="button" className={rowButtonClass}>
                  <Layers className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">
                    Context{counts && <span className="text-primary"> · {counts}</span>}
                  </span>
                </button>
              }
            />
          }
        />
        <TooltipContent>{reposSaid(picked.map(repo => repo.name))}</TooltipContent>
      </Tooltip>
      <Combobox.Portal>
        <Combobox.Positioner {...position} {...(above ? { anchor: box, side: 'top' as const } : {})} sideOffset={6} align="start" className="z-50 outline-none">
          <Combobox.Popup data-overlay="picker" aria-label="Context" className={cn(MENU_POPUP_CLASS, 'w-[24rem] max-w-[var(--available-width)]')}>
            {/* The field one line tall, 16 in from the band's every edge, as the jump's is. */}
            <div className="flex h-13 items-center gap-3 border-b border-hairline px-4">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <Combobox.Input aria-label="Search repos" placeholder="Search repos" className="h-5 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            <ScrollArea viewportClassName="h-[min(20rem,calc(var(--available-height)-5rem))]">
              <div className={MENU_BODY_CLASS}>
                {/* What a tick does. */}
                {/* The picked files first: under some sixty repos they would be out of sight. */}
                {files && files.count > 0 && filesPart(files.list, 'first')}
                <p className="px-2 pt-1 pb-0.5 text-xs text-muted-foreground">Repos copied into the session's folder</p>
                <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground empty:hidden">{repos === null ? '' : 'No repo by that name.'}</Combobox.Empty>
                <Combobox.List>
                  {(group: Group) => (
                    <Combobox.Group key={group.value} items={group.items}>
                      <Combobox.GroupLabel className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground">{group.label}</Combobox.GroupLabel>
                      <Combobox.Collection>
                        {(row: Row) => (
                          <Combobox.Item key={row.value} value={row} className={MENU_ITEM_CLASS}>
                            <MenuMark>
                              <FolderGit2 className="size-3.5" aria-hidden />
                            </MenuMark>
                            <span className="min-w-0 flex-1 leading-5">
                              <span className="block truncate">{row.label}</span>
                              {/* Its path on one line, cut in its middle: where it starts and the folder it ends in show, and the
                                  whole of it is in the title and said to a screen reader. */}
                              <span data-line2 title={row.detail} className="flex min-w-0 text-xs leading-4 text-muted-foreground">
                                <MiddleCut text={row.detail} />
                              </span>
                            </span>
                            {/* The picked one is marked at the right, where every menu's mark stands. */}
                            <MenuMark className="w-4 justify-center">
                              <Combobox.ItemIndicator>
                                <Check className="size-4" aria-hidden />
                              </Combobox.ItemIndicator>
                            </MenuMark>
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
                {/* With none picked, how to pick one, last: nothing to look for. */}
                {files && files.count === 0 && filesPart(files.list, 'last')}
              </div>
            </ScrollArea>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}

/**
 * The Context of a session on its own page: the launcher's button in the launcher's place, and a
 * menu above the box as the launcher's is (his pick, over words with a hover: the same control on
 * both pages). It lists the repos the session started with, each ticked, with where it was copied
 * from. A session keeps them, so the rows are said, not offered, and the menu's heading says so.
 * A session in a project has the files picked for its next message too (`files`), counted on the
 * button and listed as the launcher lists them.
 */
export function SessionReposSaid({ repos, files }: { repos: readonly { name: string; from: string }[]; files?: { count: number; list: ReactNode } | undefined }) {
  const box = useContext(BoxOfRow)
  const counts = [repos.length > 0 ? counted(repos.length) : null, files && files.count > 0 ? `${files.count} file${files.count === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger type="button" aria-label={counts ? `Context: ${counts}` : 'Context'} className={rowButtonClass} />}>
          <Layers className="size-4 shrink-0" aria-hidden />
          <span className="truncate">
            Context{counts && <span className="text-primary"> · {counts}</span>}
          </span>
        </TooltipTrigger>
        <TooltipContent>{repos.length === 0 ? 'This session started with no repo' : `Copies in this session's folder: ${repos.map(repo => repo.name).join(', ')}`}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" {...(box ? { anchor: box, side: 'top' as const } : {})} className="w-[24rem] max-w-[var(--available-width)]">
        {files && files.count > 0 && filesPart(files.list, 'first')}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">Repos copied into this session's folder when it started</DropdownMenuLabel>
          {repos.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">None: this session started with no repo.</p>
          ) : (
            repos.map(repo => (
              <DropdownMenuItem key={repo.name} closeOnClick={false} aria-disabled className="cursor-default">
                <MenuMark>
                  <FolderGit2 className="size-3.5" aria-hidden />
                </MenuMark>
                <span className="min-w-0 flex-1 leading-5">
                  <span className="block truncate">{repo.name}</span>
                  <span data-line2 title={repo.from} className="flex min-w-0 text-xs leading-4 text-muted-foreground">
                    <MiddleCut text={repo.from} />
                  </span>
                </span>
                <MenuMark className="w-4 justify-center">
                  <Check className="size-4" aria-hidden />
                </MenuMark>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
        {files && files.count === 0 && filesPart(files.list, 'last')}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
