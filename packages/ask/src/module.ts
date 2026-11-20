import { defineModule, RunOrder, type AppAttention, type AttentionItem, type RunContext } from '@openagt/hooks'
import { parseQuestion } from './question.js'

// ask, a plugin kept per project (#2394), on until a person switches it off: how an agent asks the
// person to decide instead of guessing. Its skill teaches the `await-choices` block, so a coding
// agent with a tool of its own to ask with, as Claude Code's, is given none: it would ask that way
// instead. Its run step has the run ask: the question a turn ends on, the agent's tool's or its
// block's, ends the run waiting for the answer, which the question's card sends (`./server`,
// `./dashboard`); "Needs answer" says the runs that wait. Without it, a run that asks just ends,
// and the person replies with a message.

/** What every list says of a run waiting on its question. */
export const NEEDS_ANSWER = 'Needs answer'

/** The run asks the person: a turn that ends on a question, its agent's tool's or the block's, ends the run waiting. */
function asks(ctx: RunContext): void {
  ctx.asking = { questionIn: parseQuestion }
}

/** What waits on the person in the project: each run waiting on a question, by the one it asks now. */
const needsAnswer: AppAttention = async ({ waiting }) => {
  if (!waiting) return []
  return (await waiting()).flatMap((run): AttentionItem[] => {
    const question = run.questions.at(-1)
    if (!question) return []
    return [
      {
        kind: 'waiting',
        scope: 'run',
        run: run.id,
        // A question's id is the time it was asked, which another run's question can share.
        id: `${run.id}:${question.id}`,
        words: NEEDS_ANSWER,
        title: run.name ?? run.id,
        detail: question.title,
        mark: 'question',
        ...(run.endedAt !== undefined ? { since: run.endedAt } : {}),
      },
    ]
  })
}

export default defineModule({
  name: 'ask',
  plugin: { scope: 'project' },
  hooks: {
    'run.skills': ({ agent }) => (agent?.ownQuestionTool ? [] : [{ name: 'ask', dir: new URL('../', import.meta.url) }]),
    'run.step': [{ order: RunOrder.CONTEXT, name: 'ask the person', run: asks }],
    'app.attention': needsAnswer,
  },
})
