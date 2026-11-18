import type { DistributionEntry } from '@openagt/hooks'
import { notificationsCommand } from './notifications-command.js'
import { skills } from './skills.js'

/**
 * The modules this package runs a run's steps of on top of its distribution's, until each has a
 * package of its own to be listed by: skills with its page (#2394's step 5), notifications-command
 * as a plugin (step 6).
 */
export const BUILT_IN_MODULES: readonly DistributionEntry[] = [{ module: skills }, { module: notificationsCommand }]
