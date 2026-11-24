/** What git work outside a run takes to reach a remote as an account: cloning a project, listing a remote's branches, a git store's push. */
export interface GitAccess {
  /** Variables for git's environment: its credential settings, and who commits. */
  env: Record<string, string>
}

/** A module's accounts, used outside a run; inside one, the module's step at `RunOrder.ACCOUNTS`, the run's first, sets them in the run's environment. */
export interface AccountAccess {
  /** How to reach `remote`, an https address, as the account this computer picked; none when no account of the module's is for it. */
  git?(remote: string): Promise<GitAccess | undefined>
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
}

/**
 * OpenAgent's accounts at the git hosts, as a module's server part asks for them outside a run: a
 * git store sends the data it keeps in a repository as one of them, never as the person's own login.
 */
export interface GitAccounts {
  /** OpenAgent's accounts at each host the git hosts' packages answer for. */
  hosts(): Promise<HostAccounts[]>
  /** What a repository at `host` keeps to be sent as `login`; in words why not, for no login or one the host's package cannot send as. */
  sendAs(host: string, login?: string): Promise<{ ok: true; account: RepositoryAccount } | { ok: false; error: string }>
}
