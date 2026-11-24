import type { ChoiceOption, DriverEvent, RunEvent } from '@openagt/hooks'
import type { AnyDiaryLine } from '../record.js'

/**
 * A run's diary, read as the events its host streams (`RunHost.events`, #1769): what the run page
 * replays and tails. The record's four kinds of diary line are the shape; the lines agent-driver's
 * own log writes are read beside them, and whatever else a writer put there as it is.
 */

/**
 * One diary line as one OpenAgent event: what the agent said, its result, the run's end and its
 * cost are the shape's four kinds; a line of any other kind is an OpenAgent event as written, and
 * one whose kind is no longer an event (the kinds of runs recorded before OpenAgent stopped
 * running agents) reads as nothing. The line's time, `at`, is the event's, whatever the kind, and a
 * question's id: a run's second question is not its first.
 */
export function fromDiaryLine(line: AnyDiaryLine): RunEvent | undefined {
  const { at, ...rest } = line
  const event = eventOf(rest as AnyDiaryLine)
  if (!event) return undefined
  if (typeof at !== 'string') return event
  return event.kind === 'choice' ? { ...event, id: at, at } : { ...event, at }
}

/** Every kind of event there is: a line of another kind has nothing to show. */
const EVENT_KINDS: Record<RunEvent['kind'], true> = {
  session: true,
  'session-update': true,
  screen: true,
  log: true,
  error: true,
  'pull-request': true,
  branch: true,
  settled: true,
  usage: true,
  choice: true,
  'choice-resolved': true,
  driver: true,
  intent: true,
  title: true,
  end: true,
}

/** A diary line with no time on it, as the event it reads as. */
function eventOf(line: AnyDiaryLine): RunEvent | undefined {
  switch (line.kind) {
    case 'said':
      return { kind: 'driver', event: { type: 'text', text: String(line['text']), ...(typeof line['subagent'] === 'string' ? { subagent: line['subagent'] } : {}) } }
    case 'result': {
      const { kind: _kind, ...rest } = line
      return { kind: 'driver', event: { type: 'result', ...rest } as DriverEvent }
    }
    case 'ended':
      return {
        kind: 'end',
        ok: line['status'] === 'done',
        ...(line['status'] === 'stopped' ? { stopped: true } : {}),
        ...(line['status'] === 'waiting' ? { waiting: true } : {}),
        ...(typeof line['detail'] === 'string' ? { detail: line['detail'] } : {}),
      }
    // An error line with a headline is the agent's own `error` block, from a run recorded before the
    // daemon stopped running agents; any other is agent-driver's, a driver's message.
    case 'error': {
      if (typeof line['headline'] === 'string') {
        return { kind: 'error', headline: line['headline'], ...(typeof line['detail'] === 'string' ? { detail: line['detail'] } : {}) }
      }
      const { kind: _kind, ...rest } = line
      return { kind: 'driver', event: { type: 'error', ...rest } as DriverEvent }
    }
    // The lines agent-driver's own log writes (its `session-log.ts`): a driver event per kind, the
    // agent's session id, and the question a turn ended on as the gate the dashboard shows.
    case 'start':
    case 'steered':
    case 'action':
    case 'output':
    case 'thought':
    case 'subagent':
    case 'tokens':
    case 'thinking':
    case 'background':
    case 'rate-limit':
    case 'notice': {
      const { kind, ...rest } = line
      return { kind: 'driver', event: { type: kind, ...rest } as DriverEvent }
    }
    case 'session':
      if (typeof line['sessionId'] === 'string' && line['driver'] === undefined) return { kind: 'session-update', sessionId: line['sessionId'] }
      return line as unknown as RunEvent
    case 'question': {
      const { kind: _kind, title, header, options, recommended, multi, file } = line
      return {
        kind: 'choice',
        id: 'question',
        title: String(title ?? 'Which option?'),
        ...(typeof header === 'string' ? { header } : {}),
        options: Array.isArray(options) ? (options as ChoiceOption[]) : [],
        ...(typeof recommended === 'string' ? { recommended } : {}),
        ...(multi === true ? { multi: true } : {}),
        ...(typeof file === 'string' ? { file } : {}),
      } as RunEvent
    }
    case 'cost':
      return { kind: 'usage', costUsd: line['usd'] as number }
    default:
      return Object.hasOwn(EVENT_KINDS, line.kind) ? (line as unknown as RunEvent) : undefined
  }
}

/** A diary as the run's events, for a reader that replays them. */
export function eventsOf(lines: readonly AnyDiaryLine[]): RunEvent[] {
  return lines.flatMap(line => fromDiaryLine(line) ?? [])
}
