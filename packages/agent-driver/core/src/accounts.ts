import type { DriverEvent, DriverPromptOptions, DriverRateWindow, DriverTurn } from './types.js'

// What a driver sees of a person's several accounts: one account, the rotation it is handed, and
// what it answers a turn on an account with. Which account takes a turn is the rotation's
// (`@openagt/skill-account-rotation`); what an added account's login is, and how a turn runs on it,
// is the driver's. A driver handed none runs on whatever login its agent has.

/** One account as the list keeps it. */
export interface AgentAccount {
  /** Its name, as the person gave it; unique. The person's own login has none until they give one. */
  name: string
  /** An added account's login, as its agent keeps it. None for the person's own: the agent has that one. */
  login?: string
  /** Who the login is at its agent's service, when the computer that made it knew: an agent told it lists what that account may use. */
  accountId?: string
  /** When it was added, ISO 8601. */
  added?: string
  /** When a limit it hit frees, epoch milliseconds: until then no run picks it. */
  limitedUntil?: number
  /** Its windows as the last turn on it said them. */
  windows?: DriverRateWindow[]
  /** When those were said, epoch milliseconds. */
  windowsAt?: number
}

/** What a turn's own output said of the account it ran on, read once the turn is over. */
export interface AccountReading {
  /** Whether the account's limit is what stopped the turn. */
  limited: boolean
  /** When that limit frees, epoch ms, when the agent said. */
  resetsAt?: number
  /** The account's windows as the turn said them. */
  windows?: DriverRateWindow[]
  /** The conversation, so far as the turn got: what the next account continues. */
  sessionId?: string
}

/** What one turn on one account came to, as its agent read it. */
export interface AccountTurn extends AccountReading {
  /** The turn, when it ended with one. */
  turn?: DriverTurn
  /** What it threw, when it did. */
  failure?: unknown
}

/**
 * One turn on one account, as a driver answers a rotation's {@link RotatedTurn.run}: the turn, or
 * what it threw, beside what its output said of the account. `read` is asked once the turn is
 * over, and told whether it failed. The conversation is the turn's own when it ended with one.
 */
export async function accountTurn(turn: () => Promise<DriverTurn>, read: (failed: boolean) => AccountReading): Promise<AccountTurn> {
  let done: DriverTurn
  try {
    done = await turn()
  } catch (failure) {
    return { ...read(true), failure }
  }
  return { ...read(false), turn: done, ...(done.sessionId !== undefined ? { sessionId: done.sessionId } : {}) }
}

/** What a driver gives a rotation to run one turn with. */
export interface RotatedTurn {
  /** The account the session is on, kept across its turns until a limit moves it on. */
  current: { account?: string }
  text: string
  opts: DriverPromptOptions
  emit: (event: DriverEvent) => void
  /** Whether the session or the turn was stopped: a stop is never a limit to switch over. */
  stopped: () => boolean
  /** The conversation the next account continues. */
  continueFrom: (sessionId: string) => void
  /** One turn on `account`: the person's own login, as the agent keeps it, when the account has none. */
  run: (account: AgentAccount, said: string, sent: DriverPromptOptions) => Promise<AccountTurn>
}

/** The accounts a driver's sessions run on. */
export interface AccountRotation {
  /** The account a run takes first in this environment, when any is free. */
  first(env: NodeJS.ProcessEnv): AgentAccount | undefined
  /** A turn on the accounts of this environment, handing over at a limit. */
  turn(env: NodeJS.ProcessEnv, on: RotatedTurn): Promise<DriverTurn>
}
