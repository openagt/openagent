import { useRef, useState } from 'react'
import { ArrowUpCircle, CheckCircle2 } from 'lucide-react'
import { Button, CommandLine, FocusHome, cn, forgetRemembered, useAction, useModuleHost, usePolled } from '@openagt/ui/module'
import type { AgentUpdate } from '../src/server.js'
import { server } from './reads.js'

// In Settings › Coding agent, a line for each coding agent on this computer with a newer version
// out: the version it has, the newest, and the press that runs the agent's own update. Nothing when
// every agent is up to date. A new version can offer other models, so the menu asks for them again
// after. The person's menu offers the same update, from the agent's note (`updateFix`, his pick
// 2026-11-26: on the Overview the notice came late and moved the page).

/** How often the page asks again: the server itself asks npm twice a day. */
const EVERY_MS = 60 * 60_000

/** How often the page asks again while an update runs, so a tab that did not press it sees it end. */
const UPDATING_EVERY_MS = 5_000

const NONE: AgentUpdate[] = []

export function AgentUpdates() {
  const host = useModuleHost()
  const [running, setRunning] = useState(false)
  const { value: updates, reload } = usePolled(() => server(host).updates({}), NONE, running ? UPDATING_EVERY_MS : EVERY_MS, [])
  const anyUpdating = updates.some(update => update.updating === true)
  if (anyUpdating !== running) setRunning(anyUpdating)
  // What a press here installed, said in place of its line while the page is open, by the agent's name.
  const [installed, setInstalled] = useState<Record<string, { label: string; version: string }>>({})
  const lines = updates.filter(update => installed[update.agent] === undefined)
  const said = Object.entries(installed)
  // The line that says what a press installed takes the keyboard its press had: the newest, drawn last.
  const saidLast = useRef<HTMLParagraphElement>(null)
  if (lines.length === 0 && said.length === 0) return null
  return (
    <FocusHome className="space-y-2" landing={saidLast}>
      {said.map(([agent, { label, version }]) => (
        <p key={agent} ref={saidLast} role="status" tabIndex={-1} className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm outline-none">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
          {`${label} is now ${version}.`}
        </p>
      ))}
      {lines.map(update => (
        <AgentUpdateLine
          key={update.agent}
          update={update}
          onUpdated={async version => {
            setInstalled(now => ({ ...now, [update.agent]: { label: update.label, version } }))
            await reload()
          }}
        />
      ))}
    </FocusHome>
  )
}

function AgentUpdateLine({ update, onUpdated }: { update: AgentUpdate; onUpdated: (version: string) => Promise<void> }) {
  const host = useModuleHost()
  const { busy: pressed, error, run } = useAction()
  // Pressed here, or running for another tab or computer, as the server's read says.
  const busy = pressed || update.updating === true
  const press = async (): Promise<void> => {
    const outcome = await run(() => server(host).update({ agent: update.agent }), 'It ended without a word.')
    if (!outcome.ok) return
    // Its models may be others now: the menu asks for them again.
    forgetRemembered('agent-driver:agents')
    await onUpdated(outcome.value.version)
  }
  return (
    <div className="rounded-md border border-border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ArrowUpCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1">
          {update.label} {update.latest} is out. This computer has {update.installed}.
        </span>
        {/* Busy, it keeps the focus it was pressed with: a disabled press would drop it to the page. */}
        <Button size="sm" variant="outline" aria-disabled={busy || undefined} className={cn(busy && 'opacity-50')} onClick={() => void (busy || press())}>
          {busy ? 'Updating…' : `Update ${update.label}`}
        </Button>
      </div>
      {error && (
        <div role="alert" className="mt-1 space-y-0.5 text-xs">
          <p className="text-danger">{`${update.label} could not be updated. Run this in a terminal to see why, or try again:`}</p>
          <CommandLine command={update.command} />
          <p className="font-mono text-muted-foreground">{error}</p>
        </div>
      )}
    </div>
  )
}
