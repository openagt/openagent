// The baseline half of the browser's notifications (#627): what a feed already held versus what
// is new. One engine, two feeds: the "needs you" queue and the "New activity" feed. They differ
// only in how an item is identified, so that is a parameter rather than a second copy.

/**
 * Tracks which items have been announced, so only new ones notify. Identity is the caller's
 * (`keyOf`), since what makes two items "the same" is a property of what is being watched.
 * Testable without timers.
 *
 * The baseline is kept per project (`scopeOf`), not once for the whole poll (#1623). A poll that
 * reached three projects out of four knows what already existed on those three and knows nothing
 * about the fourth, and announcing is a per-project decision anyway. Held globally, one project
 * that can never be read — a registered repo with no remote is an ordinary case — would either
 * silence every project's notifications or hand the whole set a baseline it had not earned.
 */
export class SeenTracker<T> {
  private readonly seen = new Set<string>()
  private readonly warmedUp = new Set<string>()

  constructor(
    private readonly keyOf: (item: T) => string,
    private readonly scopeOf: (item: T) => string,
  ) {}

  /**
   * Fold a poll's items into the baseline and return the ones worth announcing: the items not seen
   * before, from projects this watcher has a real baseline for. `whole` names the projects the poll
   * read completely, and only those earn a baseline — so whatever already existed at start-up is
   * never announced, and a project that could not be read stays quiet until it can be.
   *
   * Items keep being folded in either way: a partial read can only under-report, never invent, so
   * anything it did see is still something the user should not later hear about as new.
   */
  observe(items: T[], whole: Iterable<string>): T[] {
    const fresh = items.filter(
      item => this.warmedUp.has(this.scopeOf(item)) && !this.seen.has(this.keyOf(item)),
    )
    for (const item of items) this.seen.add(this.keyOf(item))
    for (const project of whole) this.warmedUp.add(project)
    return fresh
  }
}
