import { Check, ChevronDown, Laptop, Server, Plus, X } from 'lucide-react'
import type { Machine } from '../lib/machines.js'
import type { MachineStatus } from '../lib/use-machine-status.js'
import { thisMachineName } from '../lib/this-machine.js'
import { reachedByLine } from '../../src/client.js'
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
 * A saved machine can be a person's own computer, reached by the line it keeps open to this
 * server (reached-by-line.ts). It is drawn as a computer and described as one, not by the
 * address that stands for it here, and it has no remove: it goes when the computer is taken out,
 * under Devices.
 *
 * A machine can also be another person's computer, set up as a server and shared with everyone on
 * this one: it says whose it is, and that a run there uses this person's own logins.
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
  /** Drop a saved machine (#1072). The caller clears the selection if this was the run target. */
  onRemove: (machine: Machine) => void
  /** Each machine's online/offline status (#1072); an id absent from the map is still being checked. */
  status: Record<string, MachineStatus>
}

/** A small reachability dot on a machine's row (#1072): green online, muted offline or still unknown. */
function StatusDot({ status }: { status: MachineStatus | undefined }) {
  return <span aria-hidden className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', status === 'online' ? 'bg-success' : 'bg-muted-foreground/40')} />
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
  const summary = selectedMachine?.label ?? here
  const onThisMachine = !selectedMachine
  const Icon = onThisMachine || reachedByLine(selectedMachine.url) ? Laptop : Server
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
        <TooltipContent>{`Run on — ${summary}`}</TooltipContent>
      </Tooltip>
      {/* The words are at the row's left, the icon button at the compact row's right: the menu opens inward. */}
      <DropdownMenuContent align={inRow ? 'start' : 'end'} className="min-w-[19rem] max-w-[22rem]">
        <DropdownMenuItem className="items-start" onClick={() => connection.onSelectLocal()}>
          <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', onThisMachine ? 'opacity-100' : 'opacity-0')} />
          <OptionLabel label={here} description="Start the run here, through this project's start hook." />
        </DropdownMenuItem>
        {/* Saved machines: a click SELECTS the machine as the run target (no navigation). The dot
            shows reachability (#1072) and the X removes the saved machine. */}
        {connection.machines.map(machine => {
          const status = connection.status[machine.id]
          const offline = status === 'offline'
          const computer = reachedByLine(machine.url)
          // Another person's computer, set up as a server and shared with everyone: drawn and described as theirs.
          const MachineIcon = computer && machine.owner === undefined ? Laptop : Server
          const description = offline
            ? computer
              ? 'Not connected. It must be on, with OpenAgent running.'
              : `${machine.url} (offline)`
            : machine.owner !== undefined
              ? `@${machine.owner}'s server. The run starts there, with your own logins.`
              : computer
                ? 'Your computer. The run starts there.'
                : machine.url
          return (
            <DropdownMenuItem
              key={machine.id}
              className={cn('items-start gap-2', (offline || connection.onlyHere) && 'opacity-60')}
              disabled={connection.onlyHere}
              onClick={() => connection.onSelect(machine)}
            >
              <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', selectedMachine?.id === machine.id ? 'opacity-100' : 'opacity-0')} />
              <MachineIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <StatusDot status={status} />
              <OptionLabel label={machine.label} description={description} />
              {!computer && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={e => {
                          // Remove, not select: keep the row's own click out of it (#1072).
                          e.stopPropagation()
                          connection.onRemove(machine)
                        }}
                        aria-label={`Remove machine ${machine.label}`}
                        className="mt-0.5 rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-danger"
                      />
                    }
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent>Remove {machine.label}</TooltipContent>
                </Tooltip>
              )}
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
          <OptionLabel label="Add a machine…" description="In Settings › Devices: connect a computer, or join with a code." />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
