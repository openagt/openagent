import { defineModule } from '@openagt/hooks'

/**
 * browser, a plugin kept per project (#2394): a headless Chrome the agent drives. Where its Enabled
 * row is on, the project's runs get its skill and the command the skill teaches.
 */
export default defineModule({
  name: 'browser',
  plugin: { scope: 'project' },
  hooks: { 'run.skills': () => [{ name: 'browser', dir: new URL('../', import.meta.url), command: 'browser' }] },
})
