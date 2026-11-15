// A run's state as every place says it, the one table of them: its word, how a sentence says it
// stands, its mark (a filled dot while something goes on, a ring once nothing does) and the colour of
// its word. The sidebar, the Logs, a ticket, the Overview and a subagent's row all read it here, so
// one state never reads as two words or two colours.

interface RunState {
  /** The word a list prints. */
  word: string
  /** How a sentence says the run stands, after its name: "… · at work". */
  said: string
  /** The mark's classes. */
  mark: string
  /** The word's colour. */
  tone: string
}

const RING = 'border border-muted-foreground/60'

const RUN_STATES: Record<string, RunState> = {
  running: { word: 'running', said: 'at work', mark: 'bg-primary', tone: 'text-primary' },
  waiting: { word: 'waiting', said: 'waits on your answer', mark: 'bg-warning', tone: 'text-muted-foreground' },
  saving: { word: 'saving…', said: 'saving', mark: 'bg-success', tone: 'text-muted-foreground' },
  done: { word: 'done', said: 'done', mark: RING, tone: 'text-success' },
  stopped: { word: 'stopped', said: 'stopped', mark: 'border border-warning/70', tone: 'text-warning' },
  failed: { word: 'failed', said: 'failed', mark: 'border border-danger/70', tone: 'text-danger' },
  merged: { word: 'merged', said: 'merged', mark: 'border border-success/70', tone: 'text-muted-foreground' },
  // Its computer does not answer: a broken ring, nothing known to be going.
  unknown: { word: 'status unknown', said: 'its computer is offline', mark: 'border border-dashed border-muted-foreground/60', tone: 'text-muted-foreground' },
}

/** A state this table does not name reads as itself, in the ring of an ended run. */
const stateOf = (status: string): RunState => RUN_STATES[status] ?? { word: status, said: status, mark: RING, tone: 'text-muted-foreground' }

/** The word a list prints for a run in this state. */
export const runWord = (status: string): string => stateOf(status).word

/** How a sentence says a run in this state stands. */
export const runSaid = (status: string): string => stateOf(status).said

/** The colour of a state's word. */
export const runTone = (status: string): string => stateOf(status).tone

/** The classes of a state's mark, its size the caller's. */
export const runMark = (status: string): string => stateOf(status).mark
