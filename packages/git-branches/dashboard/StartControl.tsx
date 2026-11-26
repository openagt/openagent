import { useMemo, useState, type ComponentProps } from 'react'
import { Check, GitBranch, Search } from 'lucide-react'
import {
  Combobox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  NO_PROJECT,
  useProjects,
  MENU_BODY_CLASS,
  MENU_ITEM_CLASS,
  MENU_POPUP_CLASS,
  MENU_TRIGGER_OPEN_CLASS,
  PICKER_SEARCH_CLASS,
  MenuMark,
  OptionLabel,
  RowChevron,
  RowSaid,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  rowButtonClass,
  tellNextRunPicked,
  useLoaded,
  useModuleHost,
  usePickerSearch,
  usePopupPosition,
  type UiComposerControlProps,
} from '@openagt/ui/module'
import type { RunOptions } from '@openagt/hooks'
import { server, type StartFrom, type StartPlaces } from './calls.js'
import { withRepos } from './ReposControl.js'
import { folderName, type SessionRepo } from '../src/repo-names.js'

// The branch a run starts from, in the row under the message box (`composer.control` at
// `context`), after the project and its repos. With repos copied into the session's folder it is
// "Branches", as Claude Code on the web's with more than one repo: a row per repo, the project's
// first, each with the branch it starts from and a menu of origin's others; a copy's pick goes with
// the Start in its run options. With none, In the launcher, a menu to pick it: the project's main branch (origin's
// default branch, fetched fresh) first, then "My local branch", the branch the project's folder is
// on, as committed on this machine, then what origin has now, read each time the menu opens, with a
// search for a repository that has hundreds. The button reads the pick itself, so where a Start
// begins is on screen with the menu shut. The pick holds for every next run of the project on this
// computer (`START_FROM`), and the run's checkout step reads it. Drawn only where it is obeyed: a
// project with a remote whose folder is on a branch. A session's row says the branch it started
// from, as its record vouches for it, and the one it works on in the hover; a profile's editor,
// for any project, draws nothing.

/** The most rows the menu draws at once: the search reaches the rest. */
const ROWS_DRAWN = 200

export function StartControl(props: UiComposerControlProps) {
  if (props.in === 'profile') return null
  if (props.in === 'session') return props.projectId !== undefined ? <StartedFrom projectId={props.projectId} agentId={props.agentId} /> : null
  const repos = props.options['git-branches']?.repos ?? []
  if (repos.length > 0) return <BranchesMenu projectId={props.projectId} options={props.options} onChange={props.onChange} busy={props.busy} />
  return props.projectId !== undefined ? <StartFromMenu projectId={props.projectId} busy={props.busy} /> : null
}

/** The value a project's start pick has in its menu: `main`, `local`, or `published:<branch>`. */
function pickValue(pick: StartFrom | undefined): string {
  return pick === undefined ? 'main' : pick.kind === 'local' ? 'local' : `published:${pick.branch}`
}

/**
 * "Branches": where each repo of the session starts from, as Claude Code on the web's with more
 * than one repo. The project's row picks as its own menu does, for every next run; a copy's goes
 * with this Start (`options['git-branches'].repos[].base`). Origin's branches are read as the menu opens.
 */
