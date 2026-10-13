import { Laptop, Server } from 'lucide-react'

// The agent view's banner for a session running on a saved machine (#1067, slice 2). Its live feed,
// diff, worktree, handoff, push/PR and live screen all relay back through the local daemon and render
// normally, so this only flags where the agent executes. Renders nothing without a machine's name, so the agent view
// can mount it unconditionally. A machine that is a person's own computer, reached by the line it
// keeps open here (`byLine`), is drawn as a computer.
export function RemoteAgentNotice({ machine, byLine = false }: { machine?: string | undefined; byLine?: boolean | undefined }) {
  if (!machine) return null
  const Icon = byLine ? Laptop : Server
  return (
    <div role="status" className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        Running on {machine}. Its worktree, diff, and pull request live on that machine.
      </span>
    </div>
  )
}
