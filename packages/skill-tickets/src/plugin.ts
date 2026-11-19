import { defineModule } from '@openagt/hooks'

/** The commands about the tickets that ship with them (#2394, decision 25), each a skill of its own in `commands/<name>/`, its text copied there from the repository's `skills/` folder by the build. */
const COMMANDS = ['plan', 'plan-tickets', 'triage', 'update-tickets', 'suggest-tickets-to-work-on'] as const

/**
 * tickets, a plugin kept per project (#2394): the project's tickets. Where its Enabled row is on,
 * the project shows its Tickets page, and its runs get its skill, the command the skill teaches,
 * and the commands about the tickets.
 */
export default defineModule({
  name: 'tickets',
  plugin: { scope: 'project' },
  hooks: {
    'run.skills': () => [
      { name: 'tickets', dir: new URL('../', import.meta.url), command: 'tickets' },
      ...COMMANDS.map(name => ({ name, dir: new URL(`../commands/${name}/`, import.meta.url) })),
    ],
  },
})