function BranchesMenu({ projectId, options, onChange, busy }: { projectId?: string | undefined; options: RunOptions; onChange: (options: RunOptions) => void; busy: boolean }) {
  const host = useModuleHost()
  const [open, setOpen] = useState(false)
  const [asked, setAsked] = useState(0)
  const repos = options['git-branches']?.repos ?? []
  const own = useProjects().find(project => project.id === projectId)
  const projectName = own ? folderName(own.path) : undefined
  const places = useLoaded<StartPlaces | null>(projectId !== undefined ? () => server(host).startPlaces(projectId, {}).catch(() => null) : null, null, [projectId, asked], { remember: `git-branches:start-places:${projectId ?? ''}` })
  const others = useLoaded<{ branches?: string[] } | null>(open && projectId !== undefined && places ? () => server(host).startBranches(projectId, {}).catch(() => ({})) : null, null, [open, projectId, places !== null])
  const pickProject = async (value: string) => {
    if (projectId === undefined) return
    const next: StartFrom | undefined = value === 'main' ? undefined : value === 'local' ? { kind: 'local' } : { kind: 'published', branch: value.slice('published:'.length) }
    await server(host).pickStart(projectId, next ? { pick: next } : {})
    tellNextRunPicked()
    setAsked(n => n + 1)
  }
  const pickCopy = (repo: SessionRepo, base: string | undefined) => {
    onChange(withRepos(options, repos.map(had => (had.from !== repo.from ? had : base === undefined ? { name: had.name, from: had.from } : { ...had, base }))))
  }
  const said = 'Where each repo starts from'
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger disabled={busy} aria-label="Branches each repo starts from" className={MENU_TRIGGER_OPEN_CLASS} render={<BranchButton label="Branches" />} />} />
        <TooltipContent>{said}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-[20rem] max-w-[var(--available-width)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">{said}</DropdownMenuLabel>
          {places && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="min-w-0 flex-1 truncate">{projectName ?? 'This project'}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{startFromLabel(places.pick, places.main, places.local)}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[20rem] w-[18rem] overflow-y-auto">
                <DropdownMenuRadioGroup value={pickValue(places.pick)} onValueChange={value => void pickProject(String(value))}>
                  <BranchItem value="main" label={places.main} picked={pickValue(places.pick)} />
                  <BranchItem value="local" label={`${places.local} (local)`} picked={pickValue(places.pick)} />
                  {(others?.branches ?? []).slice(0, ROWS_DRAWN).map(branch => (
                    <BranchItem key={branch} value={`published:${branch}`} label={branch} picked={pickValue(places.pick)} />
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {repos.map(repo => (
            <CopyBranches key={repo.from} projectId={projectId ?? NO_PROJECT} repo={repo} open={open} onPick={base => pickCopy(repo, base)} />
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A branch in a menu of "Branches": its name, and the tick at the row's end where it is the one picked. */
function BranchItem({ value, label, picked }: { value: string; label: string; picked: string }) {
  return (
    <DropdownMenuRadioItem value={value}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value === picked && (
        <MenuMark className="ml-auto">
          <Check className="size-3.5" aria-hidden />
        </MenuMark>
      )}
    </DropdownMenuRadioItem>
  )
}

/** A copy's row of "Branches": its name and the branch it starts from, and a menu of its origin's branches, its main one first. */
function CopyBranches({ projectId, repo, open, onPick }: { projectId: string; repo: SessionRepo; open: boolean; onPick: (base: string | undefined) => void }) {
  const host = useModuleHost()
  const read = useLoaded<{ main?: string; branches?: string[] } | null>(open ? () => server(host).repoBranches(projectId, { folder: repo.from }).catch(() => ({})) : null, null, [open, repo.from], {
    remember: `git-branches:repo-branches:${repo.from}`,
  })
  const main = read?.main ?? 'main'
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="min-w-0 flex-1 truncate">{repo.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{repo.base ?? main}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[20rem] w-[18rem] overflow-y-auto">
        <DropdownMenuRadioGroup value={repo.base ?? ''} onValueChange={value => onPick(value === '' ? undefined : String(value))}>
          <BranchItem value="" label={main} picked={repo.base ?? ''} />
          {(read?.branches ?? []).slice(0, ROWS_DRAWN).map(branch => (
            <BranchItem key={branch} value={branch} label={branch} picked={repo.base ?? ''} />
          ))}
        </DropdownMenuRadioGroup>
        {read === null ? <p className="px-2 py-1.5 text-xs text-muted-foreground">Reading the branches on origin…</p> : read.branches === undefined ? <p className="px-2 py-1.5 text-xs text-muted-foreground">The other branches could not be read from origin.</p> : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** A session's start, said and not offered: a session keeps where it started. A start that cannot be said is left out. */
function StartedFrom({ projectId, agentId }: { projectId: string; agentId?: string | undefined }) {
  const host = useModuleHost()
  // Read once: where a run started never changes; the branch it works on is the hover's.
  const read = useLoaded<{ from?: string; on?: string } | null>(agentId !== undefined ? () => server(host).startedFrom(projectId, { agentId }).catch(() => ({})) : null, null, [projectId, agentId], {
    remember: `git-branches:started-from:${projectId}:${agentId ?? ''}`,
  })
  const from = read?.from
  if (from === undefined) return null
  const on = read?.on
  const said = on !== undefined && on !== from ? `Started from ${from}, works on ${on}` : `Started from ${from}`
  return (
    <RowSaid tip={said}>
      <GitBranch className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{from}</span>
    </RowSaid>
  )
}

/** What the button reads for a pick (none is the main branch): the branch's name, the local one marked as such. */
function startFromLabel(pick: StartFrom | undefined, main: string, local: string): string {
  if (pick?.kind === 'local') return `${local} (local)`
  return pick?.kind === 'published' ? pick.branch : main
}

/**
 * The branch row's button, by look alone: a word and an icon that say the branch, and the chevron
 * of a menu. Of a set width at most, important to hold on a phone too: a branch's name can run
 * past the row's, and would squeeze the words beside it to nothing.
 */
function BranchButton({ label, className, ...props }: { label: string } & ComponentProps<'button'>) {
  return (
    <button type="button" {...props} className={cn(rowButtonClass, 'max-w-[16rem]!', className)}>
      <GitBranch className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
      <RowChevron />
    </button>
  )
}

/** A row of the menu. `label` and `value` are the names the search and the list know a row by. */
interface Row {
  value: string
  label: string
  pick: StartFrom | undefined
  description?: string
}

const samePick = (a: Row, b: Row): boolean => a.value === b.value

/** The launcher's pick, once where the project can start from is read: nothing where there is no pick to make. */
function StartFromMenu({ projectId, busy }: { projectId: string; busy: boolean }) {
  const host = useModuleHost()
  // Read again once a pick is saved: the button reads what was saved.
  const [asked, setAsked] = useState(0)
  const places = useLoaded<StartPlaces | null>(() => server(host).startPlaces(projectId, {}).catch(() => null), null, [projectId, asked], { remember: `git-branches:start-places:${projectId}` })
  if (!places) return null
  const pick = async (next: StartFrom | undefined) => {
    await server(host).pickStart(projectId, next ? { pick: next } : {})
    tellNextRunPicked()
    setAsked(n => n + 1)
  }
  return <Menu projectId={projectId} places={places} busy={busy} onPick={next => void pick(next)} />
}

function Menu({ projectId, places, busy, onPick }: { projectId: string; places: StartPlaces; busy: boolean; onPick: (pick: StartFrom | undefined) => void }) {
  const host = useModuleHost()
  const { main, local, pick } = places
  const position = usePopupPosition()
  const label = startFromLabel(pick, main, local)
  const search = usePickerSearch()
  const { open } = search
  // A call that fails on the way is a list that could not be read.
  const read = useLoaded<{ branches?: string[] } | null>(open ? () => server(host).startBranches(projectId, {}).catch(() => ({})) : null, null, [open, projectId], { remember: `git-branches:start-branches:${projectId}` })
  const others = read?.branches
  const rows = useMemo<Row[]>(
    () => [
      { value: 'main', label: main, pick: undefined, description: "The project's main branch, fetched fresh." },
      { value: 'local', label: `My local branch ${local}`, pick: { kind: 'local' }, description: 'Your branch as committed on this machine; uncommitted edits are not carried. If the agent publishes, your commits that are not pushed go up with its branch.' },
      ...(others ?? []).map((branch): Row => ({ value: `published:${branch}`, label: branch, pick: { kind: 'published', branch } })),
    ],
    [main, local, others],
  )
  const picked = pick === undefined ? rows[0]! : pick.kind === 'local' ? rows[1]! : (rows.find(row => row.value === `published:${pick.branch}`) ?? { value: `published:${pick.branch}`, label: pick.branch, pick })
  return (
    <Combobox.Root<Row>
      items={rows}
      limit={ROWS_DRAWN}
      value={picked}
      isItemEqualToValue={samePick}
      {...search.root}
      onValueChange={row => {
        if (row) onPick(row.pick)
      }}
    >
      <Tooltip>
        <TooltipTrigger render={<Combobox.Trigger disabled={busy} aria-label="The agent starts from" className={MENU_TRIGGER_OPEN_CLASS} {...search.trigger} render={<BranchButton label={label} />} />} />
        <TooltipContent>{`The agent starts from ${label}`}</TooltipContent>
      </Tooltip>
      <Combobox.Portal>
        <Combobox.Positioner {...position} sideOffset={6} align="start" className="z-50 outline-none">
          <Combobox.Popup data-overlay="picker" aria-label="The agent starts from" className={cn(MENU_POPUP_CLASS, 'w-[22rem] max-w-[var(--available-width)]')}>
            <div className={PICKER_SEARCH_CLASS}>
              <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <Combobox.Input aria-label="Search branches" placeholder="Search branches" className="h-5 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            {/* The menu opens upward from the box's row: a list of a set height keeps the search and the first rows where they are as the answer lands, and as the search narrows it. */}
            <ScrollArea viewportClassName="h-[min(20rem,calc(var(--available-height)-2.5rem))]">
              <div className={MENU_BODY_CLASS}>
                <p className="px-2 py-1.5 text-xs font-normal text-muted-foreground">The agent starts from</p>
                <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground empty:hidden">No branch by that name.</Combobox.Empty>
                <Combobox.List>
                  {(row: Row) => (
                    <Combobox.Item key={row.value} value={row} className={MENU_ITEM_CLASS}>
                      {row.description !== undefined ? <OptionLabel label={row.label} description={row.description} /> : <span className="min-w-0 flex-1 leading-5 [overflow-wrap:anywhere]">{row.label}</span>}
                      {/* The pick is the tick at the row's end. */}
                      {row.value === picked.value && (
                        <MenuMark className="ml-auto">
                          <Check className="size-3.5" aria-hidden />
                        </MenuMark>
                      )}
                    </Combobox.Item>
                  )}
                </Combobox.List>
                {/* In one place, at the list's end: the rows above it stand still when the answer lands. */}
                {read === null ? (
                  <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">Reading the branches on origin…</p>
                ) : others === undefined ? (
                  <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">The other branches could not be read from origin.</p>
                ) : others.length + 2 > ROWS_DRAWN ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">Search to see more of the {others.length} branches.</p>
                ) : null}
              </div>
            </ScrollArea>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
