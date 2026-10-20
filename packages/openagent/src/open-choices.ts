import type { ChoiceRequest, OpenAgentEvent } from './events.js'

/** The `choice` event carries the full request; strip the `kind` discriminant. */
type ChoiceEvent = { kind: 'choice' } & ChoiceRequest

/**
 * Every question a run still waits on, in the order asked, read off the run's events. One rule
 * for every surface that offers an answer (the run page, the Human Queue, the write
 * that delivers the answer), so none offers what another would refuse.
 *
 * A `choice` event opens a question; asked again under the same id, the later one replaces it.
 * It closes when the agent goes on (any later event of the agent's own: the answer, or the
 * person's text, began a new turn), when a `choice-resolved` names it, and when the run ends
 * for good. An end that says `waiting` closes nothing: the run ended ON the question, its
 * checkout kept, and the answer resumes it. A run that died holding a question ends otherwise,
 * and its question goes with it (#1359): nobody would read the pick.
 */
export function pendingChoices(events: readonly OpenAgentEvent[]): ChoiceRequest[] {
  const open = new Map<string, ChoiceRequest>()
  for (const event of events) {
    if (event.kind === 'choice-resolved') open.delete(event.id)
    else if (event.kind === 'driver') open.clear()
    else if (event.kind === 'end') {
      if (event.waiting !== true) open.clear()
    } else if (event.kind === 'choice') {
      const { kind: _kind, ...request } = event as ChoiceEvent
      open.set(event.id, request)
    }
  }
  return [...open.values()]
}
