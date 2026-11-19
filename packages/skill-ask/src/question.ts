import type { Question, QuestionOption } from '@openagt/agent-driver'

/**
 * The question block: how an agent with no question tool of its own asks the person to decide,
 * which ask's skill teaches. The one block a turn ends with when the agent will not decide alone,
 * read here, by the module's one parser, so the agent learns one shape and the card asks it.
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
 * are the skill's: it says when to ask; this says what a question is.
 */

/** The tag of the fenced block a question is written in. */
export const QUESTION_TAG = 'await-choices'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** The bodies of every fenced block tagged `tag` in `text`, in order. */
function fencedBlocks(text: string, tag: string): string[] {
  const re = new RegExp('```' + tag + '\\s+([\\s\\S]*?)```', 'g')
  return [...text.matchAll(re)].map(m => m[1] ?? '')
}

/**
 * The question a message ends on, from the last usable `await-choices` block in it, or
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
