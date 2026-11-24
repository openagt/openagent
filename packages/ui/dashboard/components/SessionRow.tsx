import { Folder, Laptop, type LucideIcon } from 'lucide-react'
import type { AgentMeta } from '../../src/index.js'
import { hostOf } from '../lib/run-hosts.js'
import { HOST_ICON, RunOnWords } from './RunOnMenu.js'
import { RowAboveBox, RowSaid } from './ui/row-item.js'
import { RunPrLabels } from './RunPrLabels.js'
import { ComposerControls, ViewsAt, type ControlBox } from './Places.js'
import type { UiRunProps } from '../module/index.js'

/** The icon of where a session runs, as "Run on" has a host's. */
function runsOnIcon(target: AgentMeta['target']): LucideIcon {
  return hostOf(target) !== undefined ? HOST_ICON : Laptop
}

// A session's row above the message box: the "New agent session" page's row, in its place, each item
// said in words rather than offered as a menu, since a session keeps where it started. Where it
// runs, the project, then the modules' controls there (`composer.control` at `start`: git-branches
// says the branch it started from); at its right end, the run's pull requests (RunPrLabels). The
// setup and the model are under the box, as on "New agent session". The row's height is fixed, and
// each item lands in place. A session with no project says its repos under the box, as Context.
export function SessionRow({
  runsOn,
  target,
  elsewhere,
  projectName,
  prs = [],
  box,
  run,
}: {
  /** The session's box, whose controls above it (`composer.control` at `start`) say where it started. */
  box?: ControlBox | undefined
  /** The session, for the labels at the row's end (`chat.labels`). */
  run?: UiRunProps | undefined
  /** Where the session runs, in a few words: this machine, another computer by its name, a host by its own. */
  runsOn: string
  target?: AgentMeta['target'] | undefined
  /** Whether that is not this computer. */
  elsewhere: boolean
  projectName?: string | null | undefined
  /** The run's pull requests, oldest first. */
  prs?: readonly { number: number; url: string; state?: string | undefined }[] | undefined
}) {
  return (
    <RowAboveBox
      end={
        <>
          <RunPrLabels prs={prs} />
          {run && <ViewsAt place="chat.labels" projectId={run.projectId} props={run} label="session labels" />}
        </>
      }
    >
      <RowSaid tip={`Runs on — ${runsOn}`}>
        <RunOnWords icon={runsOnIcon(target)} elsewhere={elsewhere} label={runsOn} />
      </RowSaid>
      {projectName && (
        <RowSaid tip={`The session works in ${projectName}`}>
          <Folder className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{projectName}</span>
        </RowSaid>
      )}
      {box && <ComposerControls at="start" box={box} />}
    </RowAboveBox>
  )
}
