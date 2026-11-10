import { useMemo, useState, type ComponentProps } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Check, ChevronDown, GitBranch, Search } from 'lucide-react'
import type { StartFromPick } from '../../src/index.js'
import { publishedBase } from '../../src/client.js'
import { onStartBranches, type StartBranches } from '../rpc/projects.js'
import { useLoaded } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { rowButtonClass } from './ui/row-item.js'
import { OptionLabel } from './ui/option-label.js'
import { ScrollArea } from './ui/scroll-area.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { MENU_ITEM_CLASS, MENU_POPUP_CLASS, MENU_TRIGGER_OPEN_CLASS } from './ui/dropdown-menu.js'

/** The most rows the menu draws at once: the search reaches the rest. */
const ROWS_DRAWN = 200

/** What the button reads for a pick (none is the main branch): the branch's name, the local one marked as such. */
function startFromLabel(pick: StartFromPick | undefined, main: string, local: string): string {
  if (pick?.kind === 'local') return `${local} (local)`
  return pick?.kind === 'published' ? pick.branch : main
}

/**
 * What a Start hands the daemon for a pick: the local branch by its name, a published one as origin
 * has it, and for the main branch nothing. A published pick of the main branch's name is the main
 * branch, which is what it reads as after origin's default branch changes to it.
 */
export function startFromBase(pick: StartFromPick | undefined, main: string, local: string): { base?: string } {
  if (pick?.kind === 'local') return { base: local }
  return pick?.kind === 'published' && pick.branch !== main ? { base: publishedBase(pick.branch) } : {}
}

/**
 * The branch a pull request of a run started from `pick` may go into beside the main branch: the
 * picked one, when it is not the main branch and origin has it. A local branch origin may not have
 * is asked of `onOrigin`; nothing while that is not known, so the main branch stays the target.
 */
export function prTargetBranch(pick: StartFromPick | undefined, main: string, local: string, onOrigin: readonly string[] | undefined): string | undefined {
  if (pick === undefined) return undefined
  const branch = pick.kind === 'local' ? local : pick.branch
  if (branch === main) return undefined
  return pick.kind === 'published' || onOrigin?.includes(branch) ? branch : undefined
}

/**
 * The branch row's button, by look alone: a word and an icon that say the branch, and the chevron
 * of a menu. Of a set width at most, important to hold on a phone too: a branch's name can run
 * past the row's, and would squeeze the words beside it to nothing.
 */
export function BranchButton({ label, className, ...props }: { label: string } & ComponentProps<'button'>) {
  return (
    <button type="button" {...props} className={cn(rowButtonClass, 'max-w-[16rem]!', className)}>
      <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
      <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
    </button>
  )
}

/** A row of the menu. `label` and `value` are the names the search and the list know a row by. */
interface Row {
  value: string
  label: string
  pick: StartFromPick | undefined
  description?: string
}

const samePick = (a: Row, b: Row): boolean => a.value === b.value

// The launcher's "start from" pick, in the row above the box: the branch the agent starts from, in
// words, and a menu to pick it. The button reads the pick itself, so where a Start begins is on
// screen with the menu shut. The menu lists the project's main branch first, then "My local
// branch", the only way to start from commits that are not pushed, listed even when it has the
// main branch's name; then what origin has now, read each time the menu opens, with a search for a
// repository that has hundreds. Those first two rows need no read: they are there at once, and
// the rest lands under them. A search box in a menu is a combobox's: a plain menu takes every key
// for its own typing-to-jump.
export function StartFromMenu({ projectId, main, local, pick, onPick, busy }: { projectId: string; main: string; local: string; pick: StartFromPick | undefined; onPick: (pick: StartFromPick | undefined) => void; busy: boolean }) {
  const label = startFromLabel(pick, main, local)
  const [open, setOpen] = useState(false)
  // A project only another computer has is that computer's, and the read goes there by the project's id (`ELSEWHERE_FORWARDED`). A call that fails on the way is a list that could not be read.
  const read = useLoaded<StartBranches | null>(open ? () => onStartBranches(projectId).then(answer => answer ?? {}, () => ({})) : null, null, [open, projectId], { remember: `start-branches:${projectId}` })
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
      open={open}
      onOpenChange={setOpen}
      onValueChange={row => {
        if (row) onPick(row.pick)
      }}
    >
      <Tooltip>
        <TooltipTrigger render={<Combobox.Trigger disabled={busy} aria-label="The agent starts from" className={MENU_TRIGGER_OPEN_CLASS} render={<BranchButton label={label} />} />} />
        <TooltipContent>{`The agent starts from ${label}`}</TooltipContent>
      </Tooltip>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={6} align="start" className="z-50 outline-none">
          <Combobox.Popup aria-label="The agent starts from" className={cn(MENU_POPUP_CLASS, 'w-[22rem] max-w-[var(--available-width)]')}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <Combobox.Input aria-label="Search branches" placeholder="Search branches" className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            {/* The menu opens upward from the box's row: a list of a set height keeps the search and the first rows where they are as the answer lands, and as the search narrows it. */}
            <ScrollArea viewportClassName="h-[min(20rem,calc(var(--available-height)-2.5rem))]">
              <div className="p-1">
                <p className="px-2 py-1.5 text-xs font-normal text-muted-foreground">The agent starts from</p>
                <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground empty:hidden">No branch by that name.</Combobox.Empty>
                <Combobox.List>
                  {(row: Row) => (
                    <Combobox.Item key={row.value} value={row} className={cn(MENU_ITEM_CLASS, 'items-start')}>
                      {row.description !== undefined ? <OptionLabel label={row.label} description={row.description} /> : <span className="min-w-0 flex-1 leading-tight [overflow-wrap:anywhere]">{row.label}</span>}
                      {/* The pick is the tick at the row's end. */}
                      {row.value === picked.value && <Check className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
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
