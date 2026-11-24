import { HandoffOffers, useLoaded, useModuleHost, WorkRow, type UiRunProps } from '@openagt/ui/module'
import { handoffSays, server, useHandoff } from './calls.js'
import { HandoffSummary } from './HandoffSummary.js'

// The session's copies of repos (its Context) in the panel of its work above the message box
// (`chat.work`): each has a row after the project's, read and taken further exactly as the
// project's is: its branch, what the branch holds, and its next steps (`chat.handoff` with the
// copy's name). A copy holding no work has no row.

/** A row per copy that holds work, once the run has ended. */
export function CopyRows({ projectId, agentId, working }: UiRunProps) {
  const host = useModuleHost()
  // A copy is made as the run starts: read again when it stops or goes on.
  const names = useLoaded<string[] | null>(() => server(host).copies(projectId, { agentId }).catch(() => []), [], [projectId, agentId, working], { remember: `git-branches:copies:${projectId}:${agentId}` })
  return (
    <>
      {(names ?? []).map(repo => (
        <CopyRow key={repo} projectId={projectId} agentId={agentId} repo={repo} ended={!working} />
      ))}
    </>
  )
}

function CopyRow({ projectId, agentId, repo, ended }: { projectId: string; agentId: string; repo: string; ended: boolean }) {
  const host = useModuleHost()
  const { handoff } = useHandoff(host, { projectId, agentId, repo }, ended)
  if (!ended || !handoff || !handoffSays(handoff)) return null
  return (
    <WorkRow
      name={repo}
      branch={handoff.branch}
      summary={<HandoffSummary handoff={handoff} />}
      actions={<HandoffOffers projectId={projectId} agentId={agentId} repo={repo} again={handoff} />}
    />
  )
}
