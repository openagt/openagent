// Team mode (`ui`'s team/): one machine shared by a team, each person signed in with GitHub, as
// themselves. A module learns who it acts for from the caller its function is handed
// (`RpcComputerHost.caller`), and a run from the one it was started for (`RunOptions.caller`, kept
// on its record): none on a machine of one person, where everything is that person's.

/** Who a call or a run is for, on a machine shared by a team. */
export interface TeamCaller {
  /** Their GitHub username. */
  login: string
  name?: string
  /** GitHub's number for them: their commits' address (`<id>+<login>@users.noreply.github.com`). */
  id?: number
  /** Their picture on GitHub, as of their last sign-in: an https address. */
  avatar?: string
  /** Whether they own the machine's team: what was on the machine before Team mode is theirs. */
  owner: boolean
  /** The team owner's GitHub username: whose what has no owner is. */
  teamOwner: string
}

/** Logins compare as GitHub compares them: case does not count. */
export function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * Whether something owned (`owner`, a GitHub username; none: from before Team mode, the team
 * owner's) and maybe shared is for `caller`: theirs, or shared. Everything is, with no caller.
 */
export function ownedFor(caller: TeamCaller | undefined, owned: { owner?: string; shared?: boolean }): boolean {
  if (!caller) return true
  if (owned.shared) return true
  return owned.owner === undefined ? caller.owner : sameLogin(owned.owner, caller.login)
}

/** Whether `caller` may change something owned: only its owner (the team owner for what has none); anyone with no caller. */
export function ownsIt(caller: TeamCaller | undefined, owned: { owner?: string }): boolean {
  if (!caller) return true
  return owned.owner === undefined ? caller.owner : sameLogin(owned.owner, caller.login)
}

/** Where a command a module's page runs finds who it runs for (`callerFromEnv`): JSON of a {@link TeamCaller}. */
export const CALLER_ENV = 'OPENAGENT_CALLER'

/** The caller a command was run for, from its environment; none on a machine of one person. */
export function callerFromEnv(env: NodeJS.ProcessEnv = process.env): TeamCaller | undefined {
  const raw = env[CALLER_ENV]
  if (!raw) return undefined
  try {
    return teamCallerOf(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/** A caller as a record or a file keeps one, as far as it is one. */
export function teamCallerOf(value: unknown): TeamCaller | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const parsed = value as Partial<TeamCaller>
  if (typeof parsed.login !== 'string' || typeof parsed.owner !== 'boolean' || typeof parsed.teamOwner !== 'string') return undefined
  return {
    login: parsed.login,
    owner: parsed.owner,
    teamOwner: parsed.teamOwner,
    ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
    ...(typeof parsed.id === 'number' ? { id: parsed.id } : {}),
    ...(typeof parsed.avatar === 'string' && parsed.avatar.startsWith('https://') ? { avatar: parsed.avatar } : {}),
  }
}

/** The environment that says `caller` to a command: none for no caller. */
export function callerEnv(caller: TeamCaller | undefined): Record<string, string> {
  return caller ? { [CALLER_ENV]: JSON.stringify(caller) } : {}
}

/** Whose something owned is, by GitHub username: its owner, or the team owner's for what has none. */
export function ownerOf(caller: TeamCaller, owned: { owner?: string }): string {
  return owned.owner ?? caller.teamOwner
}

/** GitHub's own address for a person: what their runs are kept under and their commits are by, on a machine shared by a team. */
export function noreplyEmail(caller: Pick<TeamCaller, 'login' | 'id'>): string {
  return caller.id !== undefined ? `${caller.id}+${caller.login}@users.noreply.github.com` : `${caller.login}@users.noreply.github.com`
}

/**
 * Who this process acts for now. In a session's own process and a module's command, the one its
 * environment says ({@link CALLER_ENV}); the dashboard, which acts for each request's caller in
 * turn, tells it where to ask ({@link readCallersWith}). What a setting kept per person reads.
 */
let callerNowIs: () => TeamCaller | undefined = () => callerFromEnv(process.env)

export function callerNow(): TeamCaller | undefined {
  return callerNowIs()
}

/** Ask `read` who this process acts for now: the dashboard's request at work. */
export function readCallersWith(read: () => TeamCaller | undefined): void {
  callerNowIs = read
}
