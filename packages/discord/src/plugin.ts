import { defineModule } from '@openagt/hooks'

/**
 * discord, a plugin kept per project (#2394): the agent posts to the team's Discord channel. Where
 * its Enabled row is on, the project's runs get its skill and the command the skill teaches.
 */
export default defineModule({
  name: 'discord',
  plugin: { scope: 'project' },
  hooks: { 'run.skills': () => [{ name: 'discord', dir: new URL('../', import.meta.url), command: 'discord' }] },
})
