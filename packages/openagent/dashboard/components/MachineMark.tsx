import { House, Laptop, Server } from 'lucide-react'
import type { MachineKind } from '../../src/client.js'
import { cn } from '../lib/utils.js'

/** The icon of a machine's kind: a computer, a server at home, or a server. */
export const MACHINE_ICONS = { computer: Laptop, home: House, shared: Server, server: Server } as const

/**
 * A machine's mark wherever machines are listed: the icon of its kind, with a dot on it, green
 * while it answers, muted while it does not or is not asked yet. `labelled`, the dot says so to a
 * screen reader; where the row says it in words, it is left out.
 */
export function MachineMark({ kind, online, labelled = false, className }: { kind: MachineKind; online: boolean | undefined; labelled?: boolean; className?: string | undefined }) {
  const Icon = MACHINE_ICONS[kind]
  return (
    <span className={cn('relative flex shrink-0', className)}>
      <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <span {...(labelled ? { 'aria-label': online ? 'online' : 'offline', title: online ? 'online' : 'offline' } : { 'aria-hidden': true })} className={cn('absolute -right-1 -bottom-0.5 size-1.5 rounded-full', online ? 'bg-success' : 'bg-muted-foreground/50')} />
    </span>
  )
}

/**
 * Where a row's run runs, when that is another of the person's computers: the icon of its kind (a
 * laptop for a computer whose kind is not known) and its name, as the project picker marks a
 * project of another computer's. The name is the first part of the row to give up width.
 */
export function OnComputer({ computer }: { computer: { name: string; kind?: MachineKind | undefined } }) {
  const Icon = computer.kind ? MACHINE_ICONS[computer.kind] : Laptop
  return (
    <span className="flex min-w-0 max-w-40 shrink-[4] items-center gap-1 text-xs text-muted-foreground">
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">on {computer.name}</span>
    </span>
  )
}
