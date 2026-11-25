import { continuationPrompt, skipPrompt } from '@openagt/hooks'
import { act, type RpcHost } from '@openagt/hooks/rpc'
import type { InboxLine } from '@openagt/hooks'

// ask's server part (`@openagt/hooks/rpc`): the answer the question's card sends, in the project of
// the run that asks. The answer is said to the run through its host, which hands it to the run
// while it works and resumes it with it once it has ended: the picked options' labels, read off
// the question as the run holds it, so only what the agent offered is picked; the person's own
// words, said the same way; or that they skip it.

/** What the person answered: the options picked, with their own words or without; or that they skip it. */
export type Answer = { picked?: string | string[]; words?: string } | { skip: true }

/** What answering came to: what the agent was told, or in words why nothing was. */
export type Answered = { ok: true; said: string } | { ok: false; error: string }

/** The answer each question still open was given, by the project and the run, then the question's id: none for a skip. */
const given = new Map<string, Map<string, string | undefined>>()

/** The answer being made to each run, by the project and the run: the next one waits for it. */
const answering = new Map<string, Promise<unknown>>()

/** Run `fn` once the answer before it to the same run is made: a second answer then finds the first given. */
function inTurn<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const turn = (answering.get(key) ?? Promise.resolve()).then(fn)
  const settled = turn.catch(() => {})
  answering.set(key, settled)
  void settled.then(() => {
    if (answering.get(key) === settled) answering.delete(key)
  })
  return turn
}

/** A string of the input, trimmed; none for anything else. */
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value.trim() : undefined)

/**
 * Answer question `question` that run `agentId` waits on (#304, #1774). Answered once, a question
 * takes no second answer, from any tab, until the run goes on from it: the resumed run
 * writes its first line seconds later, and until then the question is still open.
 */
export const answer = act(async (host: RpcHost, input: { agentId: string; question: string } & Answer): Promise<Answered> => {
  const agentId = text(input?.agentId)
  const id = text(input?.question)
  if (!agentId || !id) return { ok: false, error: 'which run, and which of its questions?' }
  const key = `${host.root}\0${agentId}`
  return inTurn(key, async (): Promise<Answered> => {
    const open = await host.questions(agentId)
    const held = given.get(key)
    for (const asked of held?.keys() ?? []) if (!open.some(question => question.id === asked)) held?.delete(asked)
    if (held?.size === 0) given.delete(key)
    const question = open.find(each => each.id === id)
    if (!question) return { ok: false, error: 'that question is no longer open' }
    if (held?.has(id)) {
      const before = held.get(id)
      return { ok: false, error: before === undefined ? 'Already skipped' : `Already answered: ${before}` }
    }
    let line: InboxLine
    let said: string
    let answered: string | undefined
    if ('skip' in input && input.skip === true) {
      said = skipPrompt(question.title)
      line = { kind: 'message', text: said }
    } else {
      const { picked = [], words } = input as { picked?: unknown; words?: unknown }
      const picks = [picked].flat()
      if (!picks.every(pick => typeof pick === 'string')) return { ok: false, error: "every pick must be one of the question's options" }
      const labels = question.options.filter(option => picks.includes(option.id)).map(option => option.label)
      if (labels.length !== picks.length) return { ok: false, error: "every pick must be one of the question's options" }
      const own = text(words)
      if (words !== undefined && !own) return { ok: false, error: 'your own answer is empty' }
      if (!question.multi && labels.length + (own ? 1 : 0) !== 1) return { ok: false, error: 'pick exactly one option' }
      answered = [...labels, ...(own ? [own] : [])].join(', ') || '(none)'
      said = continuationPrompt(question.title, answered)
      line = { kind: 'answer', question: question.title, answer: answered }
    }
    try {
      await host.say(agentId, line)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    given.set(key, new Map(given.get(key)).set(id, answered))
    return { ok: true, said }
  })
})
