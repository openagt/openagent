import { RunOrder, type RunStep } from '@openagt/hooks'
import type { Leg } from '../leg.js'
import { runEndedLine } from '../ended.js'

/** notifications-command's step: the person's line, when the run's end needs them (`ended.ts`). */
export function notificationsCommandSteps(leg: Leg): RunStep[] {
  return [
    {
      order: RunOrder.NOTIFY,
      name: 'run the ended line',
      run: ctx =>
        runEndedLine(
          leg.repo,
          {
            id: leg.id,
            prompt: leg.card.intent ?? '',
            status: ctx.outcome?.status ?? 'done',
            ...(leg.question !== undefined ? { question: leg.question } : {}),
            ...(leg.worked.pr ? { pr: leg.worked.pr } : {}),
            // A pull request new to this leg is news; the one the run had when it started is not.
            ...(leg.card.pr ? { prBefore: leg.card.pr } : {}),
          },
          { log: leg.here.log },
        ),
    },
  ]
}
