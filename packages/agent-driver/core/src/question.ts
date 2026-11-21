/**
 * A question the agent stopped to ask: how a turn ends when the agent will not decide alone, which
 * every driver reports the same way (`DriverTurn.question`, a `question` event). A driver whose
 * agent asks with a tool of its own (Claude Code's AskUserQuestion, Codex's request_user_input)
 * reads its question with {@link toolQuestion}; a question written in the agent's message is the
 * caller's to read (`DriverPromptOptions.questionIn`), as the module that teaches it writes it.
 * The answer goes back as one sentence, and a skip as another, the same for every caller, which a
 * reader of a run's prompts reads back ({@link answeredQuestion}).
 */

import type { Question, QuestionOption } from '@openagt/hooks'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** How an agent's own question tool marks the option it recommends: at the end of the option's label. */
const RECOMMENDED = /\s*\(Recommended\)$/i

/**
 * A question asked with an agent's own tool, Claude Code's AskUserQuestion or Codex's
 * request_user_input: one of the tool's questions, `{question, header, options: [{label,
 * description}], multiSelect}`, the same fields in both. The tool marks its recommended option by
 * ending the label with "(Recommended)", which the card says its own way. None without a question
 * or an option to pick: that is no question a card can ask.
 */
export function toolQuestion(raw: unknown): Question | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const asked = raw as Record<string, unknown>
  let recommended: string | undefined
  const options: QuestionOption[] = []
  for (const [at, given] of (Array.isArray(asked['options']) ? (asked['options'] as unknown[]) : []).entries()) {
    const option = typeof given === 'object' && given !== null ? (given as Record<string, unknown>) : {}
    const named = str(option['label'])
    const label = named.replace(RECOMMENDED, '')
    if (label === '') continue
    const id = `opt:${at}`
    if (recommended === undefined && label !== named) recommended = id
    const detail = str(option['description'])
    options.push({ id, label, ...(detail !== '' ? { detail } : {}) })
  }
  const title = str(asked['question'])
  if (title === '' || options.length === 0) return undefined
  const header = str(asked['header'])
  return { title, ...(header !== '' ? { header } : {}), options, ...(recommended !== undefined ? { recommended } : {}), ...(asked['multiSelect'] === true ? { multi: true } : {}) }
}

/**
 * The prompt that resumes the agent after the user answered its question. One wording for
 * every caller: the agent knows what it is working on from its session, so nothing else is
 * said, and no "do not ask again" tail, since a capable agent does not re-ask a settled question.
 */
export function continuationPrompt(question: string, answer: string): string {
  return `You paused to ask: "${question}". The user chose: ${answer}. Continue with that decision.`
}

/** What a skip tells the agent: its question, and that it goes on without an answer. */
export function skipPrompt(question: string): string {
  return `You paused to ask: "${question}". The user skipped it. Continue without an answer.`
}

/** The question and the answer a prompt that answers one carries (no answer: it was skipped), or undefined for any other prompt. */
export function answeredQuestion(prompt: string): { question: string; answer?: string } | undefined {
  const chose = /^You paused to ask: "([\s\S]*)"\. The user chose: ([\s\S]*)\. Continue with that decision\.$/.exec(prompt)
  if (chose) return { question: chose[1]!, answer: chose[2]! }
  const skipped = /^You paused to ask: "([\s\S]*)"\. The user skipped it\. Continue without an answer\.$/.exec(prompt)
  return skipped ? { question: skipped[1]! } : undefined
}
