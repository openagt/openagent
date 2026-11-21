// What a saved prompt is (#626, #1025, #2394): a name and the text it loads into the message box,
// word for word, the person's in every project or one project's. Read by the server part and by
// the dashboard's panel alike, so nothing here is Node's.

/** A saved prompt: what deleting it names it by, its name, and the text it loads. */
export interface SavedPrompt {
  id: string
  label: string
  text: string
}

/** Whose a prompt is: the person's, in every project and in a session with no project, or one project's. */
export type Whose = 'person' | 'project'

/** How many prompts each keeps, and how long a name and a text may be. */
export const LIMITS = { count: 30, label: 80, text: 20_000 } as const

/** How long an id may be: one a hand-edited file gives is kept, within reason. */
const ID_MAX = 100

/**
 * A list of saved prompts as it was saved, read strictly: each prompt whose id, name and text are
 * there, its name and text trimmed and cut to their limits, the first of two with one id, the
 * first {@link LIMITS.count} of them. Anything else there is left out; a value that is no list is
 * none.
 */
export function savedPromptsFrom(value: unknown): SavedPrompt[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = new Set<string>()
  const kept: SavedPrompt[] = []
  for (const item of value) {
    if (kept.length >= LIMITS.count) break
    if (typeof item !== 'object' || item === null) continue
    const { id, label, text } = item as Record<string, unknown>
    if (typeof id !== 'string' || !id || id.length > ID_MAX || ids.has(id) || typeof label !== 'string' || typeof text !== 'string') continue
    const name = label.trim().slice(0, LIMITS.label)
    const body = text.trim().slice(0, LIMITS.text)
    if (!name || !body) continue
    ids.add(id)
    kept.push({ id, label: name, text: body })
  }
  return kept
}
