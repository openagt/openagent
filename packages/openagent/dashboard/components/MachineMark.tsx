import { House, Laptop, Server, Users } from 'lucide-react'
import type { MachineKind } from '../../src/client.js'
import { cn } from '@openagt/skill-ui/module'

/** The icon of a machine's kind: a computer, a server at home, another person's computer shared with you, or a server. */
export const MACHINE_ICONS = { computer: Laptop, home: House, shared: Users, server: Server } as const

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
 * project of another computer's. The name is the first part of the row to give up width. A row
 * with no room for it (`named` off) draws the icon alone, as the list of runs does, and says the
 * name to a screen reader; the row's own hover says it in words.
 */
export function OnComputer({ computer, named = true }: { computer: { name: string; kind?: MachineKind | undefined }; named?: boolean }) {
  const Icon = computer.kind ? MACHINE_ICONS[computer.kind] : Laptop
  if (!named) return <Icon role="img" aria-label={`Runs on ${computer.name}`} className="h-3 w-3 shrink-0 text-muted-foreground" />
  return (
    <span className="flex min-w-0 max-w-40 shrink-[4] items-center gap-1 text-xs text-muted-foreground">
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">on {computer.name}</span>
    </span>
  )
}
