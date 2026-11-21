import { defineModule } from '@openagt/hooks'
import { schedulersLifecycle } from './lifecycle.js'

/**
 * scheduled-agents, a plugin kept per project (#2394): the commands started on a schedule. Where its
 * Enabled row is on, the project's scheduler runs for as long as OpenAgent does, the project shows
 * its Automations page, and its runs get its skill and the command the skill teaches.
 */
export default defineModule({
  name: 'scheduled-agents',
  plugin: { scope: 'project' },
  hooks: {
    'run.skills': () => [{ name: 'scheduler', dir: new URL('../', import.meta.url), command: 'scheduler' }],
    'app.lifecycle': schedulersLifecycle(),
  },
})
