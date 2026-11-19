import { Cloud, Folder, GitBranch, Laptop, type LucideIcon } from 'lucide-react'
import type { AgentMeta } from '../../src/index.js'
import { hostOf } from '../lib/run-hosts.js'
import { MACHINE_ICONS } from './MachineMark.js'
import { HOST_ICON, RunOnWords } from './RunOnMenu.js'
import { RowAboveBox, RowSaid } from './ui/row-item.js'
import { RepoChip } from './SessionRepos.js'

/** The icon of where a session runs, as "Run on" has a machine's or a host's; a cloud session has its own. */
function runsOnIcon(target: AgentMeta['target'], kind: AgentMeta['remoteKind']): LucideIcon {
  if (target === 'web') return Cloud
  if (hostOf(target) !== undefined) return HOST_ICON
  return kind ? MACHINE_ICONS[kind] : Laptop
}

// A session's row above the message box: the "New agent session" page's row, in its place, each item
// said in words rather than offered as a menu, since a session keeps where it started. Where it runs, the project and the branch
// it started from; the agent and the account are under the box, as on "New agent session". The branch
// means what it means there and does not flip as the agent renames its own, which its hover names and
// the bar above says. The row's height is fixed, and each item lands in place: the branch last, so
// nothing beside it is pushed, and only with the project's name, as on "New agent session". A branch
// that cannot be said (`lib/started-from.ts`) is left out. A session with no project shows the repos
// it has instead, each copied into its folder.
export function SessionRow({
  runsOn,
  target,
  remoteKind,
  elsewhere,
  projectName,
  startedFrom,
  worksOn,
  repos,
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
  /** The repos a session with no project has, as its record says. */
  repos?: readonly { name: string; from: string }[] | undefined
}) {
  const started = startedFrom && (worksOn && worksOn !== startedFrom ? `Started from ${startedFrom}, works on ${worksOn}` : `Started from ${startedFrom}`)
  return (
    <RowAboveBox>
      <RowSaid tip={`Runs on — ${runsOn}`}>
        <RunOnWords icon={runsOnIcon(target, remoteKind)} elsewhere={elsewhere} label={runsOn} />
      </RowSaid>
      {projectName && (
        <>
          <RowSaid tip={`The session works in ${projectName}`}>
            <Folder className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{projectName}</span>
          </RowSaid>
          {started && (
            <RowSaid tip={started}>
              <GitBranch className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{startedFrom}</span>
            </RowSaid>
          )}
        </>
      )}
      {repos?.map(repo => <RepoChip key={repo.name} repo={repo} tip={`A copy of ${repo.from}, in this session's folder`} />)}
    </RowAboveBox>
  )
}
