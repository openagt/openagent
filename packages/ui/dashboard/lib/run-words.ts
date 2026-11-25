import type { WorkState } from '../components/ui/state.js'

// A run's state as every place says it, the one table of them: its word, how a sentence says it
// stands, its mark (the look's hexagon, `StateCell`, in the state of work it is) and the colour of
// its word. The sidebar, the Logs, a ticket, the Overview and a subagent's row all read it here, so
// one state never reads as two words or two colours.

interface RunState {
  /** The word a list prints. */
  word: string
  /** How a sentence says the run stands, after its name: "… · working". */
  said: string
  /** The mark: the state of work its hexagon draws. */
  cell: WorkState
  /** The word's colour. */
  tone: string
  /** The colour of its words in a row's line under the run's name, where the mark already carries the state's colour: quiet, but for what needs the person and a failure. */
  line: string
}

const QUIET = 'text-muted-foreground'

const RUN_STATES: Record<string, RunState> = {
  running: { word: 'working', said: 'working', cell: 'working', tone: 'text-info', line: QUIET },
  // A run parked on a question.
  waiting: { word: 'needs answer', said: 'waits on your answer', cell: 'waiting', tone: 'text-muted-foreground', line: 'text-warning' },
  saving: { word: 'saving…', said: 'saving', cell: 'working', tone: 'text-muted-foreground', line: QUIET },
  done: { word: 'done', said: 'done', cell: 'done', tone: 'text-success', line: QUIET },
  stopped: { word: 'stopped', said: 'stopped', cell: 'stopped', tone: 'text-warning', line: QUIET },
  failed: { word: 'failed', said: 'failed', cell: 'failed', tone: 'text-danger', line: 'text-danger' },
  merged: { word: 'merged', said: 'merged', cell: 'merged', tone: 'text-muted-foreground', line: QUIET },
}

/** A state this table does not name reads as itself, its hexagon empty. */
const stateOf = (status: string): RunState => RUN_STATES[status] ?? { word: status, said: status, cell: 'idle', tone: QUIET, line: QUIET }

/** The word a list prints for a run in this state. */
export const runWord = (status: string): string => stateOf(status).word

/** How a sentence says a run in this state stands. */
export const runSaid = (status: string): string => stateOf(status).said

/** The colour of a state's word. */
export const runTone = (status: string): string => stateOf(status).tone

/** The colour of a state's words in a row's line under the run's name. */
export const runLineTone = (status: string): string => stateOf(status).line

/** The state of work a run's mark draws. */
export const runCell = (status: string): WorkState => stateOf(status).cell

/**
 * How a run stands, as every row of it says it, the one rule for them: the state its mark draws
 * ({@link runCell}) and the word its line opens with. A run something waits on the person for (an
 * item of "Waiting on you": its question, its files to commit, its pull request to merge) waits, in
 * that item's words; else a run still going says so; else one whose pull request merged is merged,
 * however it ended; else it is as it ended.
 */
export function runState(run: { status: string; saving?: boolean | undefined; merged?: boolean | undefined }, need?: { words: string } | undefined): { state: string; word: string } {
  const state = need || run.status === 'waiting' ? 'waiting' : run.saving ? 'saving' : run.status === 'running' ? 'running' : run.merged ? 'merged' : run.status
  return { state, word: need?.words ?? runWord(state) }
}
