// What a run needs of the person, in two words, said the same wherever it shows: the Human Queue,
// a project's "Waiting on you", the sidebar, a run's row in the Log. "Needs …" rather than a verb,
// so the words read as what waits, not as a button that would do it. Node-free: the pages say them
// too, beside the items the daemon says them in.

/** What waits on a run: the answer to its question, its files committed, its work published, its pull request merged. */
export type RunNeed = 'awaiting' | 'uncommitted' | 'unpushed' | 'pr'

/** What a run needs, in two words. Work never pushed asks for a pull request where the project can open one, else for a push. */
export function needsWord(need: RunNeed, gitHost = true): string {
  if (need === 'awaiting') return 'Needs answer'
  if (need === 'uncommitted') return 'Needs commit'
  if (need === 'unpushed') return gitHost ? 'Needs PR' : 'Needs push'
  return 'Needs merge'
}
