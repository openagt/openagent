import type { AgentMeta, OpenAgentEvent } from '../../src/index.js'
import { DRIVER_LABELS, driverFromImpl } from '../../src/client.js'
import { modelName, useModels } from '../lib/models.js'

// The session-details strip behind "Show details" in the session's menu (always available now, so the
// chevron no longer pops in and out with the git/handoff data). It shows the "about this agent"
// facts the wrapped agent's own chat does not: which agent and model ran it, off the run's card, the
// model by the name its agent gives it ("Opus 5.5" for `opus`),
// and what it has spent so far, added up from the run's record: one usage event per turn the coding agent priced (#322), one
// result per turn it answered. The record keeps no token counts, so none are shown. The git
// branch / changes sit in the bar row right above this, so they are not repeated here. The pull
// request is, because the bar goes once the work is landed and the request would go with it.

/** What the record says the agent spent: the priced turns added up, and the turns it answered. */
function spend(events: OpenAgentEvent[]): { costUsd?: number; turns: number } {
  let costUsd: number | undefined
  let turns = 0
  for (const event of events) {
    if (event.kind === 'usage') costUsd = (costUsd ?? 0) + event.costUsd
    else if (event.kind === 'driver' && event.event.type === 'result') turns++
  }
  return { ...(costUsd !== undefined ? { costUsd } : {}), turns }
}

/** What the strip reads off the run's card: the agent that ran it and the model it ran. */
export type AgentDetailsCard = Pick<AgentMeta, 'driver' | 'model' | 'effort' | 'contextTokens'>

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </span>
  )
}

export function AgentDetails({ events, card, pr }: { events: OpenAgentEvent[]; card?: AgentDetailsCard | undefined; pr?: { number: number; url: string; state: string } | undefined }) {
  const picked = driverFromImpl(card?.driver)
  const agent = picked ? DRIVER_LABELS[picked] : card?.driver
  const models = useModels()
  const model = card?.model && modelName(picked ? models?.[picked] : undefined, card.model)
  const { costUsd, turns } = spend(events)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-xs">
      {agent && <Fact label="Agent" value={agent} />}
      {model && <Fact label="Model" value={model} />}
      {costUsd !== undefined && <Fact label="Spent" value={`$${costUsd.toFixed(2)}`} />}
      {turns > 0 && <Fact label="Turns" value={String(turns)} />}
      {pr && (
        <span className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground/70">Pull request</span>
          <a href={pr.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            #{pr.number}
          </a>
          <span className="text-muted-foreground/70">{pr.state.toLowerCase()}</span>
        </span>
      )}
      {costUsd === undefined && turns === 0 && <span className="text-muted-foreground/70">No spend reported yet</span>}
    </div>
  )
}
