import { Github, ExternalLink } from 'lucide-react'
import type { OpenAgentEvent } from '../../src/index.js'
import { actionsRunUrl } from '../lib/live-state.js'

// The agent view's affordance for a GitHub Actions target (#1053). An Actions run replays its
// transcript in a burst at the end (fresh runner per turn), so a live feed looks stalled with
// nothing streaming. This says the wait is expected and links through to the live Actions run.
// Renders nothing for a local/remote/web run, so the agent view can mount it unconditionally.
export function ActionsRunNotice({
  target,
  events,
  live,
}: {
  target?: 'local' | 'actions' | 'remote' | 'web' | undefined
  events: readonly OpenAgentEvent[]
  /** Whether the agent is still going: the "updates on completion" line only applies while it runs. */
  live: boolean
}) {
  if (target !== 'actions') return null
  const url = actionsRunUrl(events)
  return (
    // The banners' strip: a tinted fill with no edge, its link at the right.
    <div role="status" className="flex items-center gap-2 bg-muted px-4 py-2 text-sm text-muted-foreground">
      <Github className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        Running on GitHub Actions{live ? ' — updates arrive when the run finishes.' : '.'}
      </span>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline"
        >
          View the Actions run
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
    </div>
  )
}
