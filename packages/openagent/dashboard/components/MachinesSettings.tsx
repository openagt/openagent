import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useMachines, useMachinesLoaded, removeMachine, type Machine } from '../lib/machines.js'
import { useMachineStatus } from '../lib/use-machine-status.js'
import { useSelectedMachineId, selectMachine } from '../lib/remote-target.js'
import { AddMachineDialog } from './AddMachineDialog.js'
import { Button } from './ui/button.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { cn } from '../lib/utils.js'

// Saved machines, as a settings section (#1052/#1072).
//
// Adding and removing a machine already worked, but only from the composer's "Run on" menu, and the
// composer exists on a project launcher and nowhere else: from the Overview or the settings page
// there was no way to manage the list at all. The picker keeps listing machines, because choosing
// where an agent runs is a per-agent act; which machines exist is configuration, so it belongs here.
//
// The list is the daemon's, in the person's home file beside their settings, so it is the same in
// every browser on this computer.

export function MachinesSettings() {
  const machines = useMachines()
  const loaded = useMachinesLoaded()
  const status = useMachineStatus(machines)
  const selectedMachineId = useSelectedMachineId()
  const [adding, setAdding] = useState(false)

  // The same guard the composer applies (#1072): a machine that is removed must not stay the agent
  // target, or the next agent points at something that is no longer in the list.
  const remove = (machine: Machine) => {
    void removeMachine(machine.id).then(removed => {
      if (removed && selectedMachineId === machine.id) selectMachine(null)
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Machines</CardTitle>
          <p className="text-sm text-muted-foreground">
            Other machines running OpenAgent that you can run a session on. Saved with this OpenAgent, so every
            browser that opens it shows the same list.
          </p>
        </div>
        <Button size="sm" variant="outline" className="shrink-0 whitespace-nowrap" onClick={() => setAdding(true)}>
          Add machine
        </Button>
      </CardHeader>
      <CardContent>
        {!loaded ? null : machines.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No machines saved. Add one with the URL another machine prints when it is opened to the network.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {machines.map(machine => (
              <li key={machine.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm">{machine.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{machine.url}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <MachineStatusBadge state={status[machine.id]} />
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => remove(machine)}
                          aria-label={`Remove ${machine.label}`}
                        />
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </TooltipTrigger>
                    <TooltipContent>Remove {machine.label}</TooltipContent>
                  </Tooltip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {adding && <AddMachineDialog onClose={() => setAdding(false)} onAdded={() => setAdding(false)} />}
    </Card>
  )
}

/** Online / offline, or neither while the first ping is still out. */
function MachineStatusBadge({ state }: { state: 'online' | 'offline' | undefined }) {
  const label = state === 'online' ? 'Online' : state === 'offline' ? 'Offline' : 'Checking…'
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          state === 'online' ? 'bg-[var(--color-primary)]' : 'bg-muted-foreground/40',
        )}
      />
      {label}
    </span>
  )
}
