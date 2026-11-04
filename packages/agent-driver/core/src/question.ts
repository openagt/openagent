/**
 * A question the agent stopped to ask: the one block an agent ends a turn with when it will not
 * decide alone. The block is the contract between an agent and whoever shows the question,
 * a dashboard's card, with the recommended option preselected; this module is its
 * one parser, so the agent learns one shape and every driver reports it the same way.
 *
 * The block, fenced and tagged `await-choices`, is JSON:
 *
 * ```await-choices
 * { "title": "<the question>", "header": "<a word or two>", "options": [{ "label": "<option>", "detail": "<one-liner>" }], "recommended": "<label>" }
 * ```
 *
 * `stop: true` on an option marks an answer that ends the session instead of resuming the agent;
 * `multi: true` allows several answers, `default: true` on the entries that start checked;
 * `file` names a markdown file the question is about. The words that teach an agent the block
 * are the caller's: a skill or a system prompt says when to ask; this says what a question is.
 */

/** The tag of the fenced block a question is written in. */
export const QUESTION_TAG = 'await-choices'

/** One option of a question: what the user picks between. */
export interface QuestionOption {
  /** Stable id an answer is posted back against; synthesized from position when the agent names none. */
  id: string
  /** The option as shown to the user. */
  label: string
  /** An optional one-liner under the label. */
  detail?: string
  /** Starts checked. Only meaningful on a {@link Question.multi} question. */
  default?: boolean
  /** Picking this ends the session rather than resuming the agent with it: the user takes over. */
  stop?: boolean
}

/** A question the agent stopped to ask, parsed from its `await-choices` block. */
export interface Question {
  /** The question shown above the options. */
  title: string
  /** A word or two naming the question ("Background"): what it is called once it is passed by. */
  header?: string
  /** The options to pick between: at least one, or the block is not a question. */
  options: QuestionOption[]
  /** The option to default to when nobody is there to answer, when the agent named one. */
  recommended?: string
  /** Any number of options may be picked rather than exactly one. */
  multi?: boolean
  /** A markdown file the question is about (a plan under approval). */
  file?: string
}

/** The bodies of every fenced block tagged `tag` in `text`, in order. */
export function fencedBlocks(text: string, tag: string): string[] {
  const re = new RegExp('```' + tag + '\\s+([\\s\\S]*?)```', 'g')
  return [...text.matchAll(re)].map(m => m[1] ?? '')
}

/**
 * The question a turn ended on, from the last usable `await-choices` block in its text, or
 * `undefined` when the agent just finished, the common case.
 *
 * Tolerant, because a bad parse must never end a run: ids are synthesized from position when
 * the agent names none, a label-less option is dropped, a blank title falls back, `recommended`
 * may be a label or an id, and a malformed block is skipped for an earlier good one. A block
 * whose options all fall away is not a question.
 */
export function parseQuestion(text: string): Question | undefined {
  for (const body of fencedBlocks(text, QUESTION_TAG).reverse()) {
    const question = parseBody(body)
    if (question) return question
  }
  return undefined
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function parseBody(body: string): Question | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  if (!Array.isArray(record['options'])) return undefined

  const options: QuestionOption[] = []
  ;(record['options'] as Record<string, unknown>[]).forEach((o, i) => {
    const label = str(o?.['label'])
    if (!label) return
    const detail = str(o?.['detail'])
    options.push({
      id: str(o?.['id']) || `opt:${i}`,
      label,
      ...(detail ? { detail } : {}),
      ...(o?.['default'] === true ? { default: true } : {}),
      ...(o?.['stop'] === true ? { stop: true } : {}),
    })
  })
  if (options.length === 0) return undefined

  const named = str(record['recommended'])
  const recommended = named ? (options.find(o => o.id === named) ?? options.find(o => o.label === named))?.id : undefined
  const file = str(record['file'])
  const header = str(record['header'])
  return {
    title: str(record['title']) || 'Which option?',
    ...(header ? { header } : {}),
    options,
    ...(recommended ? { recommended } : {}),
    ...(record['multi'] === true ? { multi: true } : {}),
    ...(file ? { file } : {}),
  }
}

/**
 * The prompt that resumes the agent after the user answered its question. One wording for
 * every caller: the agent knows what it is working on from its session, so nothing else is
 * said, and no "do not ask again" tail, since a capable agent does not re-ask a settled question.
 */
export function continuationPrompt(question: string, answer: string): string {
  return `You paused to ask: "${question}". The user chose: ${answer}. Continue with that decision.`
}
