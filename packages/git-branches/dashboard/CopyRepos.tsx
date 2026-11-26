import { BookMarked } from 'lucide-react'
import { EnvironmentRow, repoPath, useLoaded, useModuleHost, type UiRunProps } from '@openagt/ui/module'
import { server } from './calls.js'
import type { SessionRepo } from '../src/handoff.js'

// The session's copies of repos in its Activity panel's Environment (`chat.environment`), after its
// project, as Claude Code on the web lists a session's repos: each by the repository it is a copy
// of (`me/shop`), or by its name in the session's folder when it has no remote.

export function CopyRepos({ projectId, agentId, working }: UiRunProps) {
  const host = useModuleHost()
  // A copy is made as the run starts, and one may be added while it runs: read again as it stops or goes on.
  const repos = useLoaded<SessionRepo[] | null>(() => server(host).repos(projectId, { agentId }).catch(() => []), [], [projectId, agentId, working], { remember: `git-branches:repos:${projectId}:${agentId}` })
  return (
    <>
      {(repos ?? []).map(repo => (
        <EnvironmentRow key={repo.name} icon={BookMarked} title={`Copied repo\n${repo.address ?? repo.name}`}>
          {repo.address ? repoPath(repo.address) : repo.name}
        </EnvironmentRow>
      ))}
    </>
  )
}
