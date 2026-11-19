import { defineModule } from '@openagt/hooks'

/**
 * tickets, a plugin kept per project (#2394): the project's tickets. Where its Enabled row is on,
 * the project shows its Tickets page, and its runs get its skill and the command the skill teaches.
 */
export default defineModule({
  name: 'tickets',
  plugin: { scope: 'project' },
  hooks: { 'run.skills': () => [{ name: 'tickets', dir: new URL('../', import.meta.url), command: 'tickets' }] },
})
