import { ArrowUpCircle } from 'lucide-react'
import { onOpenAgentUpdate } from '../rpc/agents.js'
import { usePolled } from '../lib/use-async.js'
import { CopyButton } from './ui/copy-button.js'

// The Overview's line for a newer OpenAgent than the one running here: the version it has, the
// newest, and the command that updates it, which the person runs. Nothing while it is up to date.
// It stands with the modules' notices, under the card of what needs the person.

/** How often the page asks again: the daemon itself asks npm twice a day. */
const EVERY_MS = 60 * 60_000

export function OpenAgentUpdate() {
  const { value: update } = usePolled(onOpenAgentUpdate, null, EVERY_MS, [])
  if (update === null) return null
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
