import type { DriverEvent, DriverTurn } from './types.js'

/**
 * A turn asked to continue a conversation its coding agent no longer has: deleted after the agent
 * keeps them (Claude Code, 30 days by default), never saved, or saved on another machine. Nothing
 * of the turn was said: the caller decides how to go on without it.
 */
export class ConversationGoneError extends Error {
  override readonly name = 'ConversationGoneError'
  constructor(
    /** The driver's id, e.g. `"codex"`. */
    readonly driver: string,
    /** The conversation it was asked to continue. */
    readonly sessionId: string,
  ) {
    super(`${driver} no longer has the conversation ${sessionId}`)
  }
}

/** The events a turn sends before it shows whether the conversation it continues is there. */
const BEFORE_ANSWER = new Set<DriverEvent['type']>(['start', 'session', 'model', 'error'])

/**
 * One turn that continues `sessionId`, its first events held back until one shows the conversation
 * is there: the agent's CLI says it is gone only after the turn started, with an error. A turn on
 * a gone conversation sends no event and throws {@link ConversationGoneError}; any other turn sends
 * every event, in order. `isGone` reads the driver's failure.
 */
export async function continuingTurn(
  driver: string,
  sessionId: string,
  emit: (event: DriverEvent) => void,
  isGone: (err: unknown) => boolean,
  turn: (emit: (event: DriverEvent) => void) => Promise<DriverTurn>,
): Promise<DriverTurn> {
  let held: DriverEvent[] | undefined = []
  const release = (): void => {
    for (const event of held ?? []) emit(event)
    held = undefined
  }
  try {
    const done = await turn(event => {
      if (held !== undefined && BEFORE_ANSWER.has(event.type)) held.push(event)
      else {
        release()
        emit(event)
      }
    })
    release()
    return done
  } catch (err) {
    if (held !== undefined && isGone(err)) throw new ConversationGoneError(driver, sessionId)
    release()
    throw err
  }
}
