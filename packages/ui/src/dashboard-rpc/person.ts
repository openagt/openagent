import { readPerson, type Person } from '../dashboard/person.js'

export type { Person } from '../dashboard/person.js'

/** The person at this dashboard, for the foot of its sidebar and Settings › Profile (`readPerson`). */
export async function onPerson(): Promise<Person> {
  return readPerson()
}
