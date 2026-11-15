import { useRef, useState } from 'react'
import { ArrowUpCircle, CheckCircle2 } from 'lucide-react'
import { DRIVER_LABELS, type DriverName } from '../../src/client.js'
import { onAgentUpdates, onModels, onOpenAgentUpdate, sendAgentUpdate, type AgentUpdate, type OpenAgentUpdate } from '../rpc/models.js'
import { forgetRemembered, readAhead, usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { FocusHome } from '../lib/focus-home.js'
import { Button } from './ui/button.js'
import { CopyButton } from './ui/copy-button.js'
import { useAction } from '../lib/use-action.js'

// The Overview's line for a coding agent on this computer with a newer version out: the version it
// has, the newest, and the press that runs the agent's own update. Nothing when every agent is up
// to date. A new version can offer other models, so the page asks for them again after. OpenAgent's
// own newer version has a line too, with the command that updates it, which the person runs.

/** How often the page asks again: the daemon itself asks npm twice a day. */
const EVERY_MS = 60 * 60_000

const NONE: AgentUpdate[] = []

/** The program each agent's update is run with, to run by hand where the press could not. */
const UPDATE_COMMANDS: Record<DriverName, string> = { 'claude-code': 'claude update', codex: 'codex update' }

/** How often the page asks again while an update runs, so a tab that did not press it sees it end. */
const UPDATING_EVERY_MS = 5_000

export function AgentUpdates() {
  const [running, setRunning] = useState(false)
  const { value: updates, reload } = usePolled(onAgentUpdates, NONE, running ? UPDATING_EVERY_MS : EVERY_MS, [])
  const { value: own } = usePolled(onOpenAgentUpdate, null, EVERY_MS, [])
  const anyUpdating = updates.some(update => update.updating === true)
  if (anyUpdating !== running) setRunning(anyUpdating)
  // What a press here installed, said in place of its line while the page is open.
  const [installed, setInstalled] = useState<Partial<Record<DriverName, string>>>({})
  const lines = updates.filter(update => installed[update.agent] === undefined)
  const said = Object.entries(installed) as [DriverName, string][]
  // The line that says what a press installed takes the keyboard its press had: the newest, drawn last.
  const saidLast = useRef<HTMLParagraphElement>(null)
  if (own === null && lines.length === 0 && said.length === 0) return null
  return (
    <FocusHome className="space-y-2" landing={saidLast}>
      {own !== null && <OpenAgentUpdateLine update={own} />}
      {said.map(([agent, version]) => (
        <p key={agent} ref={saidLast} role="status" tabIndex={-1} className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm outline-none">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
          {`${DRIVER_LABELS[agent]} is now ${version}.`}
        </p>
      ))}
      {lines.map(update => (
        <AgentUpdateLine
          key={update.agent}
          update={update}
          onUpdated={async version => {
            setInstalled(now => ({ ...now, [update.agent]: version }))
            await reload()
          }}
        />
      ))}
    </FocusHome>
  )
}

function OpenAgentUpdateLine({ update }: { update: OpenAgentUpdate }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-sm">
      <ArrowUpCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1">
        OpenAgent {update.latest} is out. This computer runs {update.installed}.
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">{update.command}</code>
        <CopyButton text={update.command} label="Copy the command" className="justify-center md:size-6 max-md:size-11" />
      </span>
    </div>
  )
}

function AgentUpdateLine({ update, onUpdated }: { update: AgentUpdate; onUpdated: (version: string) => Promise<void> }) {
  const { busy: pressed, error, run } = useAction()
  // Pressed here, or running for another tab or computer, as the daemon's read says.
  const busy = pressed || update.updating === true
  const label = DRIVER_LABELS[update.agent]
  const press = async (): Promise<void> => {
    const outcome = await run(() => sendAgentUpdate(update.agent), 'It ended without a word.')
    if (!outcome.ok) return
    forgetRemembered('models')
    readAhead('models', onModels)
    await onUpdated(outcome.value.version)
  }
  return (
    <div className="rounded-md border border-border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ArrowUpCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1">
          {label} {update.latest} is out. This computer has {update.installed}.
        </span>
        {/* Busy, it keeps the focus it was pressed with: a disabled press would drop it to the page. */}
        <Button size="sm" variant="outline" aria-disabled={busy || undefined} className={cn(busy && 'opacity-50')} onClick={() => void (busy || press())}>
          {busy ? 'Updating…' : `Update ${label}`}
        </Button>
      </div>
      {error && (
        <div role="alert" className="mt-1 space-y-0.5 text-xs">
          <p className="text-danger">
            {`${label} could not be updated. Run `}
            <code className="font-mono">{UPDATE_COMMANDS[update.agent]}</code>
            {' in a terminal to see why, or try again.'}
          </p>
          <p className="font-mono text-muted-foreground">{error}</p>
        </div>
      )}
    </div>
  )
}
