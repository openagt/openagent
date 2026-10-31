import { useEffect, useState } from 'react'
import { CircleCheck, CircleHelp, CircleSlash, CircleX } from 'lucide-react'
import type { AgentMeta } from '../../src/index.js'
import { cn } from '@openagt/skill-ui/module'
import { formatElapsed } from '../lib/format-date.js'
import { STATUS_TONE } from '../lib/status-tone.js'
import { anyModelName, useModels } from '../lib/models.js'
import { rollUp, runRow, type SubagentRow } from '../lib/subagents.js'
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
      {row.model && <span className="shrink-0 text-muted-foreground max-sm:hidden">{anyModelName(models, row.model)}</span>}
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

// The moment a subagent ended, as its main agent was told it: how it ended, by an icon in its
// colour, and the subagent named as its row names it, in the chat's own type rather than the log's.
// It never changes, unlike its row. A click opens it as its row does.
export function SubagentLine({ agent, end, onOpen }: { agent: AgentMeta; end: { status: string; detail?: string }; onOpen?: ((key: string) => void) | undefined }) {
  const row = runRow(agent, undefined)
  const models = useModels()
  const Icon = end.status === 'done' ? CircleCheck : end.status === 'failed' ? CircleX : end.status === 'waiting' ? CircleHelp : CircleSlash
  const tone = end.status === 'waiting' ? 'text-muted-foreground' : (STATUS_TONE[end.status] ?? 'text-muted-foreground')
  return (
    <button type="button" onClick={() => onOpen?.(row.key)} className="group/sub flex min-w-0 items-center gap-1.5 text-left font-sans text-sm" aria-label={`Open the subagent: ${row.name}`}>
      <Icon className={cn('h-3.5 w-3.5 shrink-0', tone)} aria-hidden />
      <span className="min-w-0 truncate font-medium text-foreground group-hover/sub:underline">{row.name}</span>
      {row.model && <span className="shrink-0 text-muted-foreground max-sm:hidden">{anyModelName(models, row.model)}</span>}
      <span className="min-w-0 shrink-0 truncate text-muted-foreground">
        ended <span className={tone}>{end.status}</span>
        {end.detail && `: ${end.detail}`}
      </span>
    </button>
  )
}
