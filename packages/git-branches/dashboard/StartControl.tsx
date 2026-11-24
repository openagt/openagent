import { useMemo, useState, type ComponentProps } from 'react'
import { Check, GitBranch, Search } from 'lucide-react'
import {
  Combobox,
  MENU_BODY_CLASS,
  MENU_ITEM_CLASS,
  MENU_POPUP_CLASS,
  MENU_TRIGGER_OPEN_CLASS,
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
import { server, type StartFrom, type StartPlaces } from './calls.js'

// The branch a run starts from, in the row above the message box (`composer.control` at `start`),
// after the project. In the launcher, a menu to pick it: the project's main branch (origin's
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
  if (props.in === 'profile' || props.projectId === undefined) return null
  return props.in === 'session' ? <StartedFrom projectId={props.projectId} agentId={props.agentId} /> : <StartFromMenu projectId={props.projectId} busy={props.busy} />
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
            {/* The field one line tall, 16 in from the band's every edge, as the jump's is. */}
            <div className="flex h-13 items-center gap-3 border-b border-hairline px-4">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
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
