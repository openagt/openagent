import { ExternalLink, Github } from 'lucide-react'
import { rpcClient, usePolled, useModuleHost, type UiRunNoticeProps } from '@openagt/ui/module'

/** The host's id, as the run's page names the host a run is on (`ACTIONS_HOST`). */
const ACTIONS = 'actions'

/** How often the strip asks again while the run works: GitHub makes the Actions run a few seconds after the dispatch. */
const WHILE_WORKING_MS = 5_000

/**
 * The strip above the chat of a run on GitHub Actions (#1053, #2394). Its transcript comes back in
 * a burst when its turn ends, as a runner is gone by then, so the chat would look stalled: this
 * says the wait is expected, and links to the Actions run once GitHub has made it. Nothing on a
 * run of another host.
 */
export function ActionsRunNotice({ host, ...run }: UiRunNoticeProps) {
  return host === ACTIONS ? <OnActions {...run} /> : null
}

function OnActions({ projectId, agentId, working }: Omit<UiRunNoticeProps, 'host'>) {
  const moduleHost = useModuleHost()
  const server = rpcClient<typeof import('../src/server.js')>(moduleHost)
  // Asked again while the turn runs, until GitHub's address is in; once the run has ended, once.
  const { value: run } = usePolled(() => server.run(projectId, { agentId }).catch(() => null), null, WHILE_WORKING_MS, [projectId, agentId, working])
  return (
    // The banners' strip: a tinted fill with no edge, its link at the right.
    <div role="status" className="flex items-center gap-2 bg-muted px-4 py-2 text-sm text-muted-foreground">
      <Github className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{working ? 'Running on GitHub Actions: what it does comes when its turn ends.' : 'Ran on GitHub Actions.'}</span>
      {run?.address && (
        <a href={run.address} target="_blank" rel="noreferrer" className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline">
          View the Actions run
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
    </div>
  )
}
