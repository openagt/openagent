import { isPersonRecordName, isPictureAddress, readPersonRecord, removePersonRecord, writePersonRecord } from '@openagt/agent-data'
import { personAtPage, readPerson, type Person } from '../dashboard/person.js'
import { gitHostPackages } from './logins.js'

export type { Person } from '../dashboard/person.js'

/** Where "Sync from GitHub" reads a profile: the git host's package for it answers. */
const GITHUB = 'github.com'

/** The person at this dashboard, for the foot of its sidebar and Settings › Profile (`readPerson`): another person's, for a page their device opened. */
export async function onPerson(): Promise<Person> {
  return personAtPage(await readPerson())
}

/** Call the person `name` in OpenAgent, on every computer of theirs: the picture stays as it was. */
export async function sendSavePersonName(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isPersonRecordName(name)) return { ok: false, error: 'A name is one line of at most 60 characters.' }
  const kept = await readPersonRecord()
  const written = await writePersonRecord({ ...kept, name: name.trim() })
  return written.ok ? { ok: true } : { ok: false, error: written.error }
}

/** Show no picture of the person: their initials instead. */
export async function sendRemovePersonPicture(): Promise<{ ok: true } | { ok: false; error: string }> {
  const kept = await readPersonRecord()
  if (!kept?.picture) return { ok: true }
  const { picture: _gone, ...rest } = kept
  const written = await writePersonRecord(rest)
  return written.ok ? { ok: true } : { ok: false, error: written.error }
}

/**
 * Copy the name and picture of GitHub's public profile of `login` into the person's own, once:
 * read with no login, and never again after this press.
 */
export async function sendSyncPersonFromGitHub(login: string): Promise<{ ok: true; changed: boolean; login: string } | { ok: false; error: string }> {
  if (typeof login !== 'string' || !login.trim()) return { ok: false, error: 'Type a GitHub login.' }
  const said = await gitHostPackages.run(GITHUB, ['profile', login.trim().replace(/^@/, '')])
  if (!said.ok) return said
  const { login: found, name, avatar } = (said.output ?? {}) as { login?: unknown; name?: unknown; avatar?: unknown }
  if (typeof found !== 'string') return { ok: false, error: 'GitHub said no profile.' }
  const kept = await readPersonRecord()
  const written = await writePersonRecord({
    name: isPersonRecordName(name) ? name.trim() : (kept?.name ?? (await readPerson()).name),
    ...(isPictureAddress(avatar) ? { picture: avatar } : {}),
    github: found,
  })
  return written.ok ? { ok: true, changed: written.changed, login: found } : { ok: false, error: written.error }
}

/** Forget the person's own name and picture: git's name, or this computer's user, again. */
export async function sendForgetPerson(): Promise<{ ok: true } | { ok: false; error: string }> {
  const removed = await removePersonRecord()
  return removed.ok ? { ok: true } : { ok: false, error: removed.error }
}
