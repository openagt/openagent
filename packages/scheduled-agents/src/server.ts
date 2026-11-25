import { nodeGitRunner } from '@openagt/git-branches'
import { read } from '@openagt/hooks/rpc'
import { shownAutomation, whyRefused, type ShownAutomation } from './automation.js'
import { schedulerStatus, type Status } from './scheduler.js'

// The scheduler's server part (`@openagt/hooks/rpc`): what the Automations page, the Overview's
// card, the Scheduler section of Settings and the stop line on the usage bar read. They change the
// scheduler through its command, as a person does from the command line.

/**
 * The project's scheduler, as `status` says it: the state with this computer's switches and paces,
 * read from OpenAgent's settings, whether its process is alive, and the schedule as the project's
 * files say it now, each command with its last run.
 */
export const status = read((host, _input: object): Promise<Status> => schedulerStatus(host.root, nodeGitRunner(), host.settings))

/**
 * An automation saved with `add`, as `show` says it: what its file says, the file, and its version,
 * a name for what the file says now, which a save is held against. Refused, with why, for anything
 * whose file does not read as `add` writes one.
 */
export const show = read(async (host, input: { name: string }): Promise<ShownAutomation> => {
  if (typeof input.name !== 'string') throw new Error("an automation is shown by its name")
  const shown = await shownAutomation(host.root, input.name)
  if ('reason' in shown) throw new Error(whyRefused(shown))
  return shown
})
