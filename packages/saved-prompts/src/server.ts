import { randomUUID } from 'node:crypto'
import { act, read, type RpcHost } from '@openagt/hooks/rpc'
import { LIMITS, type SavedPrompt, type Whose } from './saved.js'
import { PERSON_PROMPTS, PROJECT_PROMPTS } from './settings.js'

// saved-prompts' server part: the functions the message box calls (`@openagt/hooks/rpc`), in the
// project the box is in. The person's prompts are theirs in every project, and in a session with
// no project; a project's are kept with it, and a session with no project has none. What a caller
// sends is checked here, whatever its type says: it comes from a page.

/** The prompts the box offers: the person's, then the project's, which a session with no project has none of. */
export interface Prompts {
  person: SavedPrompt[]
  project?: SavedPrompt[]
}

/** The prompts the box offers in the project the call is in. */
export const prompts = read(async (host: RpcHost, _input: object): Promise<Prompts> => {
  const project = await host.project()
  const person = await host.settings.get(PERSON_PROMPTS)
  return project ? { person, project: await host.settings.get(PROJECT_PROMPTS, project) } : { person }
})

/** Save `text` as a prompt named `label`, the person's or the project's, after the others: the prompt saved. */
export const save = act(async (host: RpcHost, input: { label: string; text: string; whose: Whose }): Promise<SavedPrompt> => {
  const label = typeof input.label === 'string' ? input.label.trim() : ''
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (!label) throw new Error('Name the prompt to save it.')
  if (label.length > LIMITS.label) throw new Error(`A prompt's name is at most ${LIMITS.label} characters.`)
  if (!text) throw new Error('Write the prompt it loads into the box.')
  if (text.length > LIMITS.text) throw new Error(`A prompt is at most ${LIMITS.text} characters.`)
  const { kept, keep, full } = await savedOf(host, input.whose)
  if (kept.length >= LIMITS.count) throw new Error(full)
  const saved = { id: randomUUID(), label, text }
  await keep([...kept, saved])
  return saved
})

/** Delete the person's or the project's prompt `id`; one that is not there is gone already. */
export const remove = act(async (host: RpcHost, input: { whose: Whose; id: string }): Promise<void> => {
  const { kept, keep } = await savedOf(host, input.whose)
  const left = kept.filter(prompt => prompt.id !== input.id)
  if (left.length < kept.length) await keep(left)
})

/** The person's or the project's prompts as kept, how to keep others in their place, and what to say when there is no room for another. */
async function savedOf(host: RpcHost, whose: unknown): Promise<{ kept: SavedPrompt[]; keep: (prompts: SavedPrompt[]) => Promise<void>; full: string }> {
  if (whose === 'person') {
    return { kept: await host.settings.get(PERSON_PROMPTS), keep: prompts => host.settings.set(PERSON_PROMPTS, prompts), full: `You have ${LIMITS.count} saved prompts: delete one to save another.` }
  }
  if (whose !== 'project') throw new Error("A prompt is yours or the project's.")
  const project = await host.project()
  if (!project) throw new Error("A session with no project has no project's prompts.")
  return { kept: await host.settings.get(PROJECT_PROMPTS, project), keep: prompts => host.settings.set(PROJECT_PROMPTS, prompts, project), full: `This project has ${LIMITS.count} saved prompts: delete one to save another.` }
}
