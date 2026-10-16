import { useEffect, useState } from 'react'
import type { AgentDoing, AgentMeta } from '../../src/index.js'
import { cn } from '../lib/utils.js'
import { formatElapsed } from '../lib/format-date.js'
import { STATUS_TONE } from '../lib/status-tone.js'
import { anyModelName, useModels } from '../lib/models.js'
import { rollUp, runRow, type SubagentRow } from '../lib/subagents.js'
import { DisclosureToggle } from './DisclosureToggle.js'
import { Seconds } from './ToolCalls.js'

// A subagent on its main agent's page, on one line, whichever kind it is: a run of the project's
// own on a branch of its own, or one the coding agent started inside its session, which has none
// and says so. Its name, its model, then while it works the tool it is on and how many calls it
// made, and how long it has worked, counted up live; once it ended, how it ended and how long it
// took. A click opens it in the pane beside the chat, its prompt and its transcript.
export function SubagentItem({ row, onOpen }: { row: SubagentRow; onOpen?: ((key: string) => void) | undefined }) {
  const models = useModels()
  const tone = row.status === 'waiting' ? 'text-muted-foreground' : (STATUS_TONE[row.status] ?? 'text-muted-foreground')
  return (
    <button
      type="button"
      onClick={() => onOpen?.(row.key)}
      className="group/sub flex min-w-0 flex-1 items-baseline gap-2 text-left"
      aria-label={`Open the subagent: ${row.name}`}
    >
      <span className="w-1.5 shrink-0 self-center" aria-hidden>
        {row.working && <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />}
      </span>
      <span className="min-w-0 shrink truncate text-foreground group-hover/sub:underline">{row.name}</span>
      {/* On a phone the name has the line: the model is in the subagent's pane. */}
      {row.model && <span className="hidden shrink-0 text-muted-foreground sm:inline">{anyModelName(models, row.model)}</span>}
      {row.call && <span className="shrink-0 rounded-sm border border-border px-1 text-[10px] leading-4 text-muted-foreground">no branch</span>}
      {row.working ? (
        // What it is on now and how many calls it made; its last step whole on a hover.
        row.calls !== undefined && (
          <span className="min-w-0 shrink-0 truncate text-muted-foreground" title={row.doing}>
            {[row.tool, `${row.calls} ${row.calls === 1 ? 'call' : 'calls'}`].filter(Boolean).join(' · ')}
          </span>
        )
      ) : (
        <span className={cn('shrink-0', tone)}>{row.status}</span>
      )}
      <span className="ml-auto shrink-0 tabular-nums text-muted-foreground" title={`Started ${new Date(row.startedAt).toLocaleString()}`}>
        {row.working ? <Seconds since={row.startedAt} /> : row.endedAt !== undefined ? formatElapsed(Date.parse(row.endedAt) - Date.parse(row.startedAt)) : null}
      </span>
    </button>
  )
}

/** The time now, read again every second while `live`: what a count of a group still working needs. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [live])
  return now
}

/** What a group of subagents comes to, on one line: `3 agents · 1m 7s · $0.61`. */
export function rollUpText(rows: readonly SubagentRow[], now: number): string {
  const { count, ms, cost } = rollUp(rows, now)
  return [`${count} ${count === 1 ? 'agent' : 'agents'}`, formatElapsed(ms), ...(cost !== undefined ? [`$${cost.toFixed(2)}`] : [])].join(' · ')
}

// The subagents one turn started, together: a line saying what all of them come to, then one row
// each. A turn that started one has its row alone, which already says all of that.
export function SubagentGroup({ rows, onOpen }: { rows: readonly SubagentRow[]; onOpen?: ((key: string) => void) | undefined }) {
  const now = useNow(rows.some(row => row.working))
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      {rows.length > 1 && <div className="text-muted-foreground">{rollUpText(rows, now)}</div>}
      {rows.map(row => (
        <SubagentItem key={row.key} row={row} onOpen={onOpen} />
      ))}
    </div>
  )
}

// The moment a subagent ended, as its main agent was told it: its name and `ended <status>`, which
// never changes, unlike its row. A click opens it as its row does.
export function SubagentLine({ agent, end, onOpen }: { agent: AgentMeta; end: { status: string; detail?: string }; onOpen?: ((key: string) => void) | undefined }) {
  const row = runRow(agent, undefined)
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <button type="button" onClick={() => onOpen?.(row.key)} className="min-w-0 shrink truncate text-left text-foreground hover:underline" aria-label={`Open the subagent: ${row.name}`}>
        ↳ {row.name}
      </button>
      <span className={cn('shrink-0', end.status === 'waiting' ? 'text-muted-foreground' : (STATUS_TONE[end.status] ?? 'text-muted-foreground'))}>ended {end.status}</span>
      {end.detail && <span className="max-w-[45%] shrink-0 truncate text-muted-foreground">{end.detail}</span>}
    </span>
  )
}

// The line above the message box while any of the run's subagents is working: how many of them
// are, so it is known once their rows have scrolled out of view. Opened, it lists every subagent
// as its row in the chat does. Gone once none is working: the rows in the chat stay.
export function SubagentsBar({
  subagents,
  doing,
  onOpen,
}: {
  subagents: readonly AgentMeta[]
  doing: Record<string, AgentDoing>
  onOpen?: ((key: string) => void) | undefined
}) {
  const [open, setOpen] = useState(false)
  const working = subagents.filter(agent => agent.status === 'running').length
  if (working === 0) return null
  return (
    <div className="border-t border-border py-1.5">
      <div className="mx-auto w-full max-w-3xl px-4">
        <DisclosureToggle open={open} onToggle={() => setOpen(o => !o)}>
          Subagents · {working} of {subagents.length} running
        </DisclosureToggle>
        {open && (
          <div className="mt-1 flex flex-col gap-0.5 pl-4 font-mono text-xs">
            {subagents.map(agent => (
              <SubagentItem key={agent.id} row={runRow(agent, doing[agent.id])} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
