import { defineModule } from '@openagt/hooks'
import { queueAttention } from './attention.js'

/**
 * queue, a plugin kept per project (#2394): the project's agent queue. Where its Enabled row is on,
 * the project shows its Queue page, and its runs get its skill and the command the skill teaches,
 * and the command about the queue that ships with it (decision 25): `work-queue`, a skill of its
 * own in `commands/`. While none of its projects has an entry, it says so as a first step of this
 * computer's (`attention.ts`).
 */
export default defineModule({
  name: 'queue',
  plugin: { scope: 'project' },
  hooks: {
    'app.attention': queueAttention(),
    'run.skills': () => [
      { name: 'queue', dir: new URL('../', import.meta.url), command: 'queue' },
      { name: 'work-queue', dir: new URL('../commands/work-queue/', import.meta.url) },
    ],
  },
})
