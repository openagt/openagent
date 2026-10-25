import { Laptop, MonitorSmartphone, Server } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, Tooltip, TooltipContent, TooltipTrigger, cn, formatAge, usePolled, useModuleHost, type Health, type ModuleCardProps, type ModuleMachine, type ModuleMachines } from '@openagt/dashboard/module'
import { loadStatus, type Answer, type DoorStatus } from './devices.js'
import { THROUGH } from './model.js'
import { olderThan } from './parts.js'

// The Overview's Devices card: this computer and every computer and server it saved, each with
// whether it answers, how much of its memory and disk is in use and how busy it is, and the
// OpenAgent it runs, marked when it fell behind this computer's; then one line for the phones and
// browsers in at this computer. Read from what is cheap to ask: one short call to each saved
// machine (its ping, which says how it stands), and this computer's door. Never a server's SSH,
// which Settings › Devices reads: a card polled on the Overview logging in to every server would
// be a login every few seconds. Its title opens Settings › Devices.

/** How often the card asks again: each time is one call to each saved machine. */
const EVERY_MS = 30_000

/** A computer that got in at this door by itself is listed under this name: it is a computer, not a phone. */
const AGENT_NAME = /^OpenAgent on /

export function DevicesCard(_props: ModuleCardProps) {
  const host = useModuleHost()
  const { value: machines, loaded } = usePolled<ModuleMachines | undefined>(() => host.machines(), undefined, EVERY_MS, [])
  const { value: door } = usePolled<Answer<DoorStatus> | undefined>(() => loadStatus(host), undefined, EVERY_MS, [])
  const phones = door?.ok ? door.value.devices.filter(device => !device.line && !AGENT_NAME.test(device.name)) : []
  const lastSeen = phones.map(phone => phone.seen ?? '').sort().at(-1)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          <button type="button" onClick={() => host.openSettings('devices')} className="-mx-1 inline-flex items-center gap-2 rounded px-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
            <MonitorSmartphone className="h-4 w-4 text-muted-foreground" aria-hidden />
            Devices
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {!loaded || !machines ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ul className="space-y-2.5">
            <Row icon={Laptop} name={machines.name ?? 'This computer'} note="this computer" online health={machines.health} />
            {machines.machines.map(machine => (
              <Row
                key={machine.id}
                icon={kindOf(machine) === 'computer' ? Laptop : Server}
                name={machine.label}
                note={machine.owner !== undefined ? `${machine.owner}'s` : kindOf(machine) === 'through' ? 'through a server' : undefined}
                online={machine.version !== undefined}
                health={machine.health}
                behind={machine.version !== undefined && olderThan(machine.version, machines.version) ? machine.version : undefined}
              />
            ))}
          </ul>
        )}
        {phones.length > 0 && (
          <button type="button" onClick={() => host.openSettings('devices')} className="block text-left text-xs text-muted-foreground hover:text-foreground hover:underline">
            {phones.length === 1 ? '1 phone or browser' : `${phones.length} phones and browsers`} in
            {lastSeen ? ` · last seen ${formatAge(lastSeen)}` : ''}
          </button>
        )}
      </CardContent>
    </Card>
  )
}

/** What a saved machine is, by where it answers: a computer reached through a server, else a server or a computer of its own address. */
function kindOf(machine: ModuleMachine): 'through' | 'computer' | 'server' {
  if (machine.url.includes(THROUGH)) return 'through'
  return machine.url.startsWith('https://') ? 'server' : 'computer'
}

/**
 * One computer on one line: its mark, its name, and at the end, when it answers and says, three
 * small rings, how much of its memory and disk is in use and how busy it is, each with its share
 * inside and its name under; when it does not answer, that it is offline. Laid out to fit a quarter
 * of the Overview: the name gives up its width, the rings never.
 */
function Row({ icon: Icon, name, note, online, health, behind }: { icon: typeof Laptop; name: string; note?: string | undefined; online: boolean; health: Health | undefined; behind?: string | undefined }) {
  return (
    <li className="flex min-w-0 items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="min-w-0 truncate font-medium" title={name}>
            {name}
          </span>
          <span aria-label={online ? 'online' : 'offline'} title={online ? 'online' : 'offline'} className={cn('size-1.5 shrink-0 rounded-full', online ? 'bg-success' : 'bg-muted-foreground/50')} />
        </p>
        <p className="truncate text-xs text-muted-foreground">{behind !== undefined ? <span className="text-warning">OpenAgent {behind}: update it</span> : !online ? 'offline' : note}</p>
      </div>
      {online && health && (
        <div className="flex shrink-0 gap-1.5">
          <Gauge label="RAM" share={share(health.memory)} said={`${size(health.memory.used)} of ${size(health.memory.total)} in use`} />
          {health.disk && <Gauge label="Disk" share={share(health.disk)} said={`${size(health.disk.used)} of ${size(health.disk.total)} in use`} />}
          {health.load !== undefined && <Gauge label="CPU" share={Math.min(100, health.load)} said={`its processors ${health.load}% busy, lately`} />}
        </div>
      )}
    </li>
  )
}

const GB = 1024 ** 3
const size = (bytes: number): string => (bytes >= 100 * GB ? `${Math.round(bytes / GB)} GB` : `${(bytes / GB).toFixed(1)} GB`)
const share = (part: { total: number; used: number }): number => Math.round((part.used / part.total) * 100)

/** A small ring, filled as far as the share in use, the share inside it, its name under it; amber near full, red at it. */
function Gauge({ label, share, said }: { label: string; share: number; said: string }) {
  const r = 12
  const around = 2 * Math.PI * r
  // Whole class names, as the stylesheet's build finds them in the source.
  const tone = share >= 95 ? { ring: 'stroke-danger', text: 'text-danger' } : share >= 80 ? { ring: 'stroke-warning', text: 'text-warning' } : { ring: 'stroke-success', text: 'text-foreground' }
  return (
    <Tooltip>
      <TooltipTrigger render={<div role="meter" aria-label={label} aria-valuenow={share} aria-valuemin={0} aria-valuemax={100} className="flex w-8 flex-col items-center" />}>
        <span className="relative size-8">
          <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
            <circle cx="16" cy="16" r={r} fill="none" strokeWidth="3" className="stroke-muted-foreground/15" />
            <circle cx="16" cy="16" r={r} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(around * Math.min(share, 100)) / 100} ${around}`} transform="rotate(-90 16 16)" className={cn('transition-[stroke-dasharray] duration-500', tone.ring)} />
          </svg>
          <span className={cn('absolute inset-0 flex items-center justify-center text-[9px] font-medium tabular-nums', tone.text)}>{share}</span>
        </span>
        <span className="text-[9px] leading-tight text-muted-foreground">{label}</span>
      </TooltipTrigger>
      <TooltipContent>
        {label}: {said}
      </TooltipContent>
    </Tooltip>
  )
}
