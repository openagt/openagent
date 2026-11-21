import { homedir } from 'node:os'
import { defineModule, RunOrder, type ModuleDefinition, type RunContext } from '@openagt/hooks'
import { NOTIFY_COMMAND } from './command.js'
import { newsOf, runCommandFor } from './notify.js'

export { NOTIFY_COMMAND } from './command.js'

/**
 * notifications-command, a plugin kept per computer (#2394): when a run on this computer ends
 * waiting on a question, or ends done with a pull request it did not have, the person's command
 * runs (`notify.ts`), at the run's last step. It starts off: switched on, with a command typed in
 * its Settings entry, every run here that needs the person runs it.
 */
export function notificationsCommand(opts: { timeoutMs?: number } = {}): ModuleDefinition {
  // The pull request each leg of a run started with: one it has at its end is news only when it is another.
  const atStart = new WeakMap<RunContext, string | undefined>()
  return defineModule({
    name: 'notifications-command',
    plugin: { scope: 'computer' },
    hooks: {
      'run.step': [
        { order: RunOrder.CLONE, name: 'note the pull request the run starts with', run: ctx => void atStart.set(ctx, ctx.facts.github?.pr?.url) },
        {
          order: RunOrder.NOTIFY,
          name: "run the person's command",
          async run(ctx) {
            const pr = ctx.facts.github?.pr
            const before = atStart.get(ctx)
            const news = newsOf({ outcome: ctx.outcome ?? { status: 'done' }, ...(pr ? { pr } : {}), ...(before !== undefined ? { prBefore: { url: before } } : {}) })
            if (!news) return
            const line = await ctx.settings.get(NOTIFY_COMMAND)
            if (!line) return
            await runCommandFor(line, ctx.project?.dir ?? homedir(), { id: ctx.id, project: ctx.project?.name ?? 'A session', prompt: ctx.prompt, news }, opts.timeoutMs)
          },
        },
      ],
    },
  })
}

export default notificationsCommand()
