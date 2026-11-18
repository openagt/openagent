/** What git work outside a run takes to reach a remote as an account: cloning a project, listing a remote's branches, a git store's push. */
export interface GitAccess {
  /** Variables for git's environment: its credential settings, and who commits. */
  env: Record<string, string>
}

/** A module's accounts, used outside a run; inside one, the module's step at `RunOrder.ACCOUNTS` sets them. */
export interface AccountAccess {
  /** How to reach `remote`, an https address, as the account this computer picked; none when no account of the module's is for it. */
  git?(remote: string): Promise<GitAccess | undefined>
}
