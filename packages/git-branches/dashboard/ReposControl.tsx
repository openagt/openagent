import { useContext, useEffect, useMemo, useState } from 'react'
import { Check, FolderGit2, Lock, Plus, Search, X } from 'lucide-react'
import {
  BoxOfRow,
  cn,
  Combobox,
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
  useOptionsAt,
  usePickerSearch,
  usePopupPosition,
  useProjects,
  type ProjectSummary,
  type UiComposerControlProps,
} from '@openagt/ui/module'
import type { RunOptions } from '@openagt/hooks'
import { folderName, nameRepos, type SessionRepo } from '../src/repo-names.js'

// The repos a session works with, under the message box (`composer.control` at `context`): each
// copied into the session's folder, beside the run's checkout of its project or, with no project,
// as all it works in. In the launcher and a profile's editor a menu ticks them on and off, written
// to the run's options (`options['git-branches'].repos`), each named as its copy will be; in a
// session, the repos its record keeps stay ticked, and one ticked beside them goes with the next message.

/** The room the menu takes over the box at its full height: its search, its list (20rem) and the page's edge. */
const ROOM_ABOVE_PX = 400

/** The most rows a search lists. */
const SEARCH_SHOWN = 200

/** How many repos the menu lists before a search: the search reaches the rest. */
const REPOS_SHOWN = 20

/** How soon the menu asks again while the repos on this computer are still being looked for. */
const ASK_AGAIN_MS = 2000

/** A repo on this computer that is no project, as a module offers it (`composer.where`). */
interface RepoHere {
  path: string
  name: string
  /** Its address at its host, or its folder. */
  detail: string
}

/**
 * The repos on this computer the modules offer (`composer.where`): each by its folder, a repo only
 * at an address left out, since a session's copy is made from a folder. Read each time the menu
 * opens, and again shortly while one is still being read.
 */
