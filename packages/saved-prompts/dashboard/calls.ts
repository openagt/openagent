import { rpcClient, type UiHost, type UiPrompt } from '@openagt/ui/module'
import type { SavedPrompt, Whose } from '../src/saved.js'

// The module's calls of its own server part (`../src/server.ts`), typed by it, in the project the
// message box is in. Each throws the reason a call failed.

const server = (host: Pick<UiHost, 'call'>) => rpcClient<typeof import('../src/server.js')>(host)

/** What the box's menus list each one's prompts under. */
const GROUPS: Record<Whose, string> = { person: 'Your saved prompts', project: 'Project saved prompts' }

/** The prompts the box offers in `projectId`: the person's, then the project's, each with whose it is in its id. */
export async function offered(host: Pick<UiHost, 'call'>, projectId: string): Promise<UiPrompt[]> {
  const { person, project = [] } = await server(host).prompts(projectId, {})
  const of = (whose: Whose, prompts: readonly SavedPrompt[]): UiPrompt[] => prompts.map(prompt => ({ id: `${whose}:${prompt.id}`, label: prompt.label, text: prompt.text, group: GROUPS[whose] }))
  return [...of('person', person), ...of('project', project)]
}

/** Whether a prompt saved in `projectId` may be the project's: a session with no project has none. */
export async function hasProject(host: Pick<UiHost, 'call'>, projectId: string): Promise<boolean> {
  return (await server(host).prompts(projectId, {})).project !== undefined
}

/** Save `text` as a prompt named `label`, the person's or the project's. */
export const save = (host: Pick<UiHost, 'call'>, projectId: string, input: { label: string; text: string; whose: Whose }) => server(host).save(projectId, input)

/** Delete the prompt the box offered as `id`. */
export async function remove(host: Pick<UiHost, 'call'>, projectId: string, id: string): Promise<void> {
  const at = id.indexOf(':')
  const whose = id.slice(0, at)
  if (whose !== 'person' && whose !== 'project') throw new Error('No such saved prompt.')
  await server(host).remove(projectId, { whose, id: id.slice(at + 1) })
}
