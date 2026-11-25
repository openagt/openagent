import { onPeople } from '../rpc/people.js'
import { onActivity } from '../rpc/reads.js'
import type { HostServices } from './host-services.js'
import { readModuleAgents } from './module-agents.js'
import { sendToScreen, watchScreen } from './screen.js'

// The shell's services for modules (#1774) that are questions for the daemon: a project's runs and
// people, the runs that started or ended lately, a run's live screen. They need nothing of the page
// on screen, so they are the same for the page's life; the shell adds to them the ones that do,
// which navigate or start a run.

/** The services only the shell can give: they go somewhere on the page, or land on a run. */
type ShellServices = 'openAgent' | 'agentHref' | 'openPage' | 'pageHref' | 'adjustPage' | 'backToPage' | 'openSettings' | 'startRun' | 'configureRun'

export const DAEMON_SERVICES: Omit<HostServices, ShellServices> = {
  people: onPeople,
  // Asked at once by two cards, or soon again, the same runs are read once.
  agents: (projectId, wanted) => readModuleAgents(projectId, wanted),
  activity: onActivity,
  watchScreen,
  sendToScreen,
}
