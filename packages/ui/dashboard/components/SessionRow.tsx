import { Folder, GitBranch, Laptop, type LucideIcon } from 'lucide-react'
import type { AgentMeta } from '../../src/index.js'
import { hostOf } from '../lib/run-hosts.js'
import { HOST_ICON, RunOnWords } from './RunOnMenu.js'
import { RowAboveBox, RowSaid } from './ui/row-item.js'
import { RunPrLabels } from './RunPrLabels.js'

/** The icon of where a session runs, as "Run on" has a host's. */
function runsOnIcon(target: AgentMeta['target']): LucideIcon {
  return hostOf(target) !== undefined ? HOST_ICON : Laptop
}

// A session's row above the message box: the "New agent session" page's row, in its place, each item
// said in words rather than offered as a menu, since a session keeps where it started. Where it runs, the project and the branch
// it started from; at its right end, the run's pull requests (RunPrLabels). The setup and the model
// are under the box, as on "New agent session". The branch
// means what it means there and does not flip as the agent renames its own, which its hover names and
// the bar above says. The row's height is fixed, and each item lands in place: the branch last, so
// nothing beside it is pushed, and only with the project's name, as on "New agent session". A branch
// that cannot be said (`lib/started-from.ts`) is left out. A session with no project says its repos
// under the box, as Context.
export function SessionRow({
  runsOn,
  target,
  elsewhere,
  projectName,
  startedFrom,
  worksOn,
  prs = [],
}: {
  /** Where the session runs, in a few words: this machine, another computer by its name, a host by its own. */
  runsOn: string
  target?: AgentMeta['target'] | undefined
  /** Whether that is not this computer. */
  elsewhere: boolean
  projectName?: string | null | undefined
  /** The branch the session started from, when that can be said. */
  startedFrom?: string | undefined
  /** The branch the agent works on, when it is known. */
  worksOn?: string | undefined
  /** The run's pull requests, oldest first. */
  prs?: readonly { number: number; url: string; state?: string | undefined }[] | undefined
}) {
  const started = startedFrom && (worksOn && worksOn !== startedFrom ? `Started from ${startedFrom}, works on ${worksOn}` : `Started from ${startedFrom}`)
  return (
    <RowAboveBox end={<RunPrLabels prs={prs} />}>
      <RowSaid tip={`Runs on — ${runsOn}`}>
        <RunOnWords icon={runsOnIcon(target)} elsewhere={elsewhere} label={runsOn} />
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
    </RowAboveBox>
  )
}
