import { noreplyEmail } from '@openagt/hooks'
import { readPerson, type Person } from '../dashboard/person.js'
import { currentCaller } from '../team/caller.js'

export type { Person } from '../dashboard/person.js'

/** The person at this dashboard, for the foot of its sidebar and Settings › Profile (`readPerson`). */
export async function onPerson(): Promise<Person> {
  // On a machine shared by a team, the person is who signed in: their name and picture are GitHub's, refreshed at each sign-in.
  const caller = currentCaller()
  if (caller)
    return { name: caller.name ?? caller.login, login: caller.login, email: noreplyEmail(caller), ...(caller.avatar ? { avatar: caller.avatar } : {}), team: true }
  return readPerson()
}
