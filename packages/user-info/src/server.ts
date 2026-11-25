import { PERSON_INFO, isPersonName, isPictureAddress, type PersonInfo } from '@openagt/hooks'
import { act, type RpcComputerHost } from '@openagt/hooks/rpc'
import { publicProfile, type ProfileOutcome } from '@openagt/github'

// user-info's server part: the functions Settings › Profile calls (`@openagt/hooks/rpc`), in no
// project, since the person's name and picture are theirs on every computer. Each saves the
// catalog's `user-info.person` through the store, which takes it to their other computers; the
// shell reads it there for the foot of its sidebar. What a caller sends is checked here, whatever
// its type says: it comes from a page.

/** Call the person `name` in OpenAgent, on every computer of theirs: the picture stays as it was. */
export const saveName = act(async (host: RpcComputerHost, input: { name: string }): Promise<void> => {
  if (!isPersonName(input.name)) throw new Error('A name is one line of at most 60 characters.')
  const kept = await host.settings.get(PERSON_INFO)
  await host.settings.set(PERSON_INFO, { ...kept, name: input.name.trim() })
})

/** Show no picture of the person: their initials instead. */
export const removePicture = act(async (host: RpcComputerHost, _input: object): Promise<void> => {
  const { picture, ...kept } = await host.settings.get(PERSON_INFO)
  if (picture !== undefined) await host.settings.set(PERSON_INFO, kept)
})

/** What copying a GitHub profile did: whether the person's name or picture changed, and the login GitHub answered for. */
export interface Copied {
  changed: boolean
  login: string
}

/**
 * Copying with `profile` reading GitHub: the name and picture of GitHub's public profile of
 * `login`, into the person's own, once. A profile with no name, or no picture, keeps the person's.
 */
export function copyingFrom(profile: (login: string) => Promise<ProfileOutcome>) {
  return async (host: RpcComputerHost, input: { login: string }): Promise<Copied> => {
    const login = typeof input.login === 'string' ? input.login.trim().replace(/^@/, '') : ''
    if (!login) throw new Error('Type a GitHub login.')
    const said = await profile(login)
    if (!said.ok) throw new Error(said.detail)
    const kept = await host.settings.get(PERSON_INFO)
    const copied: PersonInfo = {
      ...kept,
      ...(isPersonName(said.name) ? { name: said.name.trim() } : {}),
      ...(isPictureAddress(said.avatar) ? { picture: said.avatar } : {}),
      login: said.login,
    }
    const changed = copied.name !== kept.name || copied.picture !== kept.picture || copied.login !== kept.login
    if (changed) await host.settings.set(PERSON_INFO, copied)
    return { changed, login: said.login }
  }
}

/** Copy GitHub's public profile of `login`: read with no login, and never again after this press. */
export const copyFromGitHub = act(copyingFrom(login => publicProfile(login)))
