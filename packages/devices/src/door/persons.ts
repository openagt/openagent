import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pidAlive } from '../process.js'
import { update, type Person } from './store.js'

/**
 * Start making a person's user, as a process of its own that outlives whoever asked: the command
 * again, with `person-work`. Started by `add --for`, and by the door's process when a person of a
 * server starts their first run on this computer through that server's line. Answers its process.
 */
export function startPersonWork(env: NodeJS.ProcessEnv, person: string): number | undefined {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../bin/devices', import.meta.url)), 'person-work', person], { env, detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
  return child.pid
}

/** Change the person here by that name who is not the owner, when the file still holds them. */
function changePerson(env: NodeJS.ProcessEnv, name: string, apply: (person: Person) => void): Promise<void> {
  return update(env, store => {
    const known = store.persons.find(candidate => candidate.name === name && !candidate.owner)
    if (known) apply(known)
  })
}

/**
 * Make `person`'s user, unless it is made or a making of it is at work, as the file says: a process
 * of its own (`start`) makes it, and the file keeps that process's number while it works. Why an
 * earlier try failed is forgotten before the next one starts, never after: one that fails at once
 * has said why by then.
 */
export async function makeUser(env: NodeJS.ProcessEnv, person: Person, start: (env: NodeJS.ProcessEnv, person: string) => number | undefined = startPersonWork): Promise<void> {
  if (person.port === undefined || person.ready || (person.worker !== undefined && pidAlive(person.worker))) return
  await changePerson(env, person.name, known => void delete known.problem)
  const worker = start(env, person.name)
  if (worker !== undefined) await changePerson(env, person.name, known => void (known.worker = worker))
}

/** Write which server's line made `name` a person here, unless the file says one already. */
export const cameFrom = (env: NodeJS.ProcessEnv, name: string, from: string): Promise<void> => changePerson(env, name, known => void (known.from ??= from))
