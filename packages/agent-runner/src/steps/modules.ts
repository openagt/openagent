import { defineModule, type DistributionEntry } from '@openagt/hooks'
import type { Leg } from '../leg.js'
import { agentDriverSteps } from './agent-driver.js'
import { gitBranchesSteps } from './git-branches.js'
import { githubSteps } from './github.js'
import { notificationsCommandSteps } from './notifications-command.js'
import { skillsSteps } from './skills.js'

/**
 * The modules whose steps make a run, each named as the module it becomes (#2394): until they move
 * into their own packages, their steps share the leg of the run this process runs. All are on for
 * every run: notifications-command is to be a plugin, and runs here as it does today, its line
 * the person's to set or not.
 */
export function runModules(leg: Leg): DistributionEntry[] {
  return [
    { module: defineModule({ name: 'git-branches', hooks: { 'run.step': gitBranchesSteps(leg) } }) },
    { module: defineModule({ name: 'skills', hooks: { 'run.step': skillsSteps(leg) } }) },
    { module: defineModule({ name: 'github', hooks: { 'run.step': githubSteps(leg) } }) },
    { module: defineModule({ name: 'agent-driver', hooks: { 'run.step': agentDriverSteps(leg) } }) },
    { module: defineModule({ name: 'notifications-command', hooks: { 'run.step': notificationsCommandSteps(leg) } }) },
  ]
}
