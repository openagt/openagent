import { Bot, Cloud, Folder, Laptop, Workflow, type LucideIcon } from 'lucide-react'
import type { AgentMeta, GitHostHome } from '../../src/index.js'
import { BranchButton } from './StartFromMenu.js'
import { GitHostOff } from './GitHosts.js'
import { MACHINE_ICONS } from './MachineMark.js'
import { RunOnWords } from './RunOnMenu.js'
import { RowAboveBox, RowOff, rowButtonClass } from './ui/row-item.js'
import { RepoChip } from './SessionRepos.js'
import { useAgentName } from './AgentsPage.js'

/** The icon of where a session runs, as "Run on" has a machine's; the two that are no machine have their own. */
function runsOnIcon(target: AgentMeta['target'], kind: AgentMeta['remoteKind']): LucideIcon {
  if (target === 'web') return Cloud
  if (target === 'actions') return Workflow
  return kind ? MACHINE_ICONS[kind] : Laptop
}

// A session's row above the message box: the "New agent session" page's row, in its place and in its look,
// with every item off, since a session keeps where it started. Where it runs, the project, the branch
// it started from, and at the other end the git host. The branch means what it means on "New agent session"
// and does not flip as the agent renames its own, which its hover names and the bar above says. The
// row's height is fixed, and each item lands in place: the branch last on its side, so nothing beside
// it is pushed, and only with the project's name, as on "New agent session". A branch that cannot be said
// (`lib/started-from.ts`) is left out. A session with no project shows the repos it has instead,
// each copied into its folder.
export function SessionRow({
  runsOn,
  target,
  remoteKind,
  elsewhere,
  projectName,
  startedFrom,
  worksOn,
  gitHost,
  gitAccount,
  repos,
  agent,
}: {
  /** Where the session runs, in a few words: this machine, another machine by its name, the cloud. */
  runsOn: string
  target?: AgentMeta['target'] | undefined
  remoteKind?: AgentMeta['remoteKind'] | undefined
  /** Whether that is not this computer. */
  elsewhere: boolean
  projectName?: string | null | undefined
  /** The branch the session started from, when that can be said. */
  startedFrom?: string | undefined
  /** The branch the agent works on, when it is known. */
  worksOn?: string | undefined
  /** The project's page on its git host. */
  gitHost: GitHostHome | null
  /** The account the run worked as there, as its record says. */
  gitAccount?: string | undefined
  /** The repos a session with no project has, as its record says. */
  repos?: readonly { name: string; from: string }[] | undefined
  /** The agent the session is on, by its id, as its record says; the default agent when absent. */
  agent?: string | undefined
}) {
  const agentName = useAgentName(agent)
  const started = startedFrom && (worksOn && worksOn !== startedFrom ? `Started from ${startedFrom}, works on ${worksOn}` : `Started from ${startedFrom}`)
  return (
    <RowAboveBox end={<GitHostOff home={gitHost} account={gitAccount} />}>
      <RowOff tip={`Runs on — ${runsOn}`}>
        <button type="button" disabled className={rowButtonClass}>
          <RunOnWords icon={runsOnIcon(target, remoteKind)} elsewhere={elsewhere} label={runsOn} />
        </button>
      </RowOff>
      {projectName && (
        <>
          <RowOff tip={projectName}>
            <button type="button" disabled className={rowButtonClass}>
              <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{projectName}</span>
            </button>
          </RowOff>
          {started && (
            <RowOff tip={started}>
              <BranchButton label={startedFrom} disabled />
            </RowOff>
          )}
        </>
      )}
      {repos?.map(repo => <RepoChip key={repo.name} repo={repo} tip={`A copy of ${repo.from}, in this session's folder`} />)}
      {agentName !== undefined && (
        <RowOff tip={`On the agent ${agentName}: its skills and accounts`}>
          <button type="button" disabled className={rowButtonClass}>
            <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{agentName}</span>
          </button>
        </RowOff>
      )}
    </RowAboveBox>
  )
}
