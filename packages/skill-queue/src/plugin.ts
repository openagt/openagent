import { defineModule } from '@openagt/hooks'

/**
 * queue, a plugin kept per project (#2394): the project's agent queue. Where its Enabled row is on,
 * the project shows its Queue page, and its runs get its skill and the command the skill teaches.
 */
export default defineModule({
  name: 'queue',
  plugin: { scope: 'project' },
  hooks: { 'run.skills': () => [{ name: 'queue', dir: new URL('../', import.meta.url), command: 'queue' }] },
})
