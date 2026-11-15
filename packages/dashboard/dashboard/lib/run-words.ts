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
}

const RUN_STATES: Record<string, RunState> = {
  running: { word: 'working', said: 'working', cell: 'working', tone: 'text-info' },
  waiting: { word: 'waiting', said: 'waits on your answer', cell: 'waiting', tone: 'text-muted-foreground' },
  saving: { word: 'saving…', said: 'saving', cell: 'working', tone: 'text-muted-foreground' },
  done: { word: 'done', said: 'done', cell: 'done', tone: 'text-success' },
  stopped: { word: 'stopped', said: 'stopped', cell: 'stopped', tone: 'text-warning' },
  failed: { word: 'failed', said: 'failed', cell: 'failed', tone: 'text-danger' },
  merged: { word: 'merged', said: 'merged', cell: 'merged', tone: 'text-muted-foreground' },
  // Its computer does not answer: nothing known to be going.
  unknown: { word: 'status unknown', said: 'its computer is offline', cell: 'idle', tone: 'text-muted-foreground' },
}

/** A state this table does not name reads as itself, its hexagon empty. */
const stateOf = (status: string): RunState => RUN_STATES[status] ?? { word: status, said: status, cell: 'idle', tone: 'text-muted-foreground' }

/** The word a list prints for a run in this state. */
export const runWord = (status: string): string => stateOf(status).word

/** How a sentence says a run in this state stands. */
export const runSaid = (status: string): string => stateOf(status).said

/** The colour of a state's word. */
export const runTone = (status: string): string => stateOf(status).tone

/** The state of work a run's mark draws. */
export const runCell = (status: string): WorkState => stateOf(status).cell
