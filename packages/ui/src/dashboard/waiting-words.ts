// What a run needs of the person, in two words, said the same wherever it shows: the Human Queue,
// a project's "Waiting on you", the sidebar, a run's row in the Log. "Needs …" rather than a verb,
// so the words read as what waits, not as a button that would do it. Node-free: the pages say them
// too, beside the items the daemon says them in.

/** What waits on a run: the answer to its question, its pull request merged. */
export type RunNeed = 'awaiting' | 'pr'

/** What a run needs, in two words. */
export function needsWord(need: RunNeed): string {
  return need === 'awaiting' ? 'Needs answer' : 'Needs merge'
}
