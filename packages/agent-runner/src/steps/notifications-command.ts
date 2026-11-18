import { defineModule, RunOrder, type RunContext } from '@openagt/hooks'
import { legOf } from '../leg.js'
import { runEndedLine } from '../ended.js'

/**
 * notifications-command, the module, as far as it is this package's until it is a plugin of its
 * own: the person's line, when the run's end needs them (`ended.ts`).
 */
export const notificationsCommand = defineModule({
  name: 'notifications-command',
  hooks: { 'run.step': [{ order: RunOrder.NOTIFY, name: 'run the ended line', run: endedLine }] },
})

async function endedLine(ctx: RunContext): Promise<void> {
  const leg = legOf(ctx)
  const pr = ctx.facts.github?.pr
  await runEndedLine(
    leg.repo,
    {
      id: leg.id,
      prompt: leg.card.intent ?? '',
      status: ctx.outcome?.status ?? 'done',
      ...(leg.question !== undefined ? { question: leg.question } : {}),
      ...(pr ? { pr } : {}),
      // A pull request new to this leg is news; the one the run had when the leg started is not.
      ...(leg.card.pr ? { prBefore: leg.card.pr } : {}),
    },
    { log: leg.here.log },
  )
}
