import { Check, ChevronDown, House, Laptop, Server, Plus, type LucideIcon } from 'lucide-react'
import type { Machine } from '../lib/machines.js'
import type { MachineStatus } from '../lib/use-machine-status.js'
import { thisMachineName } from '../lib/this-machine.js'
import { machineName, reachedByLine, reachedThrough } from '../../src/client.js'
import { cn } from '../lib/utils.js'
import { buttonVariants } from './ui/button.js'
import { rowButtonClass } from './ui/row-item.js'
import { OptionLabel } from './ui/option-label.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu.js'

/**
 * Where the next run starts (#1052/#1067): the machine this dashboard is on, or one of the
 * machines saved on it. A machine is a run TARGET, selected in place: picking one does not
 * navigate the browser. The daemon relays the start to it, and that machine runs the start hook
 * of its own copy of the project. The dashboard is always its own machine's, also when a phone
 * shows it: the first row is the computer that runs this OpenAgent, "This machine" on that
 * computer's own screen and its name anywhere else (this-machine.ts).
 *
 * Each machine is said as a person knows it: its name, then what it is and where, never the
 * address that stands for it here. A person's own computer reached by the line it keeps open to
 * this server is a computer (reached-by-line.ts); a computer at home reached through a server is
 * a server at home, through that server; another person's computer, shared with everyone on a
 * server, says whose it is and that a run there uses this person's own logins. A machine is
 * picked here and removed on its page under Devices, never by a slip of the pointer in a menu.
 */
export type ConnectionControl = {
  /** The saved machines a run can be sent to. */
  machines: Machine[]
  /** The machine selected as the run target (its id), or null when the dashboard's own machine is (#1067). */
  selectedMachineId: string | null
  /** The project has no repository address, the one name another machine would know it by: it runs here only. */
  onlyHere: boolean
  /** Select a saved machine as the run target, with no navigation (#1067). */
  onSelect: (machine: Machine) => void
  /** Clear the selection back to the dashboard's own machine (#1067). */
  onSelectLocal: () => void
  onAddMachine: () => void
  /** Each machine's online/offline status (#1072); an id absent from the map is still being checked. */
  status: Record<string, MachineStatus>
}

/** What a saved machine is, as its row draws and says it: its icon, and what it is and where. */
function kindOf(machine: Machine): { Icon: LucideIcon; words: string } {
  const through = reachedThrough(machine.url)
  if (machine.owner !== undefined) return { Icon: Server, words: `@${machine.owner}'s server${through !== undefined ? `, through ${through}` : ''}. Runs use your own logins.` }
  if (reachedByLine(machine.url)) return { Icon: Laptop, words: 'Your computer' }
  if (through !== undefined) return { Icon: House, words: `Server at home, through ${through}` }
  return { Icon: Server, words: `Server, ${hostOf(machine.url)}` }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** A machine's icon with its reachability on it (#1072): green online, muted offline or still unknown. */
function MachineIcon({ Icon, status }: { Icon: LucideIcon; status: MachineStatus | undefined }) {
  return (
    <span className="relative mt-0.5 flex shrink-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <span aria-hidden className={cn('absolute -right-0.5 -bottom-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-popover', status === 'online' ? 'bg-success' : 'bg-muted-foreground/50')} />
    </span>
  )
}

// One flat "Run on" list (#1067): this machine, then the saved machines and "Add a machine",
// with a single checkmark.
// Two looks for the one menu: an icon button for the compact single row, and the target in words,
// drawn as the rows around the box draw their items, for the row above it (`inRow`).
export function RunOnMenu({ connection, busy, inRow = false }: { connection: ConnectionControl; busy: boolean; inRow?: boolean | undefined }) {
  // The selected machine (#1067). An id pointing at a removed machine reads as none, and so does
  // any pick on a project that runs here only.
  const selectedMachine =
    connection.selectedMachineId && !connection.onlyHere ? connection.machines.find(m => m.id === connection.selectedMachineId) : undefined
  const here = thisMachineName()
  const summary = selectedMachine ? machineName(selectedMachine) : here
  const onThisMachine = !selectedMachine
  const Icon = onThisMachine ? Laptop : kindOf(selectedMachine).Icon
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              type="button"
              disabled={busy}
              aria-label="Run on"
              className={
                inRow
                  ? rowButtonClass
                  : cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'relative h-8 w-8')
              }
            />
          }
        >
          {inRow ? (
            <>
              <span className="relative flex shrink-0">
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {!onThisMachine && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />}
              </span>
              <span className="truncate">{summary}</span>
              <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            </>
          ) : (
            <>
              <Icon className="h-4 w-4" />
              {!onThisMachine && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[var(--color-primary)]" />}
            </>
          )}
        </TooltipTrigger>
        <TooltipContent>{`Run on — ${selectedMachine?.label ?? here}`}</TooltipContent>
      </Tooltip>
      {/* The words are at the row's left, the icon button at the compact row's right: the menu opens inward. */}
      <DropdownMenuContent align={inRow ? 'start' : 'end'} className="min-w-[19rem] max-w-[22rem]">
        <DropdownMenuItem className="items-start gap-2" onClick={() => connection.onSelectLocal()}>
          <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', onThisMachine ? 'opacity-100' : 'opacity-0')} />
          <Laptop className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <OptionLabel label={here} description="Runs here, through this project's start hook." />
        </DropdownMenuItem>
        {/* Saved machines: a click SELECTS the machine as the run target (no navigation). */}
        {connection.machines.map(machine => {
          const status = connection.status[machine.id]
          const offline = status === 'offline'
          const { Icon: KindIcon, words } = kindOf(machine)
          const description = offline ? (reachedByLine(machine.url) ? 'Not connected. It must be on, with OpenAgent running.' : `Offline · ${words}`) : words
          return (
            <DropdownMenuItem
              key={machine.id}
              className={cn('items-start gap-2', (offline || connection.onlyHere) && 'opacity-60')}
              disabled={connection.onlyHere}
              onClick={() => connection.onSelect(machine)}
            >
              <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', selectedMachine?.id === machine.id ? 'opacity-100' : 'opacity-0')} />
              <MachineIcon Icon={KindIcon} status={status} />
              <OptionLabel label={machineName(machine)} description={description} />
            </DropdownMenuItem>
          )
        })}
        {connection.onlyHere && connection.machines.length > 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            This project has no repository address, so it cannot be sent to another machine.
          </p>
        )}
        <DropdownMenuItem className="items-start" disabled={busy} onClick={() => connection.onAddMachine()}>
          <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <OptionLabel label="Add a machine…" description="Connect a computer, or join with a code." />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
