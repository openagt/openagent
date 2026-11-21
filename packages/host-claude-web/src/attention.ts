import type { AppAttention, AttentionItem } from '@openagt/hooks'
import type { RecordDeps, RunCard } from '@openagt/agent-driver'
import { bridgeQuestions } from './bridge-store.js'
import { projectWebRuns } from './web-runs.js'

/** What every list says first of a run that waits on its person's answer: the words ask's runs have too. */
export const NEEDS_ANSWER = 'Needs answer'

/**
 * What waits on the person (`app.attention`, #1554, #1332): a web run whose cloud session is
 * parked on them, the bridge holding the question it asks, or claude.ai's session list saying it
 * awaits input, which a question asked in words leaves as its only trace. A pick on its way to the
 * session waits on nobody. The row opens the run, where the question's card answers it.
 */
export function webAttention(deps: { logs?: RecordDeps; now?: () => Date } = {}): AppAttention {
  return async ({ project }) => {
    if (!project) return []
    const store = bridgeQuestions()
    const waiting = store.waitingSessions((deps.now ?? (() => new Date()))()).filter(session => !store.pendingAnswer(session.sessionId))
    // The project's records are read only when a session waits.
    if (waiting.length === 0) return []
    const runs = await projectWebRuns(project, {}, deps.logs ?? {})
    return waiting.flatMap(({ sessionId, question, since }): AttentionItem[] => {
      const run = runs.find(one => one.session?.id === sessionId)
      if (!run) return []
      return [
        {
          kind: 'waiting',
          scope: 'run',
          run: run.card.id,
          // The same question is new once; another one the session asks is new again.
          id: `${run.card.id}:${question?.title ?? 'awaiting'}`,
          words: NEEDS_ANSWER,
          title: nameOf(run.card),
          detail: question?.title ?? 'It asks in its session on claude.ai.',
          since,
          mark: 'question',
        },
      ]
    })
  }
}

/** The run, as every list names it: its short name, else what it was asked, else its branch. */
function nameOf(card: RunCard): string {
  return card.title?.trim() || card.intent?.trim() || card.branch?.trim() || card.id
}
