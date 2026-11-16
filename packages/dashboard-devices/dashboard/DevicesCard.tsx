import { GaugeFace, PageLink, Panel, PanelGroup, PanelRow, PanelShape, Slot, MachineMark, Tooltip, TooltipContent, TooltipTrigger, formatAge, machineKind, machineName, usePolled, useModuleHost, type Health, type MachineKind, type ModuleCardProps, type ModuleMachines } from '@openagt/dashboard/module'
import { Smartphone } from 'lucide-react'
import { loadStatus, type Answer, type DoorStatus } from './devices.js'
import { isComputer } from './model.js'
import { olderThan } from './parts.js'

// The Overview's Devices card: this computer and every computer and server it saved, each with
// whether it answers, how much of its memory and disk is in use and how busy it is, and the
// OpenAgent it runs, marked when it fell behind this computer's; then one line for the phones and
// browsers in at this computer. Read from what is cheap to ask: one short call to each saved
// machine (its ping, which says how it stands), and this computer's door. Never a server's SSH,
// which Settings › Devices reads: a card polled on the Overview logging in to every server would
// be a login every few seconds. The link at its heading opens Settings › Devices.

/** How often the card asks again: each time is one call to each saved machine. */
const EVERY_MS = 30_000

export function DevicesCard(_props: ModuleCardProps) {
  const host = useModuleHost()
  // Kept for the next visit: the page opens with the last machines and devices, faded until they are read again.
  const { value: machines, state } = usePolled<ModuleMachines | undefined>(() => host.machines(), undefined, EVERY_MS, [], { remember: 'devices:machines', stored: true })
  const { value: door } = usePolled<Answer<DoorStatus> | undefined>(() => loadStatus(host), undefined, EVERY_MS, [], { remember: 'devices:door', stored: true })
  const phones = door?.ok ? door.value.devices.filter(device => !isComputer(device)) : []
  const lastSeen = phones.map(phone => phone.seen ?? '').sort().at(-1)
  return (
    <PanelGroup
      bare
      title="Devices"
      // The address of Settings › Devices over the page that is open: its query alone.
      action={<PageLink href="?settings=devices" onOpen={() => host.openSettings('devices')}>Settings</PageLink>}
    >
      <Slot of={{ state: machines === undefined ? 'unknown' : state, value: machines }} shape={<PanelShape />}>
        {() =>
          machines && (
            <Panel>
              <Row kind="computer" name={machines.name ?? 'This computer'} note="this computer" online health={machines.health} />
              {machines.machines.map(machine => (
                <Row
                  key={machine.id}
                  kind={machineKind(machine).kind}
                  name={machineName(machine)}
                  note={machineKind(machine).place}
                  online={machine.version !== undefined}
                  health={machine.health}
                  behind={machine.version !== undefined && olderThan(machine.version, machines.version) ? machine.version : undefined}
                />
              ))}
              {/* The phones and browsers in at this computer, one row for all of them: each is in Settings › Devices. */}
              {phones.length > 0 && (
                <PanelRow
                  state={<Smartphone className="size-3.5 text-muted-foreground" aria-hidden />}
                  title={`${phones.length === 1 ? '1 phone or browser' : `${phones.length} phones and browsers`} in`}
                  meta={lastSeen ? [`last seen ${formatAge(lastSeen)}`] : []}
                  onClick={() => host.openSettings('devices')}
                />
              )}
            </Panel>
          )
        }
      </Slot>
    </PanelGroup>
  )
}

/**
 * One computer, a row of the panel: its mark, with whether it answers on it, its name over where it
 * is, and at the end, when it answers and says, three small rings, how much of its memory and disk is
 * in use and how busy it is, each with its share inside and its name under; when it does not answer,
 * that it is offline. Laid out to fit a quarter of the Overview: the name gives up its width, the rings never.
 */
function Row({ kind, name, note, online, health, behind }: { kind: MachineKind; name: string; note?: string | undefined; online: boolean; health: Health | undefined; behind?: string | undefined }) {
  return (
    <PanelRow
      state={<MachineMark kind={kind} online={online} labelled />}
      title={name}
      titleHint={name}
      meta={[behind !== undefined ? <span className="text-warning">OpenAgent {behind}: update it</span> : !online ? 'offline' : note]}
      fact={
        online && health ? (
          <span className="flex gap-1.5">
            <Gauge label="RAM" share={share(health.memory)} said={`${size(health.memory.used)} of ${size(health.memory.total)} in use`} />
            {health.disk && <Gauge label="Disk" share={share(health.disk)} said={`${size(health.disk.used)} of ${size(health.disk.total)} in use`} />}
            {health.load !== undefined && <Gauge label="CPU" share={Math.min(100, health.load)} said={`its processors ${health.load}% busy, lately`} />}
          </span>
        ) : undefined
      }
    />
  )
}

const GB = 1024 ** 3
const size = (bytes: number): string => (bytes >= 100 * GB ? `${Math.round(bytes / GB)} GB` : `${(bytes / GB).toFixed(1)} GB`)
const share = (part: { total: number; used: number }): number => Math.round((part.used / part.total) * 100)

/** A ring of how much is in use, saying what that is on a hover. */
function Gauge({ label, share, said }: { label: string; share: number; said: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<div role="meter" aria-label={label} aria-valuenow={share} aria-valuemin={0} aria-valuemax={100} className="flex w-8 flex-col items-center" />}>
        <GaugeFace label={label} share={share} />
      </TooltipTrigger>
      <TooltipContent>
        {label}: {said}
      </TooltipContent>
    </Tooltip>
  )
}
