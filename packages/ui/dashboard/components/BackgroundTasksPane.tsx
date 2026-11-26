import { useEffect, useState, type ReactNode } from 'react'
import { SquareTerminal } from 'lucide-react'
import type { BackgroundTask } from '@openagt/hooks'

// The side panel's Background tasks tab, as Claude Code on the web has it: what the agent leaves
// running in the background while it waits (a test run, a server), each with how long it has gone
// on, then the run's subagents (SubagentsPanel). Neither has a Stop of its own: the session's Stop
// stops all of it.

/** How long something has gone on, as a short count: `34s`, `1m 12s`, `2h 5m`. */
export function lasted(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** The time now, a second at a time while `ticking`. */
export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking])
  return now
}

export function BackgroundTasksPane({ background, subagents }: { background: readonly BackgroundTask[]; /** The run's subagents' pane, when it started any. */ subagents?: ReactNode }) {
  const now = useNow(background.length > 0)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {background.length > 0 && (
        <section aria-label="Background commands" className="shrink-0 border-b border-border px-3 py-2.5">
          <h3 className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">{`Running ${background.length}`}</h3>
          <ul className="flex flex-col gap-1">
            {background.map(task => (
              <li key={task.id} className="flex items-center gap-2.5 rounded-md border border-border bg-card px-2.5 py-2 text-sm">
                <SquareTerminal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{task.description ?? task.command ?? 'A background task'}</span>
                  {task.command && task.description && <span className="block truncate font-mono text-xs text-muted-foreground">{task.command}</span>}
                </span>
                <span className="shrink-0 text-[13px] text-muted-foreground">{lasted(now - Date.parse(task.since))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {subagents}
    </div>
  )
}
