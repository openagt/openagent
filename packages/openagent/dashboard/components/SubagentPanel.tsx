import { useMemo } from 'react'
import type { AgentMeta, OpenAgentEvent } from '../../src/index.js'
import { onAgent } from '../rpc/reads.js'
import { panesPage } from '../lib/panes.js'
import { useRevealedSubagent } from '../lib/reveal-change.js'
import { callRow, callSubagents, runRow, subagentTranscript, type SubagentRow } from '../lib/subagents.js'
import { formatElapsed } from '../lib/format-date.js'
import { anyModelName, useModels } from '../lib/models.js'
import { STATUS_TONE } from '../lib/status-tone.js'
import { usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { EventList } from './EventList.js'
import { PaneActions, PaneTitle } from './PaneHeader.js'
import { Seconds } from './ToolCalls.js'

// The pane beside a main agent's chat that shows one of its subagents, opened from the subagent's
// row: what it runs on and how it stands, the whole prompt it was given, then what it said and did.
// A subagent that is a run of its own is read from its own log, and its page is one click away; one
// the coding agent started inside its session is read out of the main agent's log, where its events
// are, and has no page and no branch of its own.

/** How often a working subagent's own log is read again: the runs poll's own pace. */
const TRANSCRIPT_EVERY_MS = 2_000
/** How often an ended one's is: it changes no more, and a read now and then costs nothing. */
const ENDED_EVERY_MS = 60_000
const NO_EVENTS: OpenAgentEvent[] = []

export function SubagentPanel({
  projectId,
  agentId,
  events,
  subagents,
  live,
  onOpenAgent,
}: {
  projectId: string
  /** The main agent. */
  agentId: string
  /** The main agent's log. */
  events: readonly OpenAgentEvent[]
  /** The runs started for the main agent. */
  subagents: readonly AgentMeta[]
  /** Whether the main agent's process is working. */
  live: boolean
  /** Open a run's own page. */
  onOpenAgent?: ((agentId: string) => void) | undefined
}) {
  const asked = useRevealedSubagent(panesPage(projectId, agentId))
  const calls = useMemo(() => callSubagents(events), [events])
  const key = asked?.key
  const agent = subagents.find(one => `run:${one.id}` === key)
  const call = calls.find(one => `call:${one.id}` === key)
  const row = agent ? runRow(agent, undefined) : call ? callRow(call, live, events[0]?.at ?? new Date(0).toISOString()) : undefined
  if (!row) return <p className="p-3 text-sm text-muted-foreground">This subagent is not one of this run’s.</p>
  return <Shown key={row.key} row={row} projectId={projectId} events={events} onOpenAgent={onOpenAgent} />
}

function Shown({ row, projectId, events, onOpenAgent }: { row: SubagentRow; projectId: string; events: readonly OpenAgentEvent[]; onOpenAgent?: ((agentId: string) => void) | undefined }) {
  const runId = row.agent?.id
  // A run's own log, read often while it works. Remembered by the run, so the pane opened again,
  // and the read that goes on when the subagent ends, show what was read from the first frame:
  // without that the pane said it had nothing to show until the read answered.
  const { value: ownLog, loaded } = usePolled<OpenAgentEvent[]>(
    runId ? () => onAgent(projectId, runId) : null,
    NO_EVENTS,
    row.working ? TRANSCRIPT_EVERY_MS : ENDED_EVERY_MS,
    [projectId, runId, row.working],
    runId ? { remember: `subagent-log:${projectId}:${runId}` } : undefined,
  )
  // A call's transcript is the main agent's events that are its own, shown as plain steps here.
  const callId = row.call?.id
  const transcript = useMemo(() => (callId !== undefined ? subagentTranscript(events, callId).map(untagged) : withoutPrompt(ownLog, row.prompt)), [callId, events, ownLog, row.prompt])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneTitle>
        <h2 className="min-w-0 flex-1 truncate pl-2 text-xs font-medium text-foreground">{row.name}</h2>
      </PaneTitle>
      {runId && onOpenAgent && (
        <PaneActions>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => onOpenAgent(runId)}>
            Open its page
          </Button>
        </PaneActions>
      )}
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 pb-3 text-xs">
        <Facts row={row} />
        {row.prompt && (
          <section aria-label="Its prompt">
            <h3 className="mb-1 text-muted-foreground">Prompt</h3>
            <div className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-2.5 py-1.5 font-mono text-foreground">{row.prompt}</div>
          </section>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {transcript.length > 0 ? (
          <EventList events={transcript} working={row.working} stick={row.working} openAt="start" />
        ) : runId && !loaded ? null : (
          <p className="p-3 text-xs text-muted-foreground">{row.working ? 'Nothing said or done yet.' : 'It left nothing to show.'}</p>
        )}
      </div>
    </div>
  )
}

/** How the subagent stands, on a line: its model, its status, how long, what it cost, where its work is. */
function Facts({ row }: { row: SubagentRow }) {
  const models = useModels()
  const where = row.call ? 'no branch: it works in this run’s checkout' : row.agent?.branch ? `on ${row.agent.branch}` : row.agent?.landed ? 'landed' : undefined
  const parts = [
    row.model !== undefined ? anyModelName(models, row.model) : undefined,
    row.call?.role,
    row.cost !== undefined ? `$${row.cost.toFixed(2)}` : undefined,
    where,
  ].filter(Boolean)
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-muted-foreground">
      <span className={cn(row.working ? 'text-foreground' : (STATUS_TONE[row.status] ?? 'text-muted-foreground'))}>{row.status}</span>
      <span className="tabular-nums">{row.working ? <Seconds since={row.startedAt} /> : row.endedAt !== undefined ? formatElapsed(Date.parse(row.endedAt) - Date.parse(row.startedAt)) : null}</span>
      {parts.map(part => (
        <span key={part}>{part}</span>
      ))}
    </div>
  )
}

/** A run's log without its first prompt when that is the prompt the pane already shows above it. */
function withoutPrompt(events: OpenAgentEvent[], prompt: string | undefined): OpenAgentEvent[] {
  const at = events.findIndex(e => e.kind === 'driver' && e.event.type === 'start')
  const first = events[at]
  return first?.kind === 'driver' && first.event.type === 'start' && first.event.prompt === prompt ? events.filter((_, i) => i !== at) : events
}

/** One of a call's own events without the mark that makes the main agent's chat pass it over. */
function untagged(e: OpenAgentEvent): OpenAgentEvent {
  if (e.kind !== 'driver' || !('subagent' in e.event)) return e
  const { subagent: _subagent, ...event } = e.event
  return { ...e, event } as OpenAgentEvent
}
