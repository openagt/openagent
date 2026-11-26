import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { stopTask } from '../rpc/control.js'
import { cn } from '../lib/utils.js'

// The ■ on one task of a working run, as Claude Code on the web has it on each row of its
// Background tasks: a command its agent left in the background, or a subagent. It stops that one
// task at once, nothing asked: the agent is told, and goes on. Pressed, it turns into a spinner
// until the row goes, which is when the agent's driver says the task ended.

/** The ■ of one task, by the id its driver said it by: grey, 24 square, its square 10. */
export function StopTask({ projectId, agentId, task, name, className }: { projectId: string; agentId: string; task: string; name: string; className?: string }) {
  const [stopping, setStopping] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  // Another task in the same place is another press.
  useEffect(() => {
    setStopping(false)
    setRefused(null)
  }, [task])
  const press = async () => {
    setStopping(true)
    setRefused(null)
    const said = await stopTask(projectId, agentId, task).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    if (!said.ok) {
      setStopping(false)
      setRefused(said.error)
    }
  }
  const label = refused !== null ? `Could not stop ${name}: ${refused}` : stopping ? `Stopping ${name}` : `Stop ${name}`
  return (
    <button
      type="button"
      aria-label={label}
      title={refused !== null ? label : stopping ? 'Stopping…' : 'Stop'}
      aria-disabled={stopping || undefined}
      onClick={event => {
        // A row that opens something holds the ■: its press is the ■'s alone.
        event.stopPropagation()
        if (!stopping) void press()
      }}
      className={cn(
        'focus-ring inline-grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground aria-disabled:pointer-events-none',
        refused !== null && 'text-danger',
        className,
      )}
    >
      {stopping ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <span aria-hidden className="size-2.5 rounded-xs bg-current" />}
    </button>
  )
}
