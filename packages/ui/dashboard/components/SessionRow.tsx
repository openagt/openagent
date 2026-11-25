import { Folder, Laptop, type LucideIcon } from 'lucide-react'
import type { AgentMeta } from '../../src/index.js'
import { hostOf } from '../lib/run-hosts.js'
import { HOST_ICON, RunOnWords } from './RunOnMenu.js'
import { RowAboveBox, RowSaid } from './ui/row-item.js'
import { ViewsAt } from './Places.js'
import type { UiRunProps } from '../module/index.js'

/** The icon of where a session runs, as "Run on" has a host's. */
function runsOnIcon(target: AgentMeta['target']): LucideIcon {
  return hostOf(target) !== undefined ? HOST_ICON : Laptop
}

// A session's row above the message box: the "New agent session" page's row, in its place, each item
// said in words rather than offered as a menu, since a session keeps where it started. Where it
// runs and the project; at its right end, the modules' labels (`chat.labels`: the git host's
// module draws the run's pull requests). The setup and the model are under the box, as on "New agent
// session", and so are its repos and the branch it started from. The row's height is fixed, and each item lands in place.
export function SessionRow({
  runsOn,
  target,
  elsewhere,
  projectName,
  run,
}: {
  /** The session, for the labels at the row's end (`chat.labels`). */
  run?: UiRunProps | undefined
  /** Where the session runs, in a few words: this machine, another computer by its name, a host by its own. */
  runsOn: string
  target?: AgentMeta['target'] | undefined
  /** Whether that is not this computer. */
  elsewhere: boolean
  projectName?: string | null | undefined
}) {
  return (
    <RowAboveBox end={run && <ViewsAt place="chat.labels" projectId={run.projectId} props={run} label="session labels" />}>
      <RowSaid tip={`Runs on — ${runsOn}`}>
        <RunOnWords icon={runsOnIcon(target)} elsewhere={elsewhere} label={runsOn} />
      </RowSaid>
      {projectName && (
        <RowSaid tip={`The session works in ${projectName}`}>
          <Folder className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{projectName}</span>
        </RowSaid>
      )}
    </RowAboveBox>
  )
}
