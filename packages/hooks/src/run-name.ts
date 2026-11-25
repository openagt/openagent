/**
 * What every list calls a run, one rule for all of them, so the same run never goes by two names:
 * its short name, the two to five words a small model gave it, else what the person asked, else the
 * branch it worked on, which the module that keeps its branch gives. None when the run has none of
 * these yet, and the list says what it has instead.
 */
export function runName(run: { title?: string | undefined; prompt?: string | undefined }, branch?: string): string | undefined {
  return run.title?.trim() || run.prompt?.trim() || branch?.trim() || undefined
}
