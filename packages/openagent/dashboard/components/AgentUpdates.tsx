import { ArrowUpCircle } from 'lucide-react'
import { DRIVER_LABELS } from '../../src/client.js'
import { onAgentUpdates, onModels, sendAgentUpdate, type AgentUpdate } from '../rpc/models.js'
import { forgetRemembered, readAhead, usePolled } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { Button } from './ui/button.js'

// The Overview's line for a coding agent on this computer with a newer version out: the version it
// has, the newest, and the press that runs the agent's own update. Nothing when every agent is up
// to date. A new version can offer other models, so the page asks for them again after.

/** How often the page asks again: the daemon itself asks npm twice a day. */
const EVERY_MS = 60 * 60_000

const NONE: AgentUpdate[] = []

export function AgentUpdates() {
  const { value: updates, reload } = usePolled(onAgentUpdates, NONE, EVERY_MS, [])
  if (updates.length === 0) return null
  return (
    <div className="space-y-2">
      {updates.map(update => (
        <AgentUpdateLine key={update.agent} update={update} onUpdated={reload} />
      ))}
    </div>
  )
}

function AgentUpdateLine({ update, onUpdated }: { update: AgentUpdate; onUpdated: () => Promise<void> }) {
  const { busy, error, run } = useAction()
  const label = DRIVER_LABELS[update.agent]
  const press = async (): Promise<void> => {
    const outcome = await run(() => sendAgentUpdate(update.agent), `${label} could not be updated.`)
    if (!outcome.ok) return
    forgetRemembered('models')
    readAhead('models', onModels)
    await onUpdated()
  }
  return (
    <div role="status" className="rounded-md border border-border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ArrowUpCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1">
          {label} {update.latest} is out. This computer has {update.installed}.
        </span>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void press()}>
          {busy ? 'Updating…' : `Update ${label}`}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}
