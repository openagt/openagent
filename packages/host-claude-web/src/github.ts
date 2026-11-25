import { accountGit, nodeGitRunner } from '@openagt/git-branches'
import type { GitRunner } from '@openagt/hooks'
import { HOST, accountNamed, asAccount, gitConfig, homeUrlFor, nodeGhRunner, type GhRunner } from '@openagt/github'

// The project's repository on GitHub, and the account this host reaches it as: a cloud session is
// made on a repository claude.ai's picker lists, and what this host pushes there, and reads back,
// goes as one of OpenAgent's GitHub accounts, never as the person's own login.

/** Said when the project is on no GitHub: claude.ai makes a session on a repository it can pick. */
export const NOT_ON_GITHUB = 'This project is not on GitHub: a Claude Code cloud session works on a repository claude.ai can pick, so its origin must be on GitHub.'

/** The project's repository at `dir`, as claude.ai's picker names it: `owner/name`. Refused in words for a project that is not on GitHub. */
export async function repoOf(dir: string, git: GitRunner = nodeGitRunner()): Promise<string> {
  const home = await homeUrlFor(dir, git)
  const slug = home?.replace(/^https:\/\/github\.com\//, '')
  if (!slug || slug === home || slug.split('/').length !== 2) throw new Error(NOT_ON_GITHUB)
  return slug
}

/** One of OpenAgent's GitHub accounts, as git and `gh` work as it. */
export interface GithubAccount {
  login: string
  /** git in a project, its talks with origin going as the account. */
  git: GitRunner
  /** `gh` working as the account. */
  gh: GhRunner
}

/**
 * One of OpenAgent's GitHub accounts: `account`, when named, else the one runs use. Refused, in
 * words for the person, when OpenAgent has no such account.
 */
export async function githubAccount(dir: string, account: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<GithubAccount> {
  const { login, dir: folder } = await accountNamed(account, dir, nodeGhRunner(), env)
  return {
    login,
    git: accountGit(nodeGitRunner(), { login, host: HOST, config: gitConfig(folder) }),
    gh: asAccount(nodeGhRunner(), folder),
  }
}
