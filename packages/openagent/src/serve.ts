// `@openagt/dashboard/serve`: the dashboard's server, as `@openagt/start` runs it. The dashboard has
// no command of its own: the one people run is start's, which hands it the skills every run gets
// (in the environment, see `SKILLS_ENV`) and OpenAgent's version.
export { DEFAULT_DAEMON_PORT, runDaemon, type DaemonState, type RunDaemonOptions } from './daemon.js'
export { joinRunningDashboard, type JoinedDashboard } from './join-dashboard.js'
export type { StartedProject } from './dashboard/types.js'
