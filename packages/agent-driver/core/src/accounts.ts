import type { DriverEvent, DriverPromptOptions, DriverRateWindow, DriverTurn } from './types.js'

// What a driver sees of a person's several accounts: one account, and the rotation it is handed.
// Which account takes a turn is the rotation's (`@openagt/skill-account-rotation`); what an added
// account's login is, and how a turn runs on it, is the driver's. A driver handed none runs on
// whatever login its agent has.

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

/** What one turn on one account came to, as its agent read it. */
export interface AccountTurn {
  /** The turn, when it ended with one. */
  turn?: DriverTurn
  /** What it threw, when it did. */
  failure?: unknown
  /** Whether the account's limit is what stopped it. */
  limited: boolean
  /** When that limit frees, epoch ms, when the agent said. */
  resetsAt?: number
  /** The account's windows as the turn said them. */
  windows?: DriverRateWindow[]
  /** The conversation, so far as the turn got: what the next account continues. */
  sessionId?: string
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
