import type { AccountRotation, AccountTurn, AgentAccount, DriverTurn, RotatedTurn } from '@openagt/agent-driver'
import { accountsPath, freesIn, isLimited, markLimited, noteWindows, pickAccount, readAccounts, usableAccounts, withLogin, type AccountsAgent } from './accounts.js'
import { ownLoginThere } from './login.js'
import { loginWiring } from './wiring.js'

// The rotation a driver is handed (`AccountRotation` in `agent-driver`): a turn runs on the first
// free account of the list, and one its account's limit stops goes on, the same conversation, with
// the next free one. The list and its order are `accounts.ts`'s; what a session may use of it is
// its caller's (`AccountsOption`).

/** Which accounts file a session runs on, and the account it starts on when that one is free. */
export interface AccountsOption {
  /** The file. Default the agent's own {@link accountsPath} in the session's environment. */
  path?: string
  /** The account to start on, by name: a scheduler's pick. Else the first free one. */
  prefer?: string
  /** The accounts this session may use, by name, in the file's order: a project's own few. All of them when unsaid, or when none of these is there any more. */
  only?: readonly string[]
  /** The clock, for tests. */
  now?: () => number
  /** Whether the agent has a login of the person's own here. Default what it keeps in the session's environment. */
  ownLoginThere?: (env: NodeJS.ProcessEnv) => boolean
}

/** Every account the session may use is at its limit: the turn cannot go on. */
export class UsageLimitError extends Error {
  override readonly name = 'UsageLimitError'
}

/** What the next account is told after a switch: the prompt is in the conversation already. */
export function goOn(agent: string): string {
  return `A usage limit stopped you. The work goes on now on another ${agent} account: continue where you stopped.`
}

/** What {@link turnOnAccounts} runs a turn with. */
export interface TurnOnAccounts extends RotatedTurn {
  option: AccountsOption
  /** The file. */
  path: string
  /** The agent's name as a person reads it: "Claude", "Codex". */
  agent: string
  /** Whether the agent has a login of the person's own here: without one, the turn takes an added account. */
  ownThere?: boolean
}

/** Why no account can take the turn: each is at its limit, and the first to free says when. */
function allLimited(accounts: AgentAccount[], agent: string, now: number): string {
  const first = accounts.filter(a => a.limitedUntil !== undefined).sort((a, b) => a.limitedUntil! - b.limitedUntil!)[0]
  const count = accounts.length === 1 ? `The ${agent} account is` : `All ${accounts.length} ${agent} accounts are`
  return `${count} at their limit${first?.limitedUntil !== undefined ? `: ${first.name}'s is free again in ${freesIn(first.limitedUntil, now)}` : ''}.`
}

/**
 * A turn on the person's accounts: on the one the session is on, or the first free one. The
 * account's windows are kept as the turn says them; a turn its account's limit stops marks the
 * account limited until it frees, and the same conversation goes on with the next free account,
 * told to go on where it stopped. Every account at its limit ends the turn. One account is no
 * choice: the turn tries it, as one always did, whatever a limit said of it before.
 */
export async function turnOnAccounts(on: TurnOnAccounts): Promise<DriverTurn> {
  const now = on.option.now ?? Date.now
  const usable = (all: AgentAccount[]): AgentAccount[] => withLogin(usableAccounts(all, on.option.only), on.ownThere ?? true)
  const ended = (result: AccountTurn): DriverTurn => {
    if (result.turn === undefined) throw result.failure
    return result.turn
  }
  const first = usable(readAccounts(on.path))
  if (first.length < 2) return ended(await on.run(first[0]!, on.text, on.opts))
  let said = on.text
  let sent = on.opts
  for (;;) {
    const all = usable(readAccounts(on.path))
    const account = (on.current.account !== undefined ? all.find(a => a.name === on.current.account && !isLimited(a, now())) : undefined) ?? pickAccount(all, now(), on.option.prefer)
    if (account === undefined) throw new UsageLimitError(allLimited(all, on.agent, now()))
    on.current.account = account.name
    const result = await on.run(account, said, sent)
    if (result.windows) noteWindows(account.name, result.windows, now(), on.path)
    if (!result.limited || on.stopped()) return ended(result)
    const after = usable(markLimited(account.name, result.resetsAt, now(), on.path))
    const next = pickAccount(after, now())
    if (next === undefined) throw new UsageLimitError(allLimited(after, on.agent, now()))
    const frees = after.find(a => a.name === account.name)?.limitedUntil
    on.emit({ type: 'notice', message: `↻ Switched to ${next.name}'s ${on.agent}: ${account.name}'s hit its limit${frees !== undefined ? `, free again in ${freesIn(frees, now())}` : ''}.` })
    on.current.account = next.name
    if (result.sessionId !== undefined) on.continueFrom(result.sessionId)
    // The prompt is in the conversation already: the next account is told to go on with it, and
    // nothing of what went with it is handed over twice.
    const { attached: _attached, added: _added, inbox: _inbox, onInboxLine: _onInboxLine, ...rest } = on.opts
    said = goOn(on.agent)
    sent = { ...rest, resume: true }
  }
}

/** The agents' names as a person reads them. */
const AGENT_NAMES: Record<AccountsAgent, string> = { claude: 'Claude', codex: 'Codex' }

/** The accounts of `agent`, as a driver is handed them: what its sessions run on. */
export function accountRotation(agent: AccountsAgent, option: AccountsOption = {}): AccountRotation {
  const path = (env: NodeJS.ProcessEnv): string => option.path ?? accountsPath(agent, env)
  const ownThere = (env: NodeJS.ProcessEnv): boolean => (option.ownLoginThere ?? (given => ownLoginThere(agent, loginWiring(given))))(env)
  return {
    first: env => pickAccount(withLogin(readAccounts(path(env)), ownThere(env)), (option.now ?? Date.now)(), option.prefer),
    turn: (env, on) => turnOnAccounts({ ...on, option, path: path(env), agent: AGENT_NAMES[agent], ownThere: ownThere(env) }),
  }
}