function useReposHere(open: boolean): { repos: RepoHere[]; loading: boolean } | null {
  const where = useOptionsAt('composer.where', undefined)
  const [again, setAgain] = useState(0)
  const read = useLoaded<{ repos: RepoHere[]; loading: boolean } | null>(
    async () => {
      const answers = await Promise.all(where.map(({ option, host }) => option.repos(host).catch(() => ({ repos: [], loading: false }))))
      const repos = answers.flatMap(answer => answer.repos.flatMap(repo => (repo.folder !== undefined ? [{ path: repo.folder, name: repo.label, detail: repo.detail ?? repo.folder }] : [])))
      return { repos, loading: answers.some(answer => answer.loading === true) }
    },
    null,
    [open, again, where],
  )
  useEffect(() => {
    if (!open || !read?.loading) return
    const later = setTimeout(() => setAgain(k => k + 1), ASK_AGAIN_MS)
    return () => clearTimeout(later)
  }, [open, read])
  return read
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
 * The groups the menu lists for a search, as Claude Code on the web lists its repos: the picked
 * ones on top, then the projects of this computer and the repos that are no project, none of them
 * picked. With nothing typed, only the first {@link REPOS_SHOWN} repos; a search finds any of
 * them, by name, folder or address, and keeps every picked one in sight.
 */
export function repoGroups(projects: readonly Row[], repos: readonly Row[], picked: readonly SessionRepo[], typed: string): Group[] {
  const query = typed.trim().toLowerCase()
  const isPicked = (row: Row) => picked.some(repo => repo.from === row.path)
  const matching = (rows: readonly Row[], most: number) => rows.filter(row => !isPicked(row) && (!query || `${row.label}\n${row.search}`.toLowerCase().includes(query))).slice(0, most)
  return [
    { value: 'picked', label: '', items: picked.map<Row>(repo => ({ value: `picked:${repo.from}`, label: repo.name, detail: repo.from, path: repo.from, search: repo.from })) },
    { value: 'projects', label: 'Projects', items: matching(projects, SEARCH_SHOWN) },
    { value: 'repos', label: 'Repos', items: matching(repos, query ? SEARCH_SHOWN : REPOS_SHOWN) },
  ].filter(group => group.items.length > 0)
}

/**
 * What the Repos button says, as Claude Code on the web's repo button: the first repo and how many
 * more. With a project, its own repo leads and the copies are the more; with none, the first copy,
 * or "Repos" while there is none.
 */
export function reposLabel(project: string | undefined, picked: readonly SessionRepo[]): { first: string; more: number } {
  if (project !== undefined) return { first: project, more: picked.length }
  return picked.length === 0 ? { first: 'Repos', more: 0 } : { first: picked[0]!.name, more: picked.length - 1 }
}

/** What the Repos button's hover says of a session's repos, with or without any. */
export function reposSaid(names: readonly string[]): string {
  return names.length === 0 ? "Repos to copy into the session's folder" : `Copied into the session's folder: ${names.join(', ')}`
}

/** How many repos, in words: what the button's name says after it. */
const counted = (count: number): string => `${count} repo${count === 1 ? '' : 's'}`

// The menu under the box, one on both pages: the repos the session works with (Rom's "repos are
// just context"), as Claude Code on the web's repo picker (his pick D, 11-26). The picked ones are
// on top, each with a × that takes it off and its tick; a project's own repo leads them, kept with
// the project (a lock, no ×), and so do the copies a session already has. Every other row has a +
// always in sight (the web's shows only under the pointer, which hid that more than one repo can be
// picked), and a press anywhere on it adds it: the run copies the repo into the session's folder,
// and leaves the repo's own folder as it was. The button says the first repo and how many more.
export function ReposMenu({
  picked,
  projects,
  busy,
  onChange,
  without,
  project,
  kept,
}: {
  picked: readonly SessionRepo[]
  projects: readonly ProjectSummary[]
  busy: boolean
  /** The whole pick, each repo named as its copy will be. */
  onChange: (picked: SessionRepo[]) => void
  /** A folder left out of the list: the session's own project. */
  without?: string | undefined
  /** The session's own project, by its name: its repo leads the picked ones, kept with the project. */
  project?: string | undefined
  /** In a session: the repos it has, ticked and kept; a repo ticked beside them goes with its next message. */
  kept?: readonly SessionRepo[] | undefined
}) {
  const search = usePickerSearch()
  const { open, typed } = search
  const position = usePopupPosition()
  // Above the box on its left edge, as the gear's menu, where the page has the room over the box for its whole
  // height; under its own button otherwise, as on a launcher whose box stands high: turned under the box, it
  // would cover the row it was opened from.
  const box = useContext(BoxOfRow)
  const above = open && box?.current != null && box.current.getBoundingClientRect().top >= ROOM_ABOVE_PX
  const repos = useReposHere(open)
  const projectRows = useMemo<Row[]>(
    () => projects.filter(p => p.path !== without).map(p => ({ value: `project:${p.id}`, label: folderName(p.path), detail: p.path, path: p.path, search: p.path })),
    [projects, without],
  )
  const repoRows = useMemo<Row[]>(
    () => (repos?.repos ?? []).filter(repo => repo.path !== without).map(repo => ({ value: `repo:${repo.path}`, label: repo.name, detail: repo.detail, path: repo.path, search: `${repo.path}\n${repo.detail}` })),
    [repos, without],
  )
  const groups = repoGroups(projectRows, repoRows, picked, typed)
  // The picked ones as the menu's rows: a row is the same repo as a pick by its folder.
  const pickedRows = groups.find(group => group.value === 'picked')?.items ?? []
  const isPicked = (row: Row) => picked.some(repo => repo.from === row.path)
  const isKept = (row: Row) => kept?.some(repo => repo.from === row.path) === true
  // What a picked row says beside its name: a copy beside the project, or one going with the next message.
  const tagOf = (row: Row): string | undefined => (kept && !isKept(row) ? 'with your next message' : project !== undefined ? 'copy' : undefined)
  const label = reposLabel(project, picked)

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
      onValueChange={rows => {
        const folders = rows.map(row => row.path)
        // A session keeps the repos it has: a new one is named beside them. A repo picked already keeps the branch picked for it.
        const named = kept ? [...kept, ...nameRepos(folders.filter(folder => !kept.some(repo => repo.from === folder)), kept)] : nameRepos(folders)
        onChange(named.map(repo => {
          const base = picked.find(had => had.from === repo.from)?.base
          return base !== undefined ? { ...repo, base } : repo
        }))
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Combobox.Trigger
              disabled={busy}
              aria-label={picked.length > 0 ? `Repos: ${counted(picked.length)}` : 'Repos'}
              className={MENU_TRIGGER_OPEN_CLASS}
              {...search.trigger}
              render={
                <button type="button" className={cn(rowButtonClass, 'max-w-[14rem]!')}>
                  <FolderGit2 className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{label.first}</span>
                  {label.more > 0 && <span className="shrink-0 text-muted-foreground">+{label.more}</span>}
                  <RowChevron />
                </button>
              }
            />
          }
        />
        <TooltipContent>{reposSaid(picked.map(repo => repo.name))}</TooltipContent>
      </Tooltip>
      <Combobox.Portal>
        <Combobox.Positioner {...position} {...(above ? { anchor: box, side: 'top' as const } : {})} sideOffset={6} align="start" className="z-50 outline-none">
          <Combobox.Popup data-overlay="picker" aria-label="Repos" className={cn(MENU_POPUP_CLASS, 'w-[24rem] max-w-[var(--available-width)]')}>
            {/* The field one line tall, 16 in from the band's every edge, as the jump's is. */}
            <div className="flex h-13 items-center gap-3 border-b border-hairline px-4">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <Combobox.Input aria-label="Search repos" placeholder="Search repos" className="h-5 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            <ScrollArea viewportClassName="h-[min(20rem,calc(var(--available-height)-5rem))]">
              <div className={MENU_BODY_CLASS}>
                {/* The project's own repo leads, kept with the project. */}
                {project !== undefined && without !== undefined && (
                  <div role="presentation" className={cn(MENU_ITEM_CLASS, 'cursor-default')}>
                    <MenuMark>
                      <FolderGit2 className="size-3.5" aria-hidden />
                    </MenuMark>
                    <RowWords label={project} detail={without} tag="project" />
                    <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Kept with the project" />
                    <MenuMark className="w-4 justify-center">
                      <Check className="size-4" aria-hidden />
                    </MenuMark>
                  </div>
                )}
                <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground empty:hidden">{repos === null ? '' : 'No repo by that name.'}</Combobox.Empty>
                <Combobox.List>
                  {(group: Group) => (
                    <Combobox.Group key={group.value} items={group.items}>
                      {group.label ? <Combobox.GroupLabel className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground">{group.label}</Combobox.GroupLabel> : null}
                      <Combobox.Collection>
                        {(row: Row) => (
                          <Combobox.Item key={row.value} value={row} className={MENU_ITEM_CLASS}>
                            <MenuMark>
                              <FolderGit2 className="size-3.5" aria-hidden />
                            </MenuMark>
                            <RowWords label={row.label} detail={row.detail} tag={isPicked(row) ? tagOf(row) : undefined} />
                            {/* At the right, where every menu's mark stands: a picked one's × (a lock for one the session keeps) and its tick; any other's +. */}
                            {isPicked(row) ? (
                              <>
                                {isKept(row) ? <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Copied already" /> : <X className="size-3.5 shrink-0 text-muted-foreground" aria-label="Take it off" />}
                                <MenuMark className="w-4 justify-center">
                                  <Check className="size-4" aria-hidden />
                                </MenuMark>
                              </>
                            ) : (
                              <MenuMark className="w-4 justify-center">
                                <span className="flex size-4 items-center justify-center rounded-sm border border-border text-primary">
                                  <Plus className="size-3" aria-label="Add" />
                                </span>
                              </MenuMark>
                            )}
                          </Combobox.Item>
                        )}
                      </Combobox.Collection>
                    </Combobox.Group>
                  )}
                </Combobox.List>
                <p className="px-2 pt-1.5 pb-1 text-xs text-muted-foreground">
                  {project !== undefined ? "The project's repo comes with the project. + copies another repo into the session's folder." : kept ? "Repos already copied stay. + copies one more for your next message." : "+ copies a repo into the session's folder."}
                </p>
                {repos === null || repos.loading ? (
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
  )
}

/** A row's words: its name, with a word on it (`project`, `copy`), and its folder or address under it, cut in its middle. */
function RowWords({ label, detail, tag }: { label: string; detail: string; tag?: string | undefined }) {
  return (
    <span className="min-w-0 flex-1 leading-5">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{label}</span>
        {tag && <span className="shrink-0 rounded-full border border-border px-1.5 text-xs leading-4 text-muted-foreground">{tag}</span>}
      </span>
      {/* Its path on one line, cut in its middle: where it starts and the folder it ends in show, and the
          whole of it is in the title and said to a screen reader. */}
      <span data-line2 title={detail} className="flex min-w-0 text-xs leading-4 text-muted-foreground">
        <MiddleCut text={detail} />
      </span>
    </span>
  )
}

/** The run options with these repos picked: the slice keeps its other picks, and goes when it holds none. */
export function withRepos(options: RunOptions, repos: readonly SessionRepo[]): RunOptions {
  const { 'git-branches': slice, ...others } = options
  const { repos: _was, ...rest } = slice ?? {}
  const kept = { ...rest, ...(repos.length > 0 ? { repos: [...repos] } : {}) }
  return Object.keys(kept).length > 0 ? { ...others, 'git-branches': kept } : others
}

/**
 * The control: the menu that picks the repos, the project the box is in left out (its own checkout
 * is the run's). In a session, the repos it has stay ticked, and one ticked beside them is copied
 * in with the next message.
 */
export function ReposControl({ in: box, projectId, options, recorded, onChange, busy }: UiComposerControlProps) {
  const projects = useProjects()
  const repos = options['git-branches']?.repos ?? []
  // In a session, the repos its record names stay ticked; a tick beside them goes with the next message.
  const kept = box === 'session' ? (recorded?.['git-branches']?.repos ?? []) : undefined
  const own = projects.find(project => project.id === projectId)
  return <ReposMenu picked={repos} projects={projects} busy={busy} kept={kept} onChange={picked => onChange(withRepos(options, picked))} without={own?.path} project={own ? folderName(own.path) : undefined} />
}
