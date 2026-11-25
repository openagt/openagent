import { Check, Laptop, Workflow, type LucideIcon } from 'lucide-react'
import { rowButtonClass, RowChevron } from './ui/row-item.js'
import { OptionLabel } from './ui/option-label.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel } from './ui/dropdown-menu.js'

/**
 * Where the next run starts (#2394): this computer, or a host the project's modules bring (a CI
 * runner, `run.host`). A host is a run TARGET, selected in place: picking one does not
 * navigate the browser. The daemon starts the run on the host, which runs it on a machine of its own.
 */
export type ConnectionControl = {
  /** A session with no project: it runs in a folder of its own. */
  noProject?: boolean | undefined
  /** Clear the pick back to this computer. */
  onSelectLocal: () => void
  /** The hosts beside this computer the project's modules bring (`run.host`): where a run may be picked to run. */
  hosts: readonly { id: string; label: string }[]
  /** The host picked as the run target, by its id; null when none is. */
  selectedHostId: string | null
  /** Select a host as the run target, with no navigation. */
  onSelectHost: (id: string) => void
}

/** The icon of a host beside this computer. */
export const HOST_ICON: LucideIcon = Workflow

/** What this computer is called in "Run on" and wherever a run's place is said. */
export const THIS_MACHINE = 'This machine'

/** The target in words, as the row above the box draws it: its icon, with a dot when it is not this machine, and its name. The menu adds its chevron. */
export function RunOnWords({ icon: Icon, elsewhere, label }: { icon: LucideIcon; elsewhere: boolean; label: string }) {
  return (
    <>
      <span className="relative flex shrink-0">
        <Icon className="size-4 shrink-0" aria-hidden />
        {elsewhere && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />}
      </span>
      <span className="truncate">{label}</span>
    </>
  )
}

// One flat "Run on" list: this machine, then the project's hosts, with a single checkmark. Its
// button is the target in words, drawn as the rows around the box draw their items, for the row
// above it.
export function RunOnMenu({ connection, busy }: { connection: ConnectionControl; busy: boolean }) {
  // A host picked is the target, where the project has it.
  const selectedHost = connection.selectedHostId ? connection.hosts.find(host => host.id === connection.selectedHostId) : undefined
  const summary = selectedHost ? selectedHost.label : THIS_MACHINE
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger type="button" disabled={busy} aria-label={`Run on: ${summary}`} className={rowButtonClass} />
          }
        >
          <RunOnWords icon={selectedHost ? HOST_ICON : Laptop} elsewhere={selectedHost !== undefined} label={summary} />
          <RowChevron />
        </TooltipTrigger>
        <TooltipContent>{`Run on — ${summary}`}</TooltipContent>
      </Tooltip>
      {/* The words are at the row's left: the menu opens inward. */}
      <DropdownMenuContent align="start" className="min-w-[19rem] max-w-[22rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Run on</DropdownMenuLabel>
          {/* Each row leads with its mark; the pick is the tick at the row's end. */}
          <DropdownMenuItem className="items-start" onClick={() => connection.onSelectLocal()}>
            <Laptop className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <OptionLabel label={THIS_MACHINE} description={connection.noProject ? 'Runs here, in a folder of its own.' : 'Runs here, in this project.'} />
            {!selectedHost && <Check className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
          </DropdownMenuItem>
          {/* The project's hosts: a click selects the host as the run target, which runs it on a machine of its own. */}
          {connection.hosts.map(host => (
            <DropdownMenuItem key={`host:${host.id}`} className="items-start" onClick={() => connection.onSelectHost(host.id)}>
              <HOST_ICON className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <OptionLabel label={host.label} description="Runs this project on a machine of its own." />
              {selectedHost?.id === host.id && <Check className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
