import type { HostPerson } from '@openagt/hooks'
import { distributionHooks } from '../distribution-hooks.js'
import { resolveProjectPath } from './context.js'

export type { HostPerson } from '@openagt/hooks'

/**
 * The people behind these commit emails of a project's, as its git host knows them: what a card
 * shows as each person's picture. The module that answers for the project's host says, and keeps
 * what it said (`account.access`' `people`). No such module, or no such project: nobody.
 */
export async function onPeople(projectId: string, emails: string[]): Promise<HostPerson[]> {
  const root = await resolveProjectPath(projectId)
  if (!root) return []
  return (await distributionHooks()).gitAccounts.people(root, emails.filter(email => typeof email === 'string'))
}
