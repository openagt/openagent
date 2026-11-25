import type { MergeLookup } from './rpc.js'

/** What git work outside a run takes to reach a remote as an account: cloning a project, listing a remote's branches, a git store's push. */
export interface GitAccess {
  /** Variables for git's environment: its credential settings, and who commits. */
  env: Record<string, string>
}

/** A module's accounts, used outside a run; inside one, the module's step at `RunOrder.ACCOUNTS`, the run's first, sets them in the run's environment. */
export interface AccountAccess {
  /** How to reach `remote`, an https address, as the account this computer picked; none when no account of the module's is for it. */
  git?(remote: string): Promise<GitAccess | undefined>
  /** OpenAgent's accounts at each git host the module answers for, none there too: what a "Send as" offers, and what tells a host a module answers for. */
  hosts?(): Promise<HostAccounts[]>
  /**
   * What a repository at `host` keeps to be sent as `login`, one of the module's accounts there; in
   * words why not, for no login or one it cannot send as. None for a host the module does not answer for.
   */
  sendAs?(host: string, login?: string): Promise<{ ok: true; account: RepositoryAccount } | { ok: false; error: string } | undefined>
  /** The commit pull request `number` of `branch` merged as, in the repository at `dir`, read at its host; none for a repository the module does not answer for. */
  mergeCommit?(dir: string, branch: string, number: number): Promise<MergeLookup | undefined>
  /**
   * What a run in the repository at `dir` gets to work as `login`, one of the module's accounts at
   * its host, else as the account runs use: the account's login and the run's environment for it;
   * in words why not, OpenAgent having no such account among them. `dir` none: a session with no
   * project, whose folder is on no host and which may reach the module's all the same. None for a
   * repository the module does not answer for.
   */
  runAs?(dir: string | undefined, login?: string): Promise<RunAccount | { ok: false; error: string } | undefined>
  /** The people behind these commit emails of the repository at `dir`, as its host knows them; none for a repository the module does not answer for. */
  people?(dir: string, emails: readonly string[]): Promise<HostPerson[] | undefined>
}

/** The account a run works as at a git host: its login, and what the run's environment gets for it. */
export interface RunAccount {
  ok: true
  login: string
  env: Record<string, string>
}

/** A person of a project, as its git host knows them by a commit email: their email, login and picture. */
export interface HostPerson {
  email: string
  login: string
  /** A picture of them: an https address. */
  avatar?: string
}

/** What a repository keeps to be sent as one of OpenAgent's accounts: the account, its host, and the git settings that make git go as it, as `[key, value]`, in order. */
export interface RepositoryAccount {
  login: string
  host: string
  config: [string, string][]
}

/** OpenAgent's accounts at one git host that the host still takes: what a "Send as" offers. */
export interface HostAccounts {
  host: string
  /** Their logins. */
  logins: string[]
  /** The one runs use, picked first where none is named yet. */
  runs?: string
  /** The module's press that adds an account there (its `attention.fix` action `action`), drawn where there is none: the module's name, the action's id, its words. */
  add?: { module: string; action: string; label: string }
}

/**
 * OpenAgent's accounts at the git hosts, as a module's server part asks for them outside a run, the
 * modules' `account.access` together: a git store sends the data it keeps in a repository as one of
 * them, never as the person's own login.
 */
export interface GitAccounts {
  /** OpenAgent's accounts at each host a module answers for, none there too. */
  hosts(): Promise<HostAccounts[]>
  /** What a repository at `host` keeps to be sent as `login`; in words why not, for no login, one the host's module cannot send as, or a host no module answers for. */
  sendAs(host: string, login?: string): Promise<{ ok: true; account: RepositoryAccount } | { ok: false; error: string }>
  /** The commit pull request `number` of `branch` merged as, in the repository at `dir`, as the first module answering for its host says; not merged where none does. */
  mergeCommit(dir: string, branch: string, number: number): Promise<MergeLookup>
  /**
   * The account a run in the repository at `dir` works as, `login` else the one runs use, as the
   * first module answering for it says; none when no module does. With `dir` none (a session with
   * no project), the first module that gives the account, else the first one's refusal; none when
   * no module answers.
   */
  runAs(dir: string | undefined, login?: string): Promise<RunAccount | { ok: false; error: string } | undefined>
  /** The people behind these commit emails of the repository at `dir`, as the first module answering for it says; nobody where none does. */
  people(dir: string, emails: readonly string[]): Promise<HostPerson[]>
}
