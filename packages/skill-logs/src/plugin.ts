import { defineModule } from '@openagt/hooks'

/**
 * logs, a plugin kept per project (#2394): looking back at the runs. Where its Enabled row is on,
 * the project shows its Logs page, and its runs get its skill and the command the skill teaches.
 * The runs' records are kept whatever it says: agent-driver writes them with this package's code.
 */
export default defineModule({
  name: 'logs',
  plugin: { scope: 'project' },
  hooks: { 'run.skills': () => [{ name: 'logs', dir: new URL('../', import.meta.url), command: 'logs' }] },
})
