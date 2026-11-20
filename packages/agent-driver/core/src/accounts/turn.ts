import type { AccountReading, AccountTurn, DriverTurn } from '@openagt/hooks'

// What a driver answers a turn on one account with, for the rotation it is handed (the contract's
// `AccountRotation`, `@openagt/hooks`). Which account takes a turn is the rotation's; what an added
// account's login is, and how a turn runs on it, is the driver's.

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

