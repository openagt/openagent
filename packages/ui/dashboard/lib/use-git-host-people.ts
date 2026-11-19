import { useCallback } from 'react'
import type { ModuleHostPerson } from '../module/index.js'
import { usePolled } from './use-async.js'

// The accounts behind the people of a list of runs that spans projects: what its rows draw as each
// person's picture. A project's git host is asked once for all of that project's people, and only
// again when the list holds someone new or at this slow pace, however often the list itself is read
// and however many rows name the same person.

/** Who a row wants: the run's person, in the project it belongs to. */
export interface PersonWanted {
  projectId: string | null
  person?: string | undefined
}

/** A person's account, as a row finds it. */
export type AccountOf = (projectId: string | null, person: string | undefined) => ModuleHostPerson | undefined

/** The accounts seldom change, and what the git host said is kept a day behind this: the read only catches a host that could not be asked before. */
const EVERY_MS = 10 * 60_000

const NOBODY: Record<string, ModuleHostPerson> = {}

const keyOf = (projectId: string, person: string): string => `${projectId}\n${person.toLowerCase()}`

/**
 * What the project's git host said of the people of these runs. `remember` names the list: its
 * last answer stays shown while new people are asked for, and is there from the first frame of the
 * next visit, so a picture already seen does not fall back to letters.
 */
export function useGitHostPeople(wanted: readonly PersonWanted[], ask: (projectId: string, emails: string[]) => Promise<ModuleHostPerson[]>, remember: string): AccountOf {
  const byProject = new Map<string, Set<string>>()
  for (const { projectId, person } of wanted) if (projectId !== null && person) byProject.set(projectId, (byProject.get(projectId) ?? new Set()).add(person))
  const asked = [...byProject].map(([projectId, people]) => [projectId, [...people].sort()] as const).sort(([a], [b]) => a.localeCompare(b))
  const key = JSON.stringify(asked)
  const { value: accounts } = usePolled(
    asked.length === 0
      ? null
      : async () => {
          const answers = await Promise.all(asked.map(async ([projectId, emails]) => (await ask(projectId, emails)).map(account => [keyOf(projectId, account.email), account] as const)))
          return Object.fromEntries(answers.flat())
        },
    NOBODY,
    EVERY_MS,
    [key],
    { remember, stored: true },
  )
  return useCallback((projectId, person) => (projectId !== null && person ? accounts[keyOf(projectId, person)] : undefined), [accounts])
}

/** Who a person's mark says it is: their email, and their account at the git host when it knows one. */
export function personSaid(person: string, account: ModuleHostPerson | undefined): string {
  return account ? `${person} · ${account.login}` : person
}
