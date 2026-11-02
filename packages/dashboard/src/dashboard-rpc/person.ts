import { personAtPage, readPerson, type Person } from '../dashboard/person.js'
import { contextProjects } from './context.js'

export type { Person } from '../dashboard/person.js'

/** How long the person is kept: neither the name nor the picture changes while the dashboard is open, and the git host's answer is a network call. */
const KEEP_MS = 60 * 60_000

let kept: { at: number; person: Promise<Person> } | undefined

/** The person at this dashboard, for the foot of its sidebar (`readPerson`): another person's, for a page their device opened. */
export async function onPerson(): Promise<Person> {
  if (!kept || Date.now() - kept.at >= KEEP_MS) kept = { at: Date.now(), person: readPerson({ projects: async () => (await contextProjects().list().catch(() => [])).map(project => project.path) }) }
  return personAtPage(await kept.person)
}
