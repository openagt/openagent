import { Check, ChevronDown, Laptop, MonitorSmartphone, Plus, X } from 'lucide-react'
import type { Machine } from '../lib/machines.js'
import type { MachineStatus } from '../lib/use-machine-status.js'
import { cn } from '../lib/utils.js'
import { buttonVariants } from './ui/button.js'
import { chipClass } from './ui/chip.js'
import { OptionLabel } from './ui/option-label.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu.js'

/**
 * Where the next run starts (#1052/#1066/#1067): the machine this dashboard is on, or one of the
 * machines saved on it. A machine is a run TARGET, selected in place: picking one does not
 * navigate the browser. The daemon relays the start to it, and that machine runs the start hook
 * of its own copy of the project.
 */
export type ConnectionControl = {
  /** The saved machines a run can be sent to. */
  machines: Machine[]
  /** The host of the dashboard's address, which names the machine it is on when that is not this one. */
  currentHost: string | null
  /** Whether the dashboard's address is loopback (this machine's own daemon). */
  isLocal: boolean
  /** The machine selected as the run target (its id), or null when the dashboard's own machine is (#1067). */
  selectedMachineId: string | null
  /** The project has no repository address, the one name another machine would know it by: it runs here only. */
  onlyHere: boolean
  /** Select a saved machine as the run target, with no navigation (#1067). */
  onSelect: (machine: Machine) => void
  /** Clear the selection back to the dashboard's own machine (#1067). */
  onSelectLocal: () => void
  /** Return to this machine's own daemon when currently on another machine's dashboard (#1066). */
  onConnectLocal: () => void
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

// One flat "Run on" list (#1066/#1067): this machine, then the saved machines and "Add a machine",
// with a single checkmark. On another machine's dashboard (opened by its address), that machine
// has a row of its own, which carries the mark, and "This machine" goes home.
// Two looks for the one menu: an icon button for the compact single row, and a chip that also says
// the target in words, for the launcher's row above the box.
export function RunOnMenu({ connection, busy, chip = false }: { connection: ConnectionControl; busy: boolean; chip?: boolean | undefined }) {
  // The selected machine (#1067). An id pointing at a removed machine reads as none, and so does
  // any pick on a project that runs here only.
  const selectedMachine =
    connection.selectedMachineId && !connection.onlyHere ? connection.machines.find(m => m.id === connection.selectedMachineId) : undefined
  const dashboardsMachine = connection.isLocal ? 'This machine' : (connection.currentHost ?? 'Another machine')
  const summary = selectedMachine?.label ?? dashboardsMachine
  const onThisMachine = connection.isLocal && !selectedMachine
  const Icon = onThisMachine ? Laptop : MonitorSmartphone
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
                chip
                  ? cn(
                      chipClass,
                      'transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:pointer-events-none disabled:opacity-50',
                    )
                  : cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'relative h-8 w-8')
              }
            />
          }
        >
          {chip ? (
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
      {/* The chip is at the row's left, the icon button at the compact row's right: the menu opens inward. */}
      <DropdownMenuContent align={chip ? 'start' : 'end'} className="min-w-[19rem] max-w-[22rem]">
        <DropdownMenuItem
          className="items-start"
          onClick={() => (connection.isLocal ? connection.onSelectLocal() : connection.onConnectLocal())}
        >
          <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', onThisMachine ? 'opacity-100' : 'opacity-0')} />
          <OptionLabel label="This machine" description="Start the run here, through this project's start hook." />
        </DropdownMenuItem>
        {/* On another machine's dashboard, that machine is where a run starts unless one of its
            saved machines is picked. */}
        {!connection.isLocal && (
          <DropdownMenuItem className="items-start gap-2" onClick={() => connection.onSelectLocal()}>
            <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', selectedMachine ? 'opacity-0' : 'opacity-100')} />
            <MonitorSmartphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <OptionLabel label={dashboardsMachine} description="The machine this dashboard is on." />
          </DropdownMenuItem>
        )}
        {/* Saved machines: a click SELECTS the machine as the run target (no navigation). The dot
            shows reachability (#1072) and the X removes the saved machine. */}
        {connection.machines.map(machine => {
          const status = connection.status[machine.id]
          const offline = status === 'offline'
          return (
            <DropdownMenuItem
              key={machine.id}
              className={cn('items-start gap-2', (offline || connection.onlyHere) && 'opacity-60')}
              disabled={connection.onlyHere}
              onClick={() => connection.onSelect(machine)}
            >
              <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', selectedMachine?.id === machine.id ? 'opacity-100' : 'opacity-0')} />
              <MonitorSmartphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <StatusDot status={status} />
              <OptionLabel label={machine.label} description={offline ? `${machine.url} (offline)` : machine.url} />
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
          <OptionLabel label="Add a machine…" description="Paste the URL another machine prints when it is opened to the network." />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
